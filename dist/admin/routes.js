import { z } from "zod";
import { sendError } from "../utils/http.js";
import { AuthService } from "../auth/service.js";
import { safeEqualHex, sha256 } from "../utils/crypto.js";
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const createProjectSchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    environment: z.string().min(1),
    ownerEmail: z.string().email(),
    dailyTokenCap: z.number().int().positive(),
    rpmCap: z.number().int().positive()
});
const setKeySchema = z.object({ provider: z.literal("openai"), apiKey: z.string().min(10) });
const createToolSchema = z.object({
    slug: z.string().min(1),
    projectId: z.number().int().positive(),
    mode: z.enum(["server", "browser", "both"])
});
const projectsQuerySchema = z.object({
    slug: z.string().min(1).optional()
});
const toolsQuerySchema = z.object({
    slug: z.string().min(1).optional(),
    projectId: z.coerce.number().int().positive().optional()
});
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginFailuresByIp = new Map();
function normalizeIp(ip) {
    const trimmed = (ip ?? "").trim();
    return trimmed || "unknown";
}
function getLoginRateLimitState(ip, nowMs) {
    const existing = loginFailuresByIp.get(ip);
    if (!existing) {
        return { limited: false, retryAfterSeconds: 0 };
    }
    if (nowMs - existing.windowStartMs >= LOGIN_WINDOW_MS) {
        loginFailuresByIp.delete(ip);
        return { limited: false, retryAfterSeconds: 0 };
    }
    if (existing.count < LOGIN_MAX_ATTEMPTS) {
        return { limited: false, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartMs + LOGIN_WINDOW_MS - nowMs) / 1000));
    return { limited: true, retryAfterSeconds };
}
function recordLoginFailure(ip, nowMs) {
    const existing = loginFailuresByIp.get(ip);
    if (!existing || nowMs - existing.windowStartMs >= LOGIN_WINDOW_MS) {
        loginFailuresByIp.set(ip, { count: 1, windowStartMs: nowMs });
        return;
    }
    existing.count += 1;
    loginFailuresByIp.set(ip, existing);
}
function clearLoginFailures(ip) {
    loginFailuresByIp.delete(ip);
}
async function requireAdmin(app, request, authService) {
    const token = AuthService.getSessionFromCookie(request, "admin");
    if (!token) {
        return null;
    }
    const email = await authService.getSessionEmail("admin", token);
    if (!email) {
        return null;
    }
    return app.env.adminEmailAllowlist.has(email.toLowerCase()) ? email : null;
}
export function registerAdminRoutes(app, deps) {
    app.post("/admin/auth/login", async (request, reply) => {
        const ip = normalizeIp(request.ip);
        const nowMs = Date.now();
        const rateLimit = getLoginRateLimitState(ip, nowMs);
        if (rateLimit.limited) {
            return sendError(reply, 429, "rate_limit_exceeded", "Too many login attempts", {
                retryAfterSeconds: rateLimit.retryAfterSeconds
            });
        }
        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success) {
            recordLoginFailure(ip, nowMs);
            return sendError(reply, 400, "bad_request", "Invalid login payload", { issues: parsed.error.issues });
        }
        const email = parsed.data.email.toLowerCase().trim();
        const emailAllowed = app.env.adminEmailAllowlist.has(email);
        const expectedPasswordHash = app.env.adminPasswordHash;
        const suppliedPasswordHash = sha256(parsed.data.password);
        const passwordValid = safeEqualHex(expectedPasswordHash, suppliedPasswordHash);
        if (!emailAllowed || !passwordValid) {
            recordLoginFailure(ip, nowMs);
            return sendError(reply, 401, "unauthorized", "Invalid admin credentials");
        }
        const sessionToken = await deps.authService.createSession("admin", email);
        AuthService.setSessionCookie(reply, "admin", sessionToken);
        clearLoginFailures(ip);
        return reply.send({ ok: true });
    });
    app.post("/admin/projects", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const parsed = createProjectSchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid project payload", { issues: parsed.error.issues });
        }
        const created = await deps.repo.createProject(parsed.data);
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "project.created",
            targetType: "project",
            targetId: String(created.id),
            metadata: parsed.data
        });
        return reply.code(201).send({ id: created.id });
    });
    app.post("/admin/projects/:projectId/keys", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const projectId = Number(request.params.projectId);
        if (!Number.isFinite(projectId) || projectId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid project id");
        }
        const parsed = setKeySchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid key payload");
        }
        const ciphertext = await app.kmsService.encrypt(parsed.data.apiKey);
        await deps.repo.setActiveProjectKey({
            projectId,
            provider: parsed.data.provider,
            kmsCiphertext: ciphertext,
            keySuffix: AuthService.keySuffix(parsed.data.apiKey),
            adminEmail: actorEmail
        });
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "project.key.rotated",
            targetType: "project",
            targetId: String(projectId),
            metadata: { provider: parsed.data.provider }
        });
        return reply.code(201).send({ ok: true });
    });
    app.post("/admin/tools", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const parsed = createToolSchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid tool payload", { issues: parsed.error.issues });
        }
        const created = await deps.repo.createTool(parsed.data);
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.created",
            targetType: "tool",
            targetId: String(created.id),
            metadata: parsed.data
        });
        return reply.code(201).send({ id: created.id });
    });
    app.post("/admin/tools/:toolId/tokens", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const toolId = Number(request.params.toolId);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const generated = AuthService.makeToolToken();
        const expiresAt = new Date(Date.now() + app.env.toolTokenTtlDays * 24 * 60 * 60_000);
        await deps.repo.createToolToken({
            tokenId: generated.tokenId,
            tokenHash: generated.tokenHash,
            toolId,
            expiresAt
        });
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.token.created",
            targetType: "tool_token",
            targetId: generated.tokenId,
            metadata: { toolId, expiresAt: expiresAt.toISOString() }
        });
        return reply.code(201).send({ token: generated.token, expiresAt: expiresAt.toISOString() });
    });
    app.post("/admin/tools/:toolId/tokens/:tokenId/revoke", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const { tokenId } = request.params;
        await deps.repo.revokeToolToken(tokenId);
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.token.revoked",
            targetType: "tool_token",
            targetId: tokenId,
            metadata: {}
        });
        return reply.send({ ok: true });
    });
    app.get("/admin/projects", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const parsed = projectsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid query", { issues: parsed.error.issues });
        }
        const projects = await deps.repo.listProjects({
            slug: parsed.data.slug
        });
        return reply.send({ projects });
    });
    app.get("/admin/tools", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const parsed = toolsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return sendError(reply, 400, "bad_request", "Invalid query", { issues: parsed.error.issues });
        }
        const tools = await deps.repo.listTools({
            slug: parsed.data.slug,
            projectId: parsed.data.projectId
        });
        return reply.send({ tools });
    });
    app.get("/admin/usage", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const query = request.query;
        const projectId = query.projectId ? Number(query.projectId) : undefined;
        const usage = await deps.repo.getUsage(projectId, query.from, query.to);
        return reply.send({ usage });
    });
}
