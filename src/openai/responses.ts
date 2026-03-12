import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { LimitService } from "../limits/service.js";
import { UsageService } from "../usage/service.js";
import { sendError } from "../utils/http.js";

export const responsesSchema = z.object({ model: z.string().min(1) }).passthrough();

type ResponsesContext = {
  toolId: number;
  projectId: number;
  projectStatus: string;
  rpmCap: number;
  dailyTokenCap: number;
};

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

async function enforceLimits(
  reply: FastifyReply,
  limitService: LimitService,
  context: ResponsesContext
): Promise<FastifyReply | null> {
  try {
    await limitService.enforce(context.projectId, context.rpmCap, context.dailyTokenCap);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMIT_EXCEEDED") {
      return sendError(reply, 429, "rate_limit_exceeded", "Project RPM cap exceeded", { retryAfterSeconds: 60 });
    }
    if (error instanceof Error && error.message === "DAILY_TOKEN_CAP_EXCEEDED") {
      return sendError(reply, 403, "token_cap_exceeded", "Project daily token cap exceeded");
    }
    throw error;
  }
}

export async function sendResponsesRequest(
  app: FastifyInstance,
  reply: FastifyReply,
  deps: { limitService: LimitService; usageService: UsageService },
  context: ResponsesContext,
  payload: z.infer<typeof responsesSchema>
): Promise<FastifyReply> {
  if (context.projectStatus !== "active") {
    return sendError(reply, 403, "forbidden", "Project is inactive");
  }

  const limitReply = await enforceLimits(reply, deps.limitService, context);
  if (limitReply) {
    return limitReply;
  }

  const key = await app.repo.getActiveProjectKey(context.projectId);
  if (!key) {
    return sendError(reply, 403, "forbidden", "No active API key for project");
  }

  const start = Date.now();
  const apiKey = await app.kmsService.decrypt(key.kmsCiphertext);
  const upstream = await app.openaiClient.request("/v1/responses", apiKey, payload);
  const text = await upstream.text();

  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  const usage = extractUsage(data);

  await deps.usageService.log({
    projectId: context.projectId,
    toolId: context.toolId,
    endpoint: "/v1/responses",
    model: payload.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedCostUsd: null,
    statusCode: upstream.status,
    latencyMs: Date.now() - start
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
}
