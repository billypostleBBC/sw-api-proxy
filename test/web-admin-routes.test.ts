import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it, vi } from "vitest";
import { registerWebAdminRoutes } from "../src/web-admin/routes.js";

async function buildWebAdminTestApp() {
  const app = Fastify();
  await app.register(cookie);

  app.decorate(
    "env",
    {
      adminEmailAllowlist: new Set(["admin@bbc.co.uk"])
    } as any
  );

  const authService = {
    getSessionEmail: vi.fn().mockResolvedValue(null)
  };

  registerWebAdminRoutes(app, { authService: authService as any });
  await app.ready();
  return { app, authService };
}

describe("web admin routes", () => {
  it("renders login page when no admin session exists", async () => {
    const { app } = await buildWebAdminTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/admin"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Proxy Admin Login");
    expect(response.body).toContain("adminLoginForm");
    expect(response.body).toContain("adminPassword");
    await app.close();
  });

  it("renders dashboard shell when admin session is valid", async () => {
    const { app, authService } = await buildWebAdminTestApp();
    authService.getSessionEmail.mockResolvedValue("admin@bbc.co.uk");

    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: {
        cookie: "admin_session=st.fake.fake"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Proxy Admin Dashboard");
    expect(response.body).toContain("Signed in as admin@bbc.co.uk");
    expect(response.body).toContain("createProjectForm");
    await app.close();
  });

  it("clears admin cookie on logout", async () => {
    const { app } = await buildWebAdminTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/admin/logout"
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/admin?error=signed_out");
    expect(response.headers["set-cookie"]).toContain("admin_session=");
    await app.close();
  });
});
