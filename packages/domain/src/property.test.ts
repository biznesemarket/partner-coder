import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  calculateDay,
  displayShare,
  loadPolicy,
  ratio,
  roundHalfUp,
  unionTimeline,
  type IntervalClass,
  type PolicyDocument,
  type ProjectPolicy,
} from "./index.js";

/**
 * Property-based инварианты (docs/02-domain/calculator.md §6):
 * union не увеличивает время, капы не превышаются, деньги неотрицательны,
 * округление half-up, доля монотонна при равной оценке.
 */

const demoDoc = JSON.parse(
  readFileSync(new URL("../fixtures/policies/demo.policy.json", import.meta.url), "utf8"),
) as PolicyDocument;
const policy: ProjectPolicy = loadPolicy(demoDoc);

const iso = (ms: number): string => new Date(ms).toISOString();

const DAY_START = Date.parse("2026-11-15T21:00:00Z");
const DAILY_CAP_SECONDS = 12 * 3600;
const AUTONOMOUS_CAP_SECONDS = 2 * 3600;

const intervalArb = fc
  .record({
    startSec: fc.integer({ min: 0, max: 22 * 3600 }),
    durationSec: fc.integer({ min: 0, max: 3600 }),
    class: fc.constantFrom<IntervalClass>(
      "active_human",
      "supervised_agent",
      "autonomous_agent",
      "idle",
    ),
  })
  .map((raw) => ({
    startMs: DAY_START + raw.startSec * 1000,
    endMs: DAY_START + (raw.startSec + raw.durationSec) * 1000,
    class: raw.class,
  }));

describe("инварианты union", () => {
  it("union не увеличивает суммарное время и не создает пересечений", () => {
    fc.assert(
      fc.property(fc.array(intervalArb, { minLength: 0, maxLength: 30 }), (intervals) => {
        const merged = unionTimeline(intervals);
        const inputTotal = intervals.reduce((sum, iv) => sum + (iv.endMs - iv.startMs), 0);
        const mergedTotal = merged.reduce((sum, iv) => sum + (iv.endMs - iv.startMs), 0);
        expect(mergedTotal).toBeLessThanOrEqual(inputTotal);
        for (let index = 1; index < merged.length; index += 1) {
          const previous = merged[index - 1]!;
          const current = merged[index]!;
          expect(current.startMs).toBeGreaterThanOrEqual(previous.endMs);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("union идемпотентен: повторное объединение не меняет результат", () => {
    fc.assert(
      fc.property(fc.array(intervalArb, { minLength: 0, maxLength: 20 }), (intervals) => {
        const once = unionTimeline(intervals);
        const twice = unionTimeline(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });
});

describe("инварианты расчета дня", () => {
  it("капы не превышаются, деньги неотрицательны, cash + equity = amount", () => {
    fc.assert(
      fc.property(fc.array(intervalArb, { minLength: 0, maxLength: 25 }), (intervals) => {
        const result = calculateDay({
          policy,
          date: "2026-11-16",
          sessions: [
            {
              id: "s",
              membershipId: "dev",
              taskRef: "PC-1",
              branch: "feat/x",
              intervals: intervals.map((interval) => ({
                class: interval.class,
                start: iso(interval.startMs),
                end: iso(interval.endMs),
              })),
            },
          ],
        });
        expect(result.paidSeconds).toBeLessThanOrEqual(DAILY_CAP_SECONDS);
        expect(result.amountKopecks).toBeGreaterThanOrEqual(0n);
        expect(result.cashKopecks + result.equityKopecks).toBe(result.amountKopecks);
        expect(result.classes.autonomousSeconds).toBeLessThanOrEqual(AUTONOMOUS_CAP_SECONDS);
        expect(result.classes.activeSeconds + result.classes.supervisedSeconds).toBeLessThanOrEqual(
          DAILY_CAP_SECONDS,
        );
      }),
      { numRuns: 150 },
    );
  });

  it("доля монотонна по вкладу при равной оценке", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        (a, b) => {
          const lower = a <= b ? a : b;
          const higher = a <= b ? b : a;
          const valuation = 1_000_000_000n;
          expect(displayShare(lower, valuation)).toBeLessThanOrEqual(
            displayShare(higher, valuation),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("день без интервалов стоит ноль", () => {
    const result = calculateDay({ policy, date: "2026-11-16", sessions: [] });
    expect(result.paidSeconds).toBe(0);
    expect(result.amountKopecks).toBe(0n);
    expect(result.shareBp).toBe(0n);
  });
});

describe("округление", () => {
  it("на целых half-up возвращает то же число", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), (n) => {
        expect(roundHalfUp(ratio(n))).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it("half-up неубывающий на неотрицательных дробях", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1000n }),
        (n, d) => {
          const value = roundHalfUp(ratio(n, d));
          expect(value * d <= n + (d + 1n) / 2n).toBe(true);
          expect(value * d >= n - (d / 2n + 1n)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
