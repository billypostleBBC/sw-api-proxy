import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAuthRoutes } from "../src/auth/routes.js";

async function buildAuthTestApp() {
  const app = Fastify();

  app.decorate(
    "env",
    {
      clientTicketTtlMinutes: 5
    } as any
  );

  const repo = {
    findAuthByToolToken: vi.fn(),
    findToolBySlug: vi.fn()
  };

  const ticketService = {
    createTicket: vi.fn().mockResolvedValue("jwt.ticket.token")
  };

  registerAuthRoutes(app, {
    repo: repo as any,
    ticketService: ticketService as any
  });

  await app.ready();
  return { app, repo, ticketService };
}

describe("auth routes", () => {
  it("returns 401 when bearer token is missing", async () => {
    const { app } = await buildAuthTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/client-ticket"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Missing or invalid bearer token"
    });
    await app.close();
  });

  it("returns 401 for invalid bearer token", async () => {
    const { app, repo } = await buildAuthTestApp();
    repo.findAuthByToolToken.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/auth/client-ticket",
      headers: {
        authorization: "Bearer tt.invalid.invalid"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Missing or invalid bearer token"
    });
    await app.close();
  });

  it("rejects request body", async () => {
    const { app } = await buildAuthTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/client-ticket",
      headers: {
        authorization: "Bearer tt.fake.fake",
        "content-type": "application/json"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "bad_request",
      message: "Request body is not allowed"
    });
    await app.close();
  });

  it("creates a ticket from a valid tool token", async () => {
    const { app, repo, ticketService } = await buildAuthTestApp();

    repo.findAuthByToolToken.mockResolvedValue({
      mode: "tool",
      toolId: 8,
      toolSlug: "story-assistant-server",
      projectId: 10,
      projectSlug: "story-assistant-prod",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });

    repo.findToolBySlug.mockResolvedValue({
      toolId: 8,
      projectId: 10,
      projectSlug: "story-assistant-prod",
      toolStatus: "active",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/client-ticket",
      headers: {
        authorization: "Bearer tt.valid.valid"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.createTicket).toHaveBeenCalledWith({
      sub: "tool:story-assistant-server",
      toolId: 8,
      toolSlug: "story-assistant-server",
      projectId: 10,
      projectSlug: "story-assistant-prod",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });
    expect(response.json()).toEqual({
      ticket: "jwt.ticket.token",
      expiresInMinutes: 5
    });
    await app.close();
  });

  it("returns 403 when tool or project is inactive", async () => {
    const { app, repo } = await buildAuthTestApp();

    repo.findAuthByToolToken.mockResolvedValue({
      mode: "tool",
      toolId: 8,
      toolSlug: "story-assistant-server",
      projectId: 10,
      projectSlug: "story-assistant-prod",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });

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
      url: "/auth/client-ticket",
      headers: {
        authorization: "Bearer tt.valid.valid"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "forbidden",
      message: "Tool or project is inactive"
    });
    await app.close();
  });
});
