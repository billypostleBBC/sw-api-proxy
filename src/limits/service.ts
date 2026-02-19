import type { Repo } from "../db/repo.js";

export class LimitService {
  constructor(private readonly repo: Repo) {}

  static currentMinuteBucket(date = new Date()): Date {
    const bucket = new Date(date);
    bucket.setSeconds(0, 0);
    return bucket;
  }

  async enforce(projectId: number, rpmCap: number, dailyTokenCap: number): Promise<void> {
    const minute = LimitService.currentMinuteBucket();
    const minuteCount = await this.repo.incrementRateCounter(projectId, minute);
    if (minuteCount > rpmCap) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    const dailyUsed = await this.repo.getDailyTokensUsed(projectId);
    if (dailyUsed >= dailyTokenCap) {
      throw new Error("DAILY_TOKEN_CAP_EXCEEDED");
    }
  }
}
