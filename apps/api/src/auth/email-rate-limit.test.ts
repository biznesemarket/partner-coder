import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@partner-coder/db";

import {
  createPoolForDatabase,
  createTestDatabase,
  type TestDatabase,
} from "../../../../packages/db/test/helpers.js";
import { DatabaseEmailRateLimiter, EmailRateLimiter } from "./email-rate-limit.js";

describe("per-email rate limit (memory)", () => {
  it("пропускает limit попыток в окне и блокирует следующую", () => {
    let now = 1_000;
    const limiter = new EmailRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
    expect(limiter.consume("A@Example.com")).toBe(true);
    expect(limiter.consume("a@example.com")).toBe(true);
    expect(limiter.consume("a@example.com")).toBe(false);

    now += 60_000;
    expect(limiter.consume("a@example.com")).toBe(true);
  });

  it("не смешивает разные email и пустые значения", () => {
    const limiter = new EmailRateLimiter({ limit: 1, now: () => 1_000 });
    expect(limiter.consume("a@example.com")).toBe(true);
    expect(limiter.consume("b@example.com")).toBe(true);
    expect(limiter.consume("")).toBe(true);
    expect(limiter.consume("a@example.com")).toBe(false);
  });
});

describe("per-email rate limit (PostgreSQL)", () => {
  let database: TestDatabase;
  let secondPool: ReturnType<typeof createPoolForDatabase>;
  let first: Database;
  let second: Database;

  beforeAll(async () => {
    database = await createTestDatabase();
    secondPool = createPoolForDatabase(database);
    first = createDatabase(database.pool);
    second = createDatabase(secondPool);
  }, 120_000);

  afterAll(async () => {
    await secondPool?.end();
    await database?.drop();
  }, 60_000);

  it("делит одно окно между двумя инстансами", async () => {
    const instanceA = new DatabaseEmailRateLimiter(first, { limit: 2, windowMs: 60_000 });
    const instanceB = new DatabaseEmailRateLimiter(second, { limit: 2, windowMs: 60_000 });

    expect(await instanceA.consume("Shared@Example.com")).toBe(true);
    expect(await instanceB.consume("shared@example.com")).toBe(true);
    expect(await instanceA.consume("shared@example.com")).toBe(false);
    expect(await instanceB.consume("shared@example.com")).toBe(false);

    expect(await instanceB.consume("other@example.com")).toBe(true);
  });

  it("сбрасывает окно после истечения", async () => {
    const limiter = new DatabaseEmailRateLimiter(first, { limit: 1, windowMs: 60_000 });
    expect(await limiter.consume("reset@example.com")).toBe(true);
    expect(await limiter.consume("reset@example.com")).toBe(false);

    await database.pool.query(
      "update email_rate_limits set window_started_at = now() - interval '2 minutes' where key = $1",
      ["reset@example.com"],
    );
    expect(await limiter.consume("reset@example.com")).toBe(true);
  });

  it("DatabaseEmailRateLimiter пишет в vendor_auth_email_limits", async () => {
    const limiter = new DatabaseEmailRateLimiter(first, {
      table: "vendor_auth_email_limits",
      limit: 1,
      windowMs: 60_000,
    });
    expect(await limiter.consume("ops@example.com")).toBe(true);
    expect(await limiter.consume("ops@example.com")).toBe(false);
    const rows = await database.pool.query("select key, count from vendor_auth_email_limits");
    expect(rows.rows).toEqual([{ key: "ops@example.com", count: 2 }]);
  });

  it("при сбое БД откатывается на memory-лимитер и сообщает об ошибке", async () => {
    const broken = {
      execute: async () => {
        throw new Error("db unavailable");
      },
    } as unknown as Database;
    let errors = 0;
    const limiter = new DatabaseEmailRateLimiter(broken, {
      limit: 1,
      windowMs: 60_000,
      onError: () => {
        errors += 1;
      },
    });

    expect(await limiter.consume("fallback@example.com")).toBe(true);
    expect(await limiter.consume("fallback@example.com")).toBe(false);
    expect(errors).toBe(2);
  });
});
