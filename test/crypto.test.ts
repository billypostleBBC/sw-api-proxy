import { describe, expect, it } from "vitest";
import { makeOpaqueToken, parseOpaqueToken, safeEqualHex, sha256 } from "../src/utils/crypto.js";

describe("crypto helpers", () => {
  it("creates and parses opaque tokens", () => {
    const token = makeOpaqueToken("tt");
    const parsed = parseOpaqueToken(token.token, "tt");
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(token.id);
  });

  it("returns false when hashes differ", () => {
    expect(safeEqualHex(sha256("a"), sha256("b"))).toBe(false);
  });

  it("returns true when hashes match", () => {
    const h = sha256("same");
    expect(safeEqualHex(h, h)).toBe(true);
  });
});
