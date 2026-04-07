import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthService } from "../auth/service.js";
import { LoginRateLimiter } from "../auth/login-rate-limit.js";
import { LimitService } from "../limits/service.js";
import { responsesSchema, sendResponsesRequest } from "../openai/responses.js";
import { UsageService } from "../usage/service.js";
import { sendError } from "../utils/http.js";
import { safeEqualHex, sha256 } from "../utils/crypto.js";
import type { AuthContext } from "../db/types.js";
import { resolveRelayAuth } from "./auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

function hasAllowedRelayDomain(email: string, domains: Set<string>): boolean {
  const domain = email.toLowerCase().trim().split("@")[1];
  return Boolean(domain && domains.has(domain));
}

function assertRelayTargetActive(
  reply: Parameters<typeof sendError>[0],
  auth: Pick<AuthContext, "toolStatus" | "projectStatus">
): boolean {
  if (auth.toolStatus !== "active") {
    sendError(reply, 403, "forbidden", "Tool is inactive");
    return false;
  }
  if (auth.projectStatus !== "active") {
    sendError(reply, 403, "forbidden", "Project is inactive");
    return false;
  }
  return true;
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
    const auth = await resolveRelayAuth(request, app.repo, deps.authService);
    if (!auth) {
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

    if (auth.kind === "relay_token") {
      if (auth.auth.toolSlug !== toolSlug) {
        return sendError(reply, 403, "forbidden", "Relay token does not match tool");
      }
      if (!assertRelayTargetActive(reply, auth.auth)) {
        return;
      }

      return sendResponsesRequest(
        app,
        reply,
        deps,
        {
          toolId: auth.auth.toolId,
          projectId: auth.auth.projectId,
          projectStatus: auth.auth.projectStatus,
          rpmCap: auth.auth.rpmCap,
          dailyTokenCap: auth.auth.dailyTokenCap
        },
        parsedBody.data
      );
    }

    const tool = await app.repo.findToolBySlug(toolSlug);
    if (!tool) {
      return sendError(reply, 404, "not_found", "Tool not found");
    }
    if (!assertRelayTargetActive(reply, tool)) {
      return;
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
