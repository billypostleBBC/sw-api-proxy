import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { afterEach, describe, expect, it } from "vitest";
import { isOriginAllowed } from "../src/build-app.js";

describe("isOriginAllowed", () => {
  it("allows requests with no origin", () => {
    expect(isOriginAllowed(undefined, ["https://www.figma.com"])).toBe(true);
  });

  it("allows opaque null origins for sandboxed clients", () => {
    expect(isOriginAllowed("null", ["https://www.figma.com"])).toBe(true);
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

describe("cors preflight", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("allows Authorization preflight from sandboxed null origins", async () => {
    const app = Fastify();
    apps.push(app);

    await app.register(cors, {
      origin: (origin, cb) => {
        cb(null, isOriginAllowed(origin, ["https://www.figma.com"]));
      },
      credentials: true,
      methods: ["GET", "HEAD", "POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"]
    });

    app.post("/v1/tools/:toolSlug/responses", async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/tools/alt-text-gen/responses",
      headers: {
        origin: "null",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("null");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type");
  });
});
