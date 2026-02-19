import { describe, expect, it } from "vitest";
import { TicketService } from "../src/auth/tickets.js";

describe("TicketService", () => {
  it("creates and verifies client ticket", async () => {
    const svc = new TicketService("test-signing-key-123456", 5);
    const token = await svc.createTicket({
      sub: "user@bbc.co.uk",
      toolId: 1,
      toolSlug: "demo-tool",
      projectId: 10,
      projectSlug: "demo-project",
      rpmCap: 60,
      dailyTokenCap: 2000000
    });

    const claims = await svc.verifyTicket(token);
    expect(claims.sub).toBe("user@bbc.co.uk");
    expect(claims.toolSlug).toBe("demo-tool");
  });
});
