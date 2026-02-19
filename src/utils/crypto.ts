import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(size = 32): string {
  return randomBytes(size).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function makeOpaqueToken(prefix: string): { token: string; id: string; secretHash: string } {
  const id = randomToken(9);
  const secret = randomToken(32);
  return {
    token: `${prefix}.${id}.${secret}`,
    id,
    secretHash: sha256(secret)
  };
}

export function parseOpaqueToken(token: string, prefix: string): { id: string; secret: string } | null {
  const firstDot = token.indexOf(".");
  const secondDot = token.indexOf(".", firstDot + 1);
  if (firstDot < 1 || secondDot < 0) {
    return null;
  }
  const p = token.slice(0, firstDot);
  if (p !== prefix) {
    return null;
  }
  const id = token.slice(firstDot + 1, secondDot);
  const secret = token.slice(secondDot + 1);
  if (!id || !secret) {
    return null;
  }
  return { id, secret };
}
