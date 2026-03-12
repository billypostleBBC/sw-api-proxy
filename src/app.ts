import cookie from "@fastify/cookie";
import { buildBaseApp } from "./build-app.js";
import { AuthService } from "./auth/service.js";
import { loadProxyEnv } from "./config/env.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { registerProxyRoutes } from "./proxy/routes.js";
import { registerWebAdminRoutes } from "./web-admin/routes.js";

async function buildProxyApp() {
  const env = loadProxyEnv();
  const { app, repo, limitService, usageService } = await buildBaseApp(env);
  await app.register(cookie);
  await repo.upsertAdmins([...(env.adminEmailAllowlist ?? new Set())]);
  const authService = new AuthService(repo, env.sessionTtlHours ?? 10);

  registerAdminRoutes(app, { authService, repo, usageService });
  registerProxyRoutes(app, { limitService, usageService });
  registerWebAdminRoutes(app, { authService });

  return app;
}

const app = await buildProxyApp();

app
  .listen({ port: app.env.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info({ port: app.env.port }, "proxy-api started");
  })
  .catch((error) => {
    app.log.error(error, "failed to start proxy-api");
    process.exit(1);
  });
