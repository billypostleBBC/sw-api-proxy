import type { FastifyReply, FastifyRequest } from "fastify";
import type { Repo } from "../db/repo.js";
import { makeOpaqueToken, parseOpaqueToken, sha256 } from "../utils/crypto.js";
import type { Scope } from "../db/types.js";

const ADMIN_COOKIE = "admin_session";
const USER_COOKIE = "user_session";

export class AuthService {
  constructor(private readonly repo: Repo, private readonly sessionTtlHours: number) {}

  async createSessionWithExpiry(scope: Scope, subjectEmail: string): Promise<{ id: string; token: string; expiresAt: Date }> {
    const opaque = makeOpaqueToken("st");
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60_000);

    await this.repo.createSession({
      id: opaque.id,
      tokenHash: opaque.secretHash,
      subjectEmail,
      scope,
      expiresAt
    });

    return {
      id: opaque.id,
      token: opaque.token,
      expiresAt
    };
  }

  async createSession(scope: Scope, subjectEmail: string): Promise<string> {
    const session = await this.createSessionWithExpiry(scope, subjectEmail);
    return session.token;
  }

  async getSessionEmail(scope: Scope, token: string): Promise<string | null> {
    const parsed = parseOpaqueToken(token, "st");
    if (!parsed) {
      return null;
    }
    const session = await this.repo.findSession({ id: parsed.id, secret: parsed.secret, scope });
    return session?.subjectEmail ?? null;
  }

  static setSessionCookie(reply: FastifyReply, scope: Scope, token: string): void {
    const name = scope === "admin" ? ADMIN_COOKIE : USER_COOKIE;
    reply.setCookie(name, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/"
    });
  }

  static getSessionFromCookie(request: FastifyRequest, scope: Scope): string | undefined {
    return scope === "admin"
      ? (request.cookies[ADMIN_COOKIE] as string | undefined)
      : (request.cookies[USER_COOKIE] as string | undefined);
  }

  static getBearerToken(request: FastifyRequest): string | undefined {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return undefined;
    }

    const token = auth.slice("Bearer ".length).trim();
    return token || undefined;
  }

  static makeToolToken(): { token: string; tokenId: string; tokenHash: string } {
    const opaque = makeOpaqueToken("tt");
    return {
      token: opaque.token,
      tokenId: opaque.id,
      tokenHash: opaque.secretHash
    };
  }

  static keySuffix(apiKey: string): string {
    return apiKey.length <= 6 ? apiKey : apiKey.slice(-6);
  }

  static hashToken(raw: string): string {
    return sha256(raw);
  }
}
