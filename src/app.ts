import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { loadEnv } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrations.js";
import { Repo } from "./db/repo.js";
import { KmsService } from "./crypto/kms.js";
import { EmailService } from "./email/ses.js";
import { TicketService } from "./auth/tickets.js";
import { OpenAIClient } from "./openai/client.js";
import { AuthService } from "./auth/service.js";
import { LimitService } from "./limits/service.js";
import { UsageService } from "./usage/service.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerProxyRoutes } from "./proxy/routes.js";
import { registerWebAdminRoutes } from "./web-admin/routes.js";

async function buildApp() {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "request.headers.authorization",
          "req.body.apiKey",
          "request.body.apiKey",
          "res.headers['set-cookie']"
        ],
        censor: "[REDACTED]"
      }
    }
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      const allowed = env.corsAllowedOrigins.length === 0 || env.corsAllowedOrigins.includes(origin);
      cb(null, allowed);
    },
    credentials: true
  });

  const pool = createPool(env);
  await runMigrations(pool);

  const repo = new Repo(pool);
  await repo.upsertAdmins([...env.adminEmailAllowlist]);

  const kmsService = new KmsService(env.awsRegion, env.kmsKeyId);
  const emailService = new EmailService(env.awsRegion, env.sesFromEmail);
  const ticketService = new TicketService(env.clientTicketSigningKey, env.clientTicketTtlMinutes);
  const openaiClient = new OpenAIClient(env.openaiBaseUrl);

  const authService = new AuthService(repo, env.sessionTtlHours, env.magicLinkTtlMinutes);
  const limitService = new LimitService(repo);
  const usageService = new UsageService(repo);

  app.decorate("env", env);
  app.decorate("repo", repo);
  app.decorate("kmsService", kmsService);
  app.decorate("emailService", emailService);
  app.decorate("ticketService", ticketService);
  app.decorate("openaiClient", openaiClient);

  registerAdminRoutes(app, { authService, repo, usageService, appBaseUrl: env.appBaseUrl });
  registerAuthRoutes(app, { authService, repo, ticketService, appBaseUrl: env.appBaseUrl });
  registerProxyRoutes(app, { limitService, usageService });
  registerWebAdminRoutes(app, { authService });

  app.get("/health", async () => ({ ok: true }));

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}

const app = await buildApp();

app
  .listen({ port: app.env.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info({ port: app.env.port }, "proxy-api started");
  })
  .catch((error) => {
    app.log.error(error, "failed to start proxy-api");
    process.exit(1);
  });
