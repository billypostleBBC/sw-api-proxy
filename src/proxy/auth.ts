import { AuthService } from "../auth/service.js";
import type { FastifyRequest } from "fastify";
import type { Repo } from "../db/repo.js";
import type { AuthContext } from "../db/types.js";

export async function resolveProxyAuth(request: FastifyRequest, repo: Repo): Promise<AuthContext | null> {
  const token = AuthService.getBearerToken(request);
  if (!token) {
    return null;
  }

  return repo.findAuthByToolToken(token);
}
