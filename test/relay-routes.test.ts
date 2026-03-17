import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerRelayRoutes } from "../src/relay/routes.js";
import { sha256 } from "../src/utils/crypto.js";

async function buildRelayTestApp() {
  const app = Fastify();
  const repo = {
    findToolBySlug: vi.fn(),
    getActiveProjectKey: vi.fn()
  };
  const kmsService = {
    decrypt: vi.fn().mockResolvedValue("sk-live-key")
  };
  const openaiClient = {
    request: vi.fn()
  };
  const authService = {
    createSessionWithExpiry: vi.fn().mockResolvedValue({
      id: "sess_1",
      token: "st.sess_1.secret",
      expiresAt: new Date("2026-03-13T12:00:00.000Z")
    }),
    getSessionEmail: vi.fn().mockImplementation(async (_scope: string, token: string) => {
      return token === "st.valid.secret" ? "person@bbc.com" : null;
    })
  };
  const limitService = {
    enforce: vi.fn().mockResolvedValue(undefined)
  };
  const usageService = {
    audit: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined)
  };

  app.decorate(
    "env",
    {
      relayPasswordHash: sha256("shared-relay-password"),
      relayEmailDomainAllowlist: new Set(["bbc.com"])
    } as any
  );
  app.decorate("repo", repo as any);
  app.decorate("kmsService", kmsService as any);
  app.decorate("openaiClient", openaiClient as any);

  registerRelayRoutes(app, {
    authService: authService as any,
    limitService: limitService as any,
    usageService: usageService as any
  });

  await app.ready();
  return { app, repo, authService, limitService, usageService, kmsService, openaiClient };
}

describe("relay login route", () => {
  it("creates a daily relay session for BBC Studios email and shared password", async () => {
    const { app, authService, usageService } = await buildRelayTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "person@bbc.com",
        password: "shared-relay-password"
      },
      remoteAddress: "10.0.0.1"
    });

    expect(response.statusCode).toBe(200);
    expect(authService.createSessionWithExpiry).toHaveBeenCalledWith("user", "person@bbc.com");
    expect(usageService.audit).toHaveBeenCalledWith({
      actorEmail: "person@bbc.com",
      actorScope: "user",
      action: "relay.session.created",
      targetType: "session",
      targetId: "sess_1",
      metadata: { expiresAt: "2026-03-13T12:00:00.000Z" }
    });
    expect(response.json()).toEqual({
      token: "st.sess_1.secret",
      expiresAt: "2026-03-13T12:00:00.000Z"
    });
    await app.close();
  });

  it("rejects non-BBC email", async () => {
    const { app } = await buildRelayTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "person@example.com",
        password: "shared-relay-password"
      },
      remoteAddress: "10.0.0.2"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Invalid relay credentials"
    });
    await app.close();
  });

  it("rejects bbc.co.uk email when relay allowlist is bbc.com", async () => {
    const { app } = await buildRelayTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "person@bbc.co.uk",
        password: "shared-relay-password"
      },
      remoteAddress: "10.0.0.20"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Invalid relay credentials"
    });
    await app.close();
  });

  it("rate limits repeated failed login attempts from the same ip", async () => {
    const { app } = await buildRelayTestApp();

    for (let i = 0; i < 5; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "person@bbc.com",
          password: "wrong-password"
        },
        remoteAddress: "10.0.0.3"
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "person@bbc.com",
        password: "wrong-password"
      },
      remoteAddress: "10.0.0.3"
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: "rate_limit_exceeded",
      message: "Too many login attempts",
      details: { retryAfterSeconds: 60 }
    });
    await app.close();
  });
});

