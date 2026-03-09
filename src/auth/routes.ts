import type { FastifyInstance } from "fastify";
import { sendError } from "../utils/http.js";
import type { Repo } from "../db/repo.js";
import { TicketService } from "./tickets.js";

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { repo: Repo; ticketService: TicketService }
): void {
  app.post("/auth/client-ticket", async (request, reply) => {
    const toolToken = getBearerToken(request.headers.authorization);
    if (!toolToken) {
      return sendError(reply, 401, "unauthorized", "Tool bearer token is required");
    }

    const auth = await deps.repo.findAuthByToolToken(toolToken);
    if (!auth) {
      return sendError(reply, 401, "unauthorized", "Invalid or expired tool bearer token");
    }
    if (auth.projectStatus !== "active") {
      return sendError(reply, 403, "forbidden", "Project is inactive");
    }

    const ticket = await deps.ticketService.createTicket({
      sub: `tool:${auth.toolId}`,
      toolId: auth.toolId,
      toolSlug: auth.toolSlug,
      projectId: auth.projectId,
      projectSlug: auth.projectSlug,
      rpmCap: auth.rpmCap,
      dailyTokenCap: auth.dailyTokenCap
    });

    return reply.send({ ticket, expiresInMinutes: app.env.clientTicketTtlMinutes });
  });
}
