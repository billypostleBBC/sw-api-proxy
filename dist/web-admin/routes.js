import { AuthService } from "../auth/service.js";
export function registerWebAdminRoutes(app, deps) {
    app.get("/admin", async (request, reply) => {
        const session = AuthService.getSessionFromCookie(request, "admin");
        if (!session) {
            return reply.type("text/html").send(`<!doctype html><html><body>
        <h1>Proxy Admin Login</h1>
        <p>POST /admin/auth/magic-link/request with your BBC admin email.</p>
      </body></html>`);
        }
        const email = await deps.authService.getSessionEmail("admin", session);
        if (!email) {
            return reply.type("text/html").send(`<!doctype html><html><body><h1>Session expired</h1></body></html>`);
        }
        return reply.type("text/html").send(`<!doctype html><html><body>
      <h1>Proxy Admin</h1>
      <p>Signed in as ${email}</p>
      <ul>
        <li>Create project: POST /admin/projects</li>
        <li>Rotate key: POST /admin/projects/:projectId/keys</li>
        <li>Create tool: POST /admin/tools</li>
        <li>Create tool token: POST /admin/tools/:toolId/tokens</li>
        <li>Usage report: GET /admin/usage</li>
      </ul>
    </body></html>`);
    });
}
