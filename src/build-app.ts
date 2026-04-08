import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppEnv } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrations.js";
import { Repo } from "./db/repo.js";
import { KmsService } from "./crypto/kms.js";
import { OpenAIClient } from "./openai/client.js";
import { LimitService } from "./limits/service.js";
import { UsageService } from "./usage/service.js";

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  if (origin === "null") {
    return true;
  }

  return allowedOrigins.length === 0 || allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

export async function buildBaseApp(env: AppEnv) {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "request.headers.authorization",
          "req.body.apiKey",
          "request.body.apiKey",
          "req.body.password",
          "request.body.password",
          "res.headers['set-cookie']"
        ],
        censor: "[REDACTED]"
      }
    }
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isOriginAllowed(origin, env.corsAllowedOrigins));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"]
  });

  const pool = createPool(env);
  await runMigrations(pool);

  const repo = new Repo(pool);
  const kmsService = new KmsService(env.awsRegion, env.kmsKeyId);
  const openaiClient = new OpenAIClient(env.openaiBaseUrl);
  const limitService = new LimitService(repo);
  const usageService = new UsageService(repo);

  app.decorate("env", env);
  app.decorate("repo", repo);
  app.decorate("kmsService", kmsService);
  app.decorate("openaiClient", openaiClient);

  app.get("/health", async () => ({ ok: true }));

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return { app, repo, limitService, usageService };
}
