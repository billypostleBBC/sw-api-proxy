import { createHash } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it, vi } from "vitest";
import { registerAdminRoutes } from "../src/admin/routes.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function buildAdminTestApp() {
  const app = Fastify();
  await app.register(cookie);

  app.decorate(
    "env",
    {
      adminEmailAllowlist: new Set(["admin@bbc.co.uk"]),
      adminPassword: "super-secret-pass",
      toolTokenTtlDays: 90
    } as any
  );
  app.decorate("kmsService", { encrypt: vi.fn() } as any);

  const authService = {
    createSession: vi.fn().mockResolvedValue("st.created.secret"),
    getSessionEmail: vi.fn().mockResolvedValue("admin@bbc.co.uk")
  };
  const repo = {
    getAdminPasswordHash: vi.fn().mockResolvedValue(sha256("correct-password")),
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

describe("admin discovery routes", () => {
  it("logs in with allowlisted email + password", async () => {
    const { app, authService } = await buildAdminTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "admin@bbc.co.uk",
        password: "super-secret-pass"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(authService.createSession).toHaveBeenCalledWith("admin", "admin@bbc.co.uk");
    expect(response.cookies.some((cookieItem) => cookieItem.name === "admin_session")).toBe(true);
    await app.close();
  });

  it("rejects invalid admin credentials", async () => {
    const { app } = await buildAdminTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: {
        email: "admin@bbc.co.uk",
        password: "wrong-password"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Invalid admin credentials"
    });
    await app.close();
  });

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
