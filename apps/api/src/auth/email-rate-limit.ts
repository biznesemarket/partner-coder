import { sql } from "drizzle-orm";

import type { Database } from "@partner-coder/db";

export interface EmailRateLimitStore {
  consume(email: string): boolean | Promise<boolean>;
}

export interface EmailRateLimiterOptions {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

export interface DatabaseEmailRateLimiterOptions extends EmailRateLimiterOptions {
  readonly fallback?: EmailRateLimitStore;
  readonly onError?: (error: unknown) => void;
}

interface Bucket {
  windowStart: number;
  count: number;
}

/**
 * In-memory per-email limiter. Подходит для local и тестов; в нескольких
 * инстансах каждый процесс считает попытки отдельно.
 */
export class EmailRateLimiter implements EmailRateLimitStore {
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

/**
 * PostgreSQL-хранилище per-email лимита. Один атомарный upsert на попытку:
 * окно сбрасывается, когда истекло, иначе счетчик увеличивается. Все
 * API-инстансы видят общий счетчик и общий лимит.
 *
 * При сбое БД лимитер не роняет вход: используется memory-fallback текущего
 * инстанса, ошибка передается в onError для лога.
 */
export class DatabaseEmailRateLimiter implements EmailRateLimitStore {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly fallback: EmailRateLimitStore;
  private readonly onError: ((error: unknown) => void) | undefined;

  constructor(
    private readonly db: Database,
    options: DatabaseEmailRateLimiterOptions = {},
  ) {
    this.limit = options.limit ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.fallback = options.fallback ?? new EmailRateLimiter(options);
    this.onError = options.onError;
  }

  async consume(email: string): Promise<boolean> {
    const key = email.trim().toLowerCase();
    if (!key) {
      return true;
    }
    const windowSeconds = this.windowMs / 1000;
    try {
      const result = await this.db.execute(sql`
        insert into email_rate_limits (key, count, window_started_at)
        values (${key}, 1, now())
        on conflict (key) do update
           set count = case
                 when email_rate_limits.window_started_at <= now() - make_interval(secs => ${windowSeconds}::double precision)
                   then 1
                 else email_rate_limits.count + 1
               end,
               window_started_at = case
                 when email_rate_limits.window_started_at <= now() - make_interval(secs => ${windowSeconds}::double precision)
                   then now()
                 else email_rate_limits.window_started_at
               end
        returning count
      `);
      const count = Number((result.rows[0] as { count?: string | number } | undefined)?.count ?? 0);
      return count <= this.limit;
    } catch (error) {
      this.onError?.(error);
      return this.fallback.consume(key);
    }
  }
}
