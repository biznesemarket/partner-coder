import { describe, expect, it } from "vitest";

import { EmailRateLimiter } from "./email-rate-limit.js";

describe("per-email rate limit", () => {
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
