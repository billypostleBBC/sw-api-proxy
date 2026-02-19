import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../utils/http.js";
import { AuthService } from "../auth/service.js";
import type { Repo } from "../db/repo.js";
import { UsageService } from "../usage/service.js";

const requestMagicLinkSchema = z.object({ email: z.string().email() });
const verifyMagicLinkSchema = z.object({ token: z.string().min(10) });
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

async function requireAdmin(
  app: FastifyInstance,
  request: Parameters<FastifyInstance["route"]>[0]["handler"] extends (
    req: infer Req,
    ...args: never[]
  ) => unknown
    ? Req
    : never,
  authService: AuthService
): Promise<string | null> {
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

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: {
    authService: AuthService;
    repo: Repo;
    usageService: UsageService;
    appBaseUrl: string;
  }
): void {
  app.post("/admin/auth/magic-link/request", async (request, reply) => {
    const parsed = requestMagicLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(204).send();
    }

    const email = parsed.data.email.toLowerCase();
    if (!app.env.adminEmailAllowlist.has(email)) {
      return reply.code(204).send();
    }

    const linkToken = await deps.authService.createMagicLink("admin", email);
    const link = `${deps.appBaseUrl}/admin/verify?scope=admin&token=${encodeURIComponent(linkToken.token)}`;
    await app.emailService.sendMagicLink(email, link, "admin");

    return reply.code(204).send();
  });

  app.post("/admin/auth/magic-link/verify", async (request, reply) => {
    const parsed = verifyMagicLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "bad_request", "Invalid token input");
    }

    const consumed = await deps.authService.consumeMagicLink("admin", parsed.data.token);
    if (!consumed || !app.env.adminEmailAllowlist.has(consumed.email.toLowerCase())) {
      return sendError(reply, 401, "unauthorized", "Magic link is invalid or expired");
    }

    const sessionToken = await deps.authService.createSession("admin", consumed.email);
    AuthService.setSessionCookie(reply, "admin", sessionToken);
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

    const projectId = Number((request.params as { projectId: string }).projectId);
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

    const toolId = Number((request.params as { toolId: string }).toolId);
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

    const { tokenId } = request.params as { toolId: string; tokenId: string };
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

  app.get("/admin/usage", async (request, reply) => {
    const actorEmail = await requireAdmin(app, request, deps.authService);
    if (!actorEmail) {
      return sendError(reply, 401, "unauthorized", "Admin session required");
    }

    const query = request.query as { projectId?: string; from?: string; to?: string };
    const projectId = query.projectId ? Number(query.projectId) : undefined;

    const usage = await deps.repo.getUsage(projectId, query.from, query.to);
    return reply.send({ usage });
  });
}
