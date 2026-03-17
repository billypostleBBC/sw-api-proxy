import { z } from "zod";
import { sendError } from "../utils/http.js";
import { resolveProxyAuth } from "./auth.js";
import { responsesSchema, sendResponsesRequest } from "../openai/responses.js";
const embeddingsSchema = z.object({ model: z.string().min(1), input: z.any() }).passthrough();
export function registerProxyRoutes(app, deps) {
    app.post("/proxy/v1/responses", async (request, reply) => {
        const parsedBody = responsesSchema.safeParse(request.body);
        if (!parsedBody.success) {
            return sendError(reply, 400, "bad_request", "Invalid responses payload", { issues: parsedBody.error.issues });
        }
        const auth = await resolveProxyAuth(request, app.repo);
        if (!auth) {
            return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
        }
        if (auth.toolStatus !== "active") {
            return sendError(reply, 403, "forbidden", "Tool is inactive");
        }
        return sendResponsesRequest(app, reply, deps, auth, parsedBody.data);
    });
    app.post("/proxy/v1/embeddings", async (request, reply) => {
        const parsedBody = embeddingsSchema.safeParse(request.body);
        if (!parsedBody.success) {
            return sendError(reply, 400, "bad_request", "Invalid embeddings payload", { issues: parsedBody.error.issues });
        }
        const auth = await resolveProxyAuth(request, app.repo);
        if (!auth) {
            return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
        }
        if (auth.toolStatus !== "active") {
            return sendError(reply, 403, "forbidden", "Tool is inactive");
        }
        if (auth.projectStatus !== "active") {
            return sendError(reply, 403, "forbidden", "Project is inactive");
        }
        try {
            await deps.limitService.enforce(auth.projectId, auth.rpmCap, auth.dailyTokenCap);
        }
        catch (error) {
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
        const auth = await resolveProxyAuth(request, app.repo);
        if (!auth) {
            return sendError(reply, 401, "unauthorized", "Missing or invalid bearer token");
        }
        if (auth.toolStatus !== "active") {
            return sendError(reply, 403, "forbidden", "Tool is inactive");
        }
        if (auth.projectStatus !== "active") {
            return sendError(reply, 403, "forbidden", "Project is inactive");
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
