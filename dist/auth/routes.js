import { sendError } from "../utils/http.js";
export function registerAuthRoutes(app, deps) {
    app.post("/auth/client-ticket", async (request, reply) => {
        if (request.body !== undefined && request.body !== null) {
            return sendError(reply, 400, "bad_request", "Request body is not allowed");
        }
        const auth = request.headers.authorization;
        if (!auth?.startsWith("Bearer ")) {
            return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
        }
        const token = auth.slice("Bearer ".length).trim();
        const toolAuth = await deps.repo.findAuthByToolToken(token);
        if (!toolAuth) {
            return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
        }
        const tool = await deps.repo.findToolBySlug(toolAuth.toolSlug);
        if (!tool || tool.toolStatus !== "active" || tool.projectStatus !== "active") {
            return sendError(reply, 403, "forbidden", "Tool or project is inactive");
        }
        const ticket = await deps.ticketService.createTicket({
            sub: `tool:${toolAuth.toolSlug}`,
            toolId: toolAuth.toolId,
            toolSlug: toolAuth.toolSlug,
            projectId: toolAuth.projectId,
            projectSlug: toolAuth.projectSlug,
            rpmCap: toolAuth.rpmCap,
            dailyTokenCap: toolAuth.dailyTokenCap
        });
        return reply.send({ ticket, expiresInMinutes: app.env.clientTicketTtlMinutes });
    });
}
