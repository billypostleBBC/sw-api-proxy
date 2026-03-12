import { buildBaseApp } from "./build-app.js";
import { AuthService } from "./auth/service.js";
import { loadRelayEnv } from "./config/env.js";
import { registerRelayRoutes } from "./relay/routes.js";

async function buildRelayApp() {
  const env = loadRelayEnv();
  const { app, repo, limitService, usageService } = await buildBaseApp(env);
  const authService = new AuthService(repo, env.relaySessionTtlHours ?? 24);

  registerRelayRoutes(app, { authService, limitService, usageService });

  return app;
}

const app = await buildRelayApp();

app
  .listen({ port: app.env.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info({ port: app.env.port }, "relay-api started");
  })
  .catch((error) => {
    app.log.error(error, "failed to start relay-api");
    process.exit(1);
  });
