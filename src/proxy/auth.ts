import type { FastifyRequest } from "fastify";
import type { Repo } from "../db/repo.js";
import type { AuthContext } from "../db/types.js";
import { TicketService } from "../auth/tickets.js";

export async function resolveProxyAuth(
  request: FastifyRequest,
  repo: Repo,
  ticketService: TicketService
): Promise<AuthContext | null> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.slice("Bearer ".length).trim();
  const toolAuth = await repo.findAuthByToolToken(token);
  if (toolAuth) {
    return toolAuth;
  }

  try {
    const claims = await ticketService.verifyTicket(token);
    return {
      mode: "ticket",
      toolId: claims.toolId,
      toolSlug: claims.toolSlug,
      projectId: claims.projectId,
      projectSlug: claims.projectSlug,
      projectStatus: "active",
      rpmCap: claims.rpmCap,
      dailyTokenCap: claims.dailyTokenCap
    };
  } catch {
    return null;
  }
}
