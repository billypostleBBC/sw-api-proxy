import { z } from "zod";
import { sendError } from "../utils/http.js";
import { AuthService } from "./service.js";
const requestSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({ token: z.string().min(10) });
const ticketSchema = z.object({ toolSlug: z.string().min(1) });
export function registerAuthRoutes(app, deps) {
    app.post("/auth/magic-link/request", async (request, reply) => {
        const parsed = requestSchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid email input");
        }
        const email = parsed.data.email.toLowerCase();
        const linkToken = await deps.authService.createMagicLink("user", email);
        const link = `${deps.appBaseUrl}/auth/verify?scope=user&token=${encodeURIComponent(linkToken.token)}`;
        await app.emailService.sendMagicLink(email, link, "user");
        return reply.code(204).send();
    });
    app.post("/auth/magic-link/verify", async (request, reply) => {
        const parsed = verifySchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid token input");
        }
        const consumed = await deps.authService.consumeMagicLink("user", parsed.data.token);
        if (!consumed) {
            return sendError(reply, 401, "unauthorized", "Magic link is invalid or expired");
        }
        await deps.repo.upsertUser(consumed.email);
        const sessionToken = await deps.authService.createSession("user", consumed.email);
        AuthService.setSessionCookie(reply, "user", sessionToken);
        return reply.send({ ok: true });
    });
    app.post("/auth/client-ticket", async (request, reply) => {
        const session = AuthService.getSessionFromCookie(request, "user");
        if (!session) {
            return sendError(reply, 401, "unauthorized", "User session is required");
        }
        const email = await deps.authService.getSessionEmail("user", session);
        if (!email) {
            return sendError(reply, 401, "unauthorized", "Invalid user session");
        }
        const parsed = ticketSchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid tool slug");
        }
        const tool = await deps.repo.findToolBySlug(parsed.data.toolSlug);
        if (!tool || tool.toolStatus !== "active" || tool.projectStatus !== "active") {
            return sendError(reply, 403, "forbidden", "Tool or project is inactive");
        }
        const ticket = await deps.ticketService.createTicket({
            sub: email,
            toolId: tool.toolId,
            toolSlug: parsed.data.toolSlug,
            projectId: tool.projectId,
            projectSlug: tool.projectSlug,
            rpmCap: tool.rpmCap,
            dailyTokenCap: tool.dailyTokenCap
        });
        return reply.send({ ticket, expiresInMinutes: 5 });
    });
}
