import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../utils/http.js";
import { resolveProxyAuth } from "./auth.js";
import { LimitService } from "../limits/service.js";
import { UsageService } from "../usage/service.js";

const responsesSchema = z.object({ model: z.string().min(1) }).passthrough();
const embeddingsSchema = z.object({ model: z.string().min(1), input: z.any() }).passthrough();

function extractUsage(data: any): { inputTokens: number | null; outputTokens: number | null } {
  const usage = data?.usage;
  if (!usage || typeof usage !== "object") {
    return { inputTokens: null, outputTokens: null };
  }
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null
  };
}

export function registerProxyRoutes(
  app: FastifyInstance,
  deps: { limitService: LimitService; usageService: UsageService }
): void {
  app.post("/proxy/v1/responses", async (request, reply) => {
    const parsedBody = responsesSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, 400, "bad_request", "Invalid responses payload", { issues: parsedBody.error.issues });
    }

    const auth = await resolveProxyAuth(request, app.repo, app.ticketService);
    if (!auth) {
      return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
    }
    if (auth.projectStatus !== "active") {
      return sendError(reply, 403, "forbidden", "Project is inactive");
    }

    try {
      await deps.limitService.enforce(auth.projectId, auth.rpmCap, auth.dailyTokenCap);
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
        return sendError(reply, 429, "rate_limit_exceeded", "Project RPM cap exceeded", { retryAfterSeconds: 60 });
      }
      if (error instanceof Error && error.message === "DAILY_TOKEN_CAP_EXCEEDED") {
        return sendError(reply, 403, "token_cap_exceeded", "Project daily token cap exceeded");
      }
      throw error;
    }

    const key = await app.repo.getActiveProjectKey(auth.projectId);
    if (!key) {
      return sendError(reply, 403, "forbidden", "No active API key for project");
    }

    const start = Date.now();
    const apiKey = await app.kmsService.decrypt(key.kmsCiphertext);
    const upstream = await app.openaiClient.request("/v1/responses", apiKey, parsedBody.data);
    const text = await upstream.text();

    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    const latencyMs = Date.now() - start;
    const usage = extractUsage(data);

    await deps.usageService.log({
      projectId: auth.projectId,
      toolId: auth.toolId,
      endpoint: "/v1/responses",
      model: parsedBody.data.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: null,
      statusCode: upstream.status,
      latencyMs
    });

    if (!upstream.ok) {
      return reply.code(502).send({
        error: "upstream_error",
        message: "OpenAI request failed",
        details: {
          status: upstream.status,
          upstream: data
        }
      });
    }

    return reply.code(200).send(data);
  });

  app.post("/proxy/v1/embeddings", async (request, reply) => {
    const parsedBody = embeddingsSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendError(reply, 400, "bad_request", "Invalid embeddings payload", { issues: parsedBody.error.issues });
    }

    const auth = await resolveProxyAuth(request, app.repo, app.ticketService);
    if (!auth) {
      return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
    }

    try {
      await deps.limitService.enforce(auth.projectId, auth.rpmCap, auth.dailyTokenCap);
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
        return sendError(reply, 429, "rate_limit_exceeded", "Project RPM cap exceeded", { retryAfterSeconds: 60 });
      }
      if (error instanceof Error && error.message === "DAILY_TOKEN_CAP_EXCEEDED") {
        return sendError(reply, 403, "token_cap_exceeded", "Project daily token cap exceeded");
      }
      throw error;
    }

    const key = await app.repo.getActiveProjectKey(auth.projectId);
    if (!key) {
      return sendError(reply, 403, "forbidden", "No active API key for project");
    }

    const start = Date.now();
    const apiKey = await app.kmsService.decrypt(key.kmsCiphertext);
    const upstream = await app.openaiClient.request("/v1/embeddings", apiKey, parsedBody.data);
    const data = await upstream.json().catch(() => ({}));

    await deps.usageService.log({
      projectId: auth.projectId,
      toolId: auth.toolId,
      endpoint: "/v1/embeddings",
      model: parsedBody.data.model,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      statusCode: upstream.status,
      latencyMs: Date.now() - start
    });

    if (!upstream.ok) {
      return reply.code(502).send({
        error: "upstream_error",
        message: "OpenAI request failed",
        details: { status: upstream.status, upstream: data }
      });
    }

    return reply.send(data);
  });

  app.get("/proxy/v1/models", async (request, reply) => {
    const auth = await resolveProxyAuth(request, app.repo, app.ticketService);
    if (!auth) {
      return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
    }

    const key = await app.repo.getActiveProjectKey(auth.projectId);
    if (!key) {
      return sendError(reply, 403, "forbidden", "No active API key for project");
    }

    const start = Date.now();
    const apiKey = await app.kmsService.decrypt(key.kmsCiphertext);
    const upstream = await app.openaiClient.request("/v1/models", apiKey);
    const data = await upstream.json().catch(() => ({}));

    await deps.usageService.log({
      projectId: auth.projectId,
      toolId: auth.toolId,
      endpoint: "/v1/models",
      model: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      statusCode: upstream.status,
      latencyMs: Date.now() - start
    });

    if (!upstream.ok) {
      return reply.code(502).send({
        error: "upstream_error",
        message: "OpenAI request failed",
        details: { status: upstream.status, upstream: data }
      });
    }

    return reply.send(data);
  });
}
