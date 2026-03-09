import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAuthRoutes } from "../src/auth/routes.js";

async function buildAuthRouteApp() {
  const app = Fastify();

  app.decorate(
    "env",
    {
      clientTicketTtlMinutes: 5
    } as any
  );

  const repo = {
    findAuthByToolToken: vi.fn().mockResolvedValue(null)
  };
  const ticketService = {
    createTicket: vi.fn().mockResolvedValue("ticket.jwt.value")
  };

  registerAuthRoutes(app, {
    repo: repo as any,
    ticketService: ticketService as any
  });

  await app.ready();
  return { app, repo, ticketService };
}

describe("auth routes", () => {
  it("requires tool bearer token for client ticket", async () => {
    const { app } = await buildAuthRouteApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/client-ticket"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Tool bearer token is required"
    });
    await app.close();
  });

  it("rejects invalid tool bearer token", async () => {
    const { app, repo } = await buildAuthRouteApp();
    repo.findAuthByToolToken.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/auth/client-ticket",
      headers: {
        authorization: "Bearer tt.invalid.token"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Invalid or expired tool bearer token"
    });
    await app.close();
  });

  it("issues ticket from valid tool bearer token", async () => {
    const { app, repo, ticketService } = await buildAuthRouteApp();
    repo.findAuthByToolToken.mockResolvedValue({
      mode: "tool",
      toolId: 9,
      toolSlug: "story-assistant",
      projectId: 3,
      projectSlug: "storyworks-prod",
      projectStatus: "active",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/client-ticket",
      headers: {
        authorization: "Bearer tt.valid.token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(ticketService.createTicket).toHaveBeenCalledWith({
      sub: "tool:9",
      toolId: 9,
      toolSlug: "story-assistant",
      projectId: 3,
      projectSlug: "storyworks-prod",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });
    expect(response.json()).toEqual({
      ticket: "ticket.jwt.value",
      expiresInMinutes: 5
    });

    await app.close();
  });
});
