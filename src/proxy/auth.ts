import type { FastifyRequest } from "fastify";
import type { Repo } from "../db/repo.js";
import type { AuthContext } from "../db/types.js";

export async function resolveProxyAuth(request: FastifyRequest, repo: Repo): Promise<AuthContext | null> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.slice("Bearer ".length).trim();
  return repo.findAuthByToolToken(token);
}
