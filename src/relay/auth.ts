import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/service.js";

export async function resolveRelaySessionEmail(
  request: FastifyRequest,
  authService: AuthService
): Promise<string | null> {
  const token = AuthService.getBearerToken(request);
  if (!token) {
    return null;
  }

  return authService.getSessionEmail("user", token);
}
