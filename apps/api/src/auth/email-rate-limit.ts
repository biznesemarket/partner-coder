export interface EmailRateLimiterOptions {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export class EmailRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: EmailRateLimiterOptions = {}) {
    this.limit = options.limit ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  consume(email: string): boolean {
    const key = email.trim().toLowerCase();
    if (!key) {
      return true;
    }
    const now = this.now();
    if (this.buckets.size > 10_000) {
      for (const [bucketKey, value] of this.buckets) {
        if (now - value.windowStart >= this.windowMs) {
          this.buckets.delete(bucketKey);
        }
      }
    }
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (bucket.count >= this.limit) {
      return false;
    }
    bucket.count += 1;
    return true;
  }

  clear(): void {
    this.buckets.clear();
  }
}
