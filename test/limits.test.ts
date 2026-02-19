import { describe, expect, it } from "vitest";
import { LimitService } from "../src/limits/service.js";

describe("LimitService", () => {
  it("rounds to minute bucket", () => {
    const date = new Date("2026-02-19T12:34:56.789Z");
    const bucket = LimitService.currentMinuteBucket(date);
    expect(bucket.toISOString()).toBe("2026-02-19T12:34:00.000Z");
  });
});
