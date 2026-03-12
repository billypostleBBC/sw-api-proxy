import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthService } from "../auth/service.js";
import { LoginRateLimiter } from "../auth/login-rate-limit.js";
import { LimitService } from "../limits/service.js";
import { responsesSchema, sendResponsesRequest } from "../openai/responses.js";
import { UsageService } from "../usage/service.js";
import { sendError } from "../utils/http.js";
import { safeEqualHex, sha256 } from "../utils/crypto.js";
import { resolveRelaySessionEmail } from "./auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

function hasAllowedRelayDomain(email: string, domains: Set<string>): boolean {
  const domain = email.toLowerCase().trim().split("@")[1];
  return Boolean(domain && domains.has(domain));
}

export function registerRelayRoutes(
  app: FastifyInstance,
  deps: { authService: AuthService; limitService: LimitService; usageService: UsageService }
): void {
  const loginRateLimiter = new LoginRateLimiter();

  app.post("/v1/auth/login", async (request, reply) => {
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
    const emailAllowed = hasAllowedRelayDomain(email, app.env.relayEmailDomainAllowlist ?? new Set());
    const suppliedPasswordHash = sha256(parsed.data.password);
    const passwordValid = safeEqualHex(app.env.relayPasswordHash ?? "", suppliedPasswordHash);
    if (!emailAllowed || !passwordValid) {
      loginRateLimiter.recordFailure(ip, nowMs);
      return sendError(reply, 401, "unauthorized", "Invalid relay credentials");
    }

    const session = await deps.authService.createSessionWithExpiry("user", email);
    loginRateLimiter.clear(ip);

    await deps.usageService.audit({
      actorEmail: email,
      actorScope: "user",
      action: "relay.session.created",
      targetType: "session",
      targetId: session.id,
      metadata: { expiresAt: session.expiresAt.toISOString() }
    });

    return reply.send({
      token: session.token,
      expiresAt: session.expiresAt.toISOString()
    });
  });

  app.post("/v1/tools/:toolSlug/responses", async (request, reply) => {
    const email = await resolveRelaySessionEmail(request, deps.authService);
    if (!email) {
      return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
    }

    const parsedBody = responsesSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, 400, "bad_request", "Invalid responses payload", { issues: parsedBody.error.issues });
    }

    const toolSlug = String((request.params as { toolSlug?: string }).toolSlug ?? "").trim();
    if (!toolSlug) {
      return sendError(reply, 400, "bad_request", "Invalid tool slug");
    }

    const tool = await app.repo.findToolBySlug(toolSlug);
    if (!tool) {
      return sendError(reply, 404, "not_found", "Tool not found");
    }
    if (tool.toolStatus !== "active") {
      return sendError(reply, 403, "forbidden", "Tool is inactive");
    }

    return sendResponsesRequest(
      app,
      reply,
      deps,
      {
        toolId: tool.toolId,
        projectId: tool.projectId,
        projectStatus: tool.projectStatus,
        rpmCap: tool.rpmCap,
        dailyTokenCap: tool.dailyTokenCap
      },
      parsedBody.data
    );
  });
}
