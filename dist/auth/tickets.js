import { SignJWT, jwtVerify } from "jose";
const encoder = new TextEncoder();
export class TicketService {
    signingKey;
    ttlMinutes;
    constructor(signingKey, ttlMinutes) {
        this.signingKey = signingKey;
        this.ttlMinutes = ttlMinutes;
    }
    async createTicket(claims) {
        return new SignJWT({
            toolId: claims.toolId,
            toolSlug: claims.toolSlug,
            projectId: claims.projectId,
            projectSlug: claims.projectSlug,
            rpmCap: claims.rpmCap,
            dailyTokenCap: claims.dailyTokenCap
        })
            .setProtectedHeader({ alg: "HS256" })
            .setSubject(claims.sub)
            .setIssuedAt()
            .setExpirationTime(`${this.ttlMinutes}m`)
            .sign(encoder.encode(this.signingKey));
    }
    async verifyTicket(token) {
        const { payload } = await jwtVerify(token, encoder.encode(this.signingKey));
        return {
            sub: String(payload.sub),
            toolId: Number(payload.toolId),
            toolSlug: String(payload.toolSlug),
            projectId: Number(payload.projectId),
            projectSlug: String(payload.projectSlug),
            rpmCap: Number(payload.rpmCap),
            dailyTokenCap: Number(payload.dailyTokenCap)
        };
    }
}
