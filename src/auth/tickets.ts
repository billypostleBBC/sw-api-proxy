import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();

export type ClientTicketClaims = {
  sub: string;
  toolId: number;
  toolSlug: string;
  projectId: number;
  projectSlug: string;
  rpmCap: number;
  dailyTokenCap: number;
};

export class TicketService {
  constructor(private readonly signingKey: string, private readonly ttlMinutes: number) {}

  async createTicket(claims: ClientTicketClaims): Promise<string> {
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

  async verifyTicket(token: string): Promise<ClientTicketClaims> {
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
