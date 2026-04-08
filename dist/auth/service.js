import { makeOpaqueToken, parseOpaqueToken, sha256 } from "../utils/crypto.js";
const ADMIN_COOKIE = "admin_session";
const USER_COOKIE = "user_session";
export class AuthService {
    repo;
    sessionTtlHours;
    constructor(repo, sessionTtlHours) {
        this.repo = repo;
        this.sessionTtlHours = sessionTtlHours;
    }
    async createSessionWithExpiry(scope, subjectEmail) {
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
    async createSession(scope, subjectEmail) {
        const session = await this.createSessionWithExpiry(scope, subjectEmail);
        return session.token;
    }
    async getSessionEmail(scope, token) {
        const parsed = parseOpaqueToken(token, "st");
        if (!parsed) {
            return null;
        }
        const session = await this.repo.findSession({ id: parsed.id, secret: parsed.secret, scope });
        return session?.subjectEmail ?? null;
    }
    static setSessionCookie(reply, scope, token) {
        const name = scope === "admin" ? ADMIN_COOKIE : USER_COOKIE;
        reply.setCookie(name, token, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/"
        });
    }
    static getSessionFromCookie(request, scope) {
        return scope === "admin"
            ? request.cookies[ADMIN_COOKIE]
            : request.cookies[USER_COOKIE];
    }
    static getBearerToken(request) {
        const auth = request.headers.authorization;
        if (!auth?.startsWith("Bearer ")) {
            return undefined;
        }
        const token = auth.slice("Bearer ".length).trim();
        return token || undefined;
    }
    static makeToolToken() {
        const opaque = makeOpaqueToken("tt");
        return {
            token: opaque.token,
            tokenId: opaque.id,
            tokenHash: opaque.secretHash
        };
    }
    static makeRelayToken() {
        const opaque = makeOpaqueToken("rt");
        return {
            token: opaque.token,
            tokenId: opaque.id,
            tokenHash: opaque.secretHash
        };
    }
    static keySuffix(apiKey) {
        return apiKey.length <= 6 ? apiKey : apiKey.slice(-6);
    }
    static hashToken(raw) {
        return sha256(raw);
    }
}
