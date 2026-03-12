import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerProxyRoutes } from "../src/proxy/routes.js";

function makeAuthContext() {
  return {
    mode: "tool",
    toolId: 1,
    toolSlug: "demo-tool",
    projectId: 10,
    projectSlug: "demo-project",
    projectStatus: "inactive",
    rpmCap: 60,
    dailyTokenCap: 2000000
  };
}

async function buildProxyTestApp() {
  const app = Fastify();
  const repo = {
    findAuthByToolToken: vi.fn().mockResolvedValue(makeAuthContext()),
    getActiveProjectKey: vi.fn()
  };
  const kmsService = { decrypt: vi.fn() };
  const openaiClient = { request: vi.fn() };
  const limitService = { enforce: vi.fn().mockResolvedValue(undefined) };
  const usageService = { log: vi.fn().mockResolvedValue(undefined) };

  app.decorate("repo", repo as any);
  app.decorate("kmsService", kmsService as any);
  app.decorate("openaiClient", openaiClient as any);

  registerProxyRoutes(app, {
    limitService: limitService as any,
    usageService: usageService as any
  });

  await app.ready();
  return { app, repo, kmsService, limitService };
}

describe("proxy route project status guard", () => {
  it("returns 403 for embeddings when project is inactive", async () => {
    const { app, repo, kmsService, limitService } = await buildProxyTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/proxy/v1/embeddings",
      headers: { authorization: "Bearer tt.fake.fake" },
      payload: { model: "text-embedding-3-small", input: "ping" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "forbidden",
      message: "Project is inactive"
    });
    expect(limitService.enforce).not.toHaveBeenCalled();
    expect(repo.getActiveProjectKey).not.toHaveBeenCalled();
    expect(kmsService.decrypt).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 403 for models when project is inactive", async () => {
    const { app, repo, kmsService } = await buildProxyTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/proxy/v1/models",
      headers: { authorization: "Bearer tt.fake.fake" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "forbidden",
      message: "Project is inactive"
    });
    expect(repo.getActiveProjectKey).not.toHaveBeenCalled();
    expect(kmsService.decrypt).not.toHaveBeenCalled();
    await app.close();
  });
});
