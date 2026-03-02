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
    getSessionEmail: vi.fn().mockResolvedValue(null),
    consumeMagicLink: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue("st.test.test")
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
    expect(response.body).toContain("requestMagicLinkForm");
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

  it("verifies admin magic link and redirects to /admin", async () => {
    const { app, authService } = await buildWebAdminTestApp();
    authService.consumeMagicLink.mockResolvedValue({ email: "admin@bbc.co.uk" });
    authService.createSession.mockResolvedValue("st.new.secret");

    const response = await app.inject({
      method: "GET",
      url: "/admin/verify?scope=admin&token=ml.1234567890.abcdef"
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/admin");
    expect(authService.consumeMagicLink).toHaveBeenCalledWith("admin", "ml.1234567890.abcdef");
    expect(authService.createSession).toHaveBeenCalledWith("admin", "admin@bbc.co.uk");
    expect(response.cookies.some((cookieItem) => cookieItem.name === "admin_session")).toBe(true);
    await app.close();
  });

  it("redirects to login with error when verify link is invalid", async () => {
    const { app } = await buildWebAdminTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/admin/verify?scope=admin&token=bad"
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/admin?error=invalid_link");
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
