import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/service.js";
import type { Repo } from "../db/repo.js";
import type { AuthContext } from "../db/types.js";

export type RelayAuthResult =
  | { kind: "relay_token"; auth: AuthContext }
  | { kind: "legacy_session"; email: string };

export async function resolveRelayAuth(
  request: FastifyRequest,
  repo: Repo,
  authService: AuthService
): Promise<RelayAuthResult | null> {
  const token = AuthService.getBearerToken(request);
  if (!token) {
    return null;
  }

  const relayAuth = await repo.findAuthByRelayToken(token);
  if (relayAuth) {
    return { kind: "relay_token", auth: relayAuth };
  }

  const email = await authService.getSessionEmail("user", token);
  if (!email) {
    return null;
  }

  return { kind: "legacy_session", email };
}
