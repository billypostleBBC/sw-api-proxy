import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "../src/build-app.js";

describe("isOriginAllowed", () => {
  it("allows requests with no origin", () => {
    expect(isOriginAllowed(undefined, ["https://www.figma.com"])).toBe(true);
  });

  it("allows any origin when the allowlist is empty", () => {
    expect(isOriginAllowed("https://joey-tool.example", [])).toBe(true);
  });

  it("allows any origin when wildcard is configured", () => {
    expect(isOriginAllowed("https://joey-tool.example", ["*"])).toBe(true);
  });

  it("allows an explicitly configured origin", () => {
    expect(isOriginAllowed("https://www.figma.com", ["https://www.figma.com"])).toBe(true);
  });

  it("rejects an origin that is not allowlisted", () => {
    expect(isOriginAllowed("https://joey-tool.example", ["https://www.figma.com"])).toBe(false);
  });
});
