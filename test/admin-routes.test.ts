import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it, vi } from "vitest";
import { registerAdminRoutes } from "../src/admin/routes.js";
import { sha256 } from "../src/utils/crypto.js";

async function buildAdminTestApp() {
  const app = Fastify();
  await app.register(cookie);

  app.decorate(
    "env",
    {
      adminEmailAllowlist: new Set(["admin@bbc.co.uk"]),
      adminPasswordHash: sha256("shared-admin-password"),
      toolTokenTtlDays: 90
    } as any
  );
  app.decorate("kmsService", { encrypt: vi.fn() } as any);

  const authService = {
    createSession: vi.fn().mockResolvedValue("st.login.secret"),
    getSessionEmail: vi.fn().mockResolvedValue("admin@bbc.co.uk")
  };
  const repo = {
    listProjects: vi.fn().mockResolvedValue([]),
    listTools: vi.fn().mockResolvedValue([])
  };
  const usageService = { audit: vi.fn() };

  registerAdminRoutes(app, {
    authService: authService as any,
    repo: repo as any,
    usageService: usageService as any
  });

  await app.ready();
  return { app, repo, authService };
}

describe("admin login route", () => {
  it("creates admin session for allowlisted email and matching password", async () => {
    const { app, authService } = await buildAdminTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "admin@bbc.co.uk",
        password: "shared-admin-password"
      },
      remoteAddress: "10.0.0.1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(authService.createSession).toHaveBeenCalledWith("admin", "admin@bbc.co.uk");
    expect(response.headers["set-cookie"]).toContain("admin_session=");
    await app.close();
  });

  it("rejects non-allowlisted email", async () => {
    const { app } = await buildAdminTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "someone@bbc.co.uk",
        password: "shared-admin-password"
      },
      remoteAddress: "10.0.0.2"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Invalid admin credentials"
    });
    await app.close();
  });

  it("rejects wrong password", async () => {
    const { app } = await buildAdminTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "admin@bbc.co.uk",
        password: "wrong-password"
      },
      remoteAddress: "10.0.0.3"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Invalid admin credentials"
    });
    await app.close();
  });

  it("returns 400 on invalid payload", async () => {
    const { app } = await buildAdminTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "bad-email",
        password: ""
      },
      remoteAddress: "10.0.0.4"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("bad_request");
    await app.close();
  });

  it("rate limits repeated failed attempts from the same ip", async () => {
    const { app } = await buildAdminTestApp();

    for (let i = 0; i < 5; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/admin/auth/login",
        payload: {
          email: "admin@bbc.co.uk",
          password: "wrong-password"
        },
        remoteAddress: "10.0.0.5"
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "admin@bbc.co.uk",
        password: "wrong-password"
      },
      remoteAddress: "10.0.0.5"
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

describe("admin discovery routes", () => {
  it("requires admin session for GET /admin/projects", async () => {
    const { app } = await buildAdminTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/admin/projects"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Admin session required"
    });
    await app.close();
  });

  it("requires admin session for GET /admin/tools", async () => {
    const { app } = await buildAdminTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/admin/tools"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Admin session required"
    });
    await app.close();
  });

  it("filters projects by slug", async () => {
    const { app, repo } = await buildAdminTestApp();
    repo.listProjects.mockResolvedValue([
      {
        id: 10,
        slug: "story-assistant-prod",
        name: "Story Assistant",
        environment: "prod",
        status: "active",
        ownerEmail: "owner@bbc.co.uk",
        rpmCap: 60,
        dailyTokenCap: 2000000
      }
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/admin/projects?slug=story-assistant-prod",
      headers: {
        cookie: "admin_session=st.fake.fake"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(repo.listProjects).toHaveBeenCalledWith({ slug: "story-assistant-prod" });
    expect(response.json()).toEqual({
      projects: [
        {
          id: 10,
          slug: "story-assistant-prod",
          name: "Story Assistant",
          environment: "prod",
          status: "active",
          ownerEmail: "owner@bbc.co.uk",
          rpmCap: 60,
          dailyTokenCap: 2000000
        }
      ]
    });
    await app.close();
  });

  it("filters tools by slug and projectId", async () => {
    const { app, repo } = await buildAdminTestApp();
    repo.listTools.mockResolvedValue([
      {
        id: 8,
        slug: "story-assistant-server",
        projectId: 10,
        mode: "server",
        status: "active"
      }
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/admin/tools?slug=story-assistant-server&projectId=10",
      headers: {
        cookie: "admin_session=st.fake.fake"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(repo.listTools).toHaveBeenCalledWith({
      slug: "story-assistant-server",
      projectId: 10
    });
    expect(response.json()).toEqual({
      tools: [
        {
          id: 8,
          slug: "story-assistant-server",
          projectId: 10,
          mode: "server",
          status: "active"
        }
      ]
    });
    await app.close();
  });
});
