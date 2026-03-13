export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly maxMessages: number,
    private readonly windowMs: number
  ) {}

  check(key: string): RateLimitResult {
    if (this.maxMessages <= 0 || this.windowMs <= 0) {
      return {
        allowed: true,
        remaining: Number.POSITIVE_INFINITY,
        retryAfterMs: 0
      };
    }

    const now = Date.now();
    const threshold = now - this.windowMs;
    const existing = this.windows.get(key) ?? [];
    const active = existing.filter((timestamp) => timestamp > threshold);

    if (active.length >= this.maxMessages) {
      this.windows.set(key, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(active[0]! + this.windowMs - now, 0)
      };
    }

    active.push(now);
    this.windows.set(key, active);

    return {
      allowed: true,
      remaining: Math.max(this.maxMessages - active.length, 0),
      retryAfterMs: 0
    };
  }
}
