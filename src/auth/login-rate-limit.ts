export class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStartMs: number }>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly maxAttempts = 5
  ) {}

  normalizeKey(key: string | undefined): string {
    const trimmed = (key ?? "").trim();
    return trimmed || "unknown";
  }

  getState(key: string, nowMs: number): { limited: boolean; retryAfterSeconds: number } {
    const existing = this.attempts.get(key);
    if (!existing) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    if (nowMs - existing.windowStartMs >= this.windowMs) {
      this.attempts.delete(key);
      return { limited: false, retryAfterSeconds: 0 };
    }

    if (existing.count < this.maxAttempts) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartMs + this.windowMs - nowMs) / 1000));
    return { limited: true, retryAfterSeconds };
  }

  recordFailure(key: string, nowMs: number): void {
    const existing = this.attempts.get(key);
    if (!existing || nowMs - existing.windowStartMs >= this.windowMs) {
      this.attempts.set(key, { count: 1, windowStartMs: nowMs });
      return;
    }

    existing.count += 1;
    this.attempts.set(key, existing);
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
