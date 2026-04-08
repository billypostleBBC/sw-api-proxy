import { z } from "zod";
import { sendError } from "../utils/http.js";
import { AuthService } from "../auth/service.js";
import { LoginRateLimiter } from "../auth/login-rate-limit.js";
import { buildRelayResponsesUrl } from "../relay/url.js";
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
    slug: z.string().min(1).optional(),
    includeInactive: z.enum(["true", "false"]).optional().transform((value) => value === "true")
});
const toolsQuerySchema = z.object({
    slug: z.string().min(1).optional(),
    projectId: z.coerce.number().int().positive().optional(),
    includeInactive: z.enum(["true", "false"]).optional().transform((value) => value === "true")
});
function relayResponseForTool(baseUrl, tool) {
    return {
        relayResponsesUrl: buildRelayResponsesUrl(baseUrl, tool.slug)
    };
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
    return app.env.adminEmailAllowlist?.has(email.toLowerCase()) ? email : null;
}
export function registerAdminRoutes(app, deps) {
    const loginRateLimiter = new LoginRateLimiter();
    app.post("/admin/auth/login", async (request, reply) => {
        const ip = loginRateLimiter.normalizeKey(request.ip);
        const nowMs = Date.now();
        const rateLimit = loginRateLimiter.getState(ip, nowMs);
        if (rateLimit.limited) {
            return sendError(reply, 429, "rate_limit_exceeded", "Too many login attempts", {
                retryAfterSeconds: rateLimit.retryAfterSeconds
            });
        }
        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success) {
            loginRateLimiter.recordFailure(ip, nowMs);
            return sendError(reply, 400, "bad_request", "Invalid login payload", { issues: parsed.error.issues });
        }
        const email = parsed.data.email.toLowerCase().trim();
        const emailAllowed = app.env.adminEmailAllowlist?.has(email) ?? false;
        const expectedPasswordHash = app.env.adminPasswordHash ?? "";
        const suppliedPasswordHash = sha256(parsed.data.password);
        const passwordValid = safeEqualHex(expectedPasswordHash, suppliedPasswordHash);
        if (!emailAllowed || !passwordValid) {
            loginRateLimiter.recordFailure(ip, nowMs);
            return sendError(reply, 401, "unauthorized", "Invalid admin credentials");
        }
        const sessionToken = await deps.authService.createSession("admin", email);
        AuthService.setSessionCookie(reply, "admin", sessionToken);
        loginRateLimiter.clear(ip);
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
        return reply.code(201).send({
            id: created.id,
            ...relayResponseForTool(app.env.relayPublicBaseUrl, { slug: parsed.data.slug })
        });
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
        const tool = await deps.repo.getToolById(toolId);
        if (!tool) {
            return sendError(reply, 404, "not_found", "Tool not found");
        }
        const generated = AuthService.makeToolToken();
        const expiresAt = new Date(Date.now() + app.env.toolTokenTtlDays * 24 * 60 * 60_000);
        await deps.repo.createToolToken({
            tokenId: generated.tokenId,
            tokenHash: generated.tokenHash,
            toolId,
            expiresAt,
            scope: "proxy"
        });
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.token.created",
            targetType: "tool_token",
            targetId: generated.tokenId,
            metadata: { toolId, expiresAt: expiresAt.toISOString() }
        });
        return reply.code(201).send({
            token: generated.token,
            expiresAt: expiresAt.toISOString(),
            ...relayResponseForTool(app.env.relayPublicBaseUrl, tool)
        });
    });
    app.post("/admin/tools/:toolId/relay-tokens", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const toolId = Number(request.params.toolId);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const tool = await deps.repo.getToolById(toolId);
        if (!tool) {
            return sendError(reply, 404, "not_found", "Tool not found");
        }
        const generated = AuthService.makeRelayToken();
        const expiresAt = new Date(Date.now() + app.env.toolTokenTtlDays * 24 * 60 * 60_000);
        await deps.repo.createToolToken({
            tokenId: generated.tokenId,
            tokenHash: generated.tokenHash,
            toolId,
            expiresAt,
            scope: "relay"
        });
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.relay_token.created",
            targetType: "tool_token",
            targetId: generated.tokenId,
            metadata: { toolId, expiresAt: expiresAt.toISOString(), scope: "relay" }
        });
        return reply.code(201).send({
            token: generated.token,
            expiresAt: expiresAt.toISOString(),
            ...relayResponseForTool(app.env.relayPublicBaseUrl, tool)
        });
    });
    app.post("/admin/tools/:toolId/tokens/:tokenId/revoke", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const { toolId: toolIdRaw, tokenId } = request.params;
        const toolId = Number(toolIdRaw);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const revoked = await deps.repo.revokeToolToken(toolId, tokenId, "proxy");
        if (!revoked) {
            return sendError(reply, 404, "not_found", "Tool token not found");
        }
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.token.revoked",
            targetType: "tool_token",
            targetId: tokenId,
            metadata: { toolId }
        });
        return reply.send({ ok: true });
    });
    app.post("/admin/tools/:toolId/relay-tokens/:tokenId/revoke", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const { toolId: toolIdRaw, tokenId } = request.params;
        const toolId = Number(toolIdRaw);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const revoked = await deps.repo.revokeToolToken(toolId, tokenId, "relay");
        if (!revoked) {
            return sendError(reply, 404, "not_found", "Relay token not found");
        }
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.relay_token.revoked",
            targetType: "tool_token",
            targetId: tokenId,
            metadata: { toolId, scope: "relay" }
        });
        return reply.send({ ok: true });
    });
    app.delete("/admin/tools/:toolId/tokens/:tokenId", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const { toolId: toolIdRaw, tokenId } = request.params;
        const toolId = Number(toolIdRaw);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const revoked = await deps.repo.revokeToolToken(toolId, tokenId, "proxy");
        if (!revoked) {
            return sendError(reply, 404, "not_found", "Tool token not found");
        }
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.token.revoked",
            targetType: "tool_token",
            targetId: tokenId,
            metadata: { toolId }
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
            slug: parsed.data.slug,
            includeInactive: parsed.data.includeInactive
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
            projectId: parsed.data.projectId,
            includeInactive: parsed.data.includeInactive
        });
        return reply.send({
            tools: tools.map((tool) => ({
                ...tool,
                ...relayResponseForTool(app.env.relayPublicBaseUrl, tool)
            }))
        });
    });
    app.get("/admin/tools/:toolId/tokens", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const toolId = Number(request.params.toolId);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const tool = await deps.repo.getToolById(toolId);
        if (!tool) {
            return sendError(reply, 404, "not_found", "Tool not found");
        }
        const tokens = await deps.repo.listToolTokens(toolId, "proxy");
        return reply.send({ tokens });
    });
    app.get("/admin/tools/:toolId/relay-tokens", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const toolId = Number(request.params.toolId);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const tool = await deps.repo.getToolById(toolId);
        if (!tool) {
            return sendError(reply, 404, "not_found", "Tool not found");
        }
        const tokens = await deps.repo.listToolTokens(toolId, "relay");
        return reply.send({ tokens });
    });
    app.delete("/admin/tools/:toolId", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const toolId = Number(request.params.toolId);
        if (!Number.isFinite(toolId) || toolId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid tool id");
        }
        const result = await deps.repo.deactivateTool(toolId);
        if (!result) {
            return sendError(reply, 404, "not_found", "Tool not found");
        }
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "tool.deleted",
            targetType: "tool",
            targetId: String(toolId),
            metadata: result
        });
        return reply.send({ ok: true, tokensRevoked: result.tokensRevoked });
    });
    app.delete("/admin/projects/:projectId", async (request, reply) => {
        const actorEmail = await requireAdmin(app, request, deps.authService);
        if (!actorEmail) {
            return sendError(reply, 401, "unauthorized", "Admin session required");
        }
        const projectId = Number(request.params.projectId);
        if (!Number.isFinite(projectId) || projectId < 1) {
            return sendError(reply, 400, "bad_request", "Invalid project id");
        }
        const result = await deps.repo.deactivateProject(projectId);
        if (!result) {
            return sendError(reply, 404, "not_found", "Project not found");
        }
        await deps.usageService.audit({
            actorEmail,
            actorScope: "admin",
            action: "project.deleted",
            targetType: "project",
            targetId: String(projectId),
            metadata: result
        });
        return reply.send({
            ok: true,
            toolsDeactivated: result.toolsDeactivated,
            tokensRevoked: result.tokensRevoked
        });
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