describe("relay responses route", () => {
  it("rejects missing relay session bearer token", async () => {
    const { app } = await buildRelayTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/tools/story-assistant-server/responses",
      payload: {
        model: "gpt-4.1-mini",
        input: "ping"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Missing or invalid bearer token"
    });
    await app.close();
  });

  it("rejects inactive tool", async () => {
    const { app, repo, limitService, kmsService } = await buildRelayTestApp();
    repo.findToolBySlug.mockResolvedValue({
      toolId: 8,
      projectId: 10,
      projectSlug: "story-assistant-prod",
      toolStatus: "inactive",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/tools/story-assistant-server/responses",
      headers: {
        authorization: "Bearer st.valid.secret"
      },
      payload: {
        model: "gpt-4.1-mini",
        input: "ping"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "forbidden",
      message: "Tool is inactive"
    });
    expect(limitService.enforce).not.toHaveBeenCalled();
    expect(repo.getActiveProjectKey).not.toHaveBeenCalled();
    expect(kmsService.decrypt).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects inactive project", async () => {
    const { app, repo, limitService, kmsService } = await buildRelayTestApp();
    repo.findToolBySlug.mockResolvedValue({
      toolId: 8,
      projectId: 10,
      projectSlug: "story-assistant-prod",
      toolStatus: "active",
      projectStatus: "inactive",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/tools/story-assistant-server/responses",
      headers: {
        authorization: "Bearer st.valid.secret"
      },
      payload: {
        model: "gpt-4.1-mini",
        input: "ping"
      }
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

  it("rejects missing project key", async () => {
    const { app, repo, limitService, kmsService } = await buildRelayTestApp();
    repo.findToolBySlug.mockResolvedValue({
      toolId: 8,
      projectId: 10,
      projectSlug: "story-assistant-prod",
      toolStatus: "active",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });
    repo.getActiveProjectKey.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/tools/story-assistant-server/responses",
      headers: {
        authorization: "Bearer st.valid.secret"
      },
      payload: {
        model: "gpt-4.1-mini",
        input: "ping"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "forbidden",
      message: "No active API key for project"
    });
    expect(limitService.enforce).toHaveBeenCalledWith(10, 60, 2000000);
    expect(kmsService.decrypt).not.toHaveBeenCalled();
    await app.close();
  });

  it("logs usage and forwards successful upstream responses unchanged", async () => {
    const { app, repo, usageService, kmsService, openaiClient } = await buildRelayTestApp();
    repo.findToolBySlug.mockResolvedValue({
      toolId: 8,
      projectId: 10,
      projectSlug: "story-assistant-prod",
      toolStatus: "active",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });
    repo.getActiveProjectKey.mockResolvedValue({
      kmsCiphertext: "ciphertext"
    });
    openaiClient.request.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_1",
          output: [{ type: "output_text", text: "Relay connectivity is working." }],
          usage: { input_tokens: 12, output_tokens: 7 }
        }),
        { status: 200 }
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/tools/story-assistant-server/responses",
      headers: {
        authorization: "Bearer st.valid.secret"
      },
      payload: {
        model: "gpt-4.1-mini",
        input: "ping"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(kmsService.decrypt).toHaveBeenCalledWith("ciphertext");
    expect(openaiClient.request).toHaveBeenCalledWith("/v1/responses", "sk-live-key", {
      model: "gpt-4.1-mini",
      input: "ping"
    });
    expect(usageService.log).toHaveBeenCalledWith({
      projectId: 10,
      toolId: 8,
      endpoint: "/v1/responses",
      model: "gpt-4.1-mini",
      inputTokens: 12,
      outputTokens: 7,
      estimatedCostUsd: null,
      statusCode: 200,
      latencyMs: expect.any(Number)
    });
    expect(response.json()).toEqual({
      id: "resp_1",
      output: [{ type: "output_text", text: "Relay connectivity is working." }],
      usage: { input_tokens: 12, output_tokens: 7 }
    });
    await app.close();
  });

  it("maps upstream failures into the proxy error shape", async () => {
    const { app, repo, openaiClient } = await buildRelayTestApp();
    repo.findToolBySlug.mockResolvedValue({
      toolId: 8,
      projectId: 10,
      projectSlug: "story-assistant-prod",
      toolStatus: "active",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });
    repo.getActiveProjectKey.mockResolvedValue({
      kmsCiphertext: "ciphertext"
    });
    openaiClient.request.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Upstream refused request"
          }
        }),
        { status: 400 }
      )
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/tools/story-assistant-server/responses",
      headers: {
        authorization: "Bearer st.valid.secret"
      },
      payload: {
        model: "gpt-4.1-mini",
        input: "ping"
      }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: "upstream_error",
      message: "OpenAI request failed",
      details: {
        status: 400,
        upstream: {
          error: {
            message: "Upstream refused request"
          }
        }
      }
    });
    await app.close();
  });
});
