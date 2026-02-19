import type { Repo } from "../db/repo.js";

export type UsageInput = {
  projectId: number;
  toolId: number;
  endpoint: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  statusCode: number;
  latencyMs: number;
};

export class UsageService {
  constructor(private readonly repo: Repo) {}

  async log(input: UsageInput): Promise<void> {
    await this.repo.logUsage(input);
  }

  async audit(input: {
    actorEmail: string;
    actorScope: "admin" | "user";
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.repo.logAudit(input);
  }
}
