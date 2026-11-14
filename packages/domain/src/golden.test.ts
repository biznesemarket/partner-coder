import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  aggregateMonth,
  calculateDay,
  displayShare,
  loadPolicy,
  parseLocalDate,
  splitVestedShare,
  vestingFraction,
  zonedTimeToUtcMs,
  type CalculateDayInput,
  type DayCalculation,
  type IntervalClass,
  type IntervalSource,
  type PolicyDocument,
  type ProjectPolicy,
  type SessionInput,
} from "./index.js";

/**
 * Golden-тесты домена (T-01…T-12, E-01…E-08).
 *
 * Числа фиксированы в `fixtures/golden/scenarios.json` вместе с источником
 * (нормативная спецификация старого проекта). Любое расхождение — блокер:
 * менять golden можно только через ADR (docs/adr/0003).
 */

interface LocalIntervalSpec {
  class: IntervalClass;
  from: string;
  to: string;
  source?: IntervalSource;
  receivedAt?: string;
}

interface SessionSpec {
  id: string;
  membershipId: string;
  taskRef?: string | null;
  branch?: string | null;
  localIntervals: LocalIntervalSpec[];
}

interface ScenarioInput {
  date?: string;
  dates?: string[];
  startDate?: string;
  days?: number;
  sessions?: SessionSpec[];
  quality?: { kQuality: string; reason: string };
  previous?: {
    amountKopecks: string;
    paidSeconds: number;
    inputHash: string;
    effectiveAmountKopecks?: string;
  };
  accruedEquityKopecks?: string;
  equityKopecks?: string;
  valuationsKopecks?: string[];
  activeMonths?: number;
  months?: number;
  cliffMonths?: number;
  shareBp?: string;
}

interface Scenario {
  id: string;
  kind: "day" | "days" | "month" | "valuation" | "pool" | "vesting";
  title: string;
  source: string;
  note?: string;
  policyOverrides?: Record<string, unknown>;
  input: ScenarioInput;
  expect?: unknown;
}

const basePolicyDocument = JSON.parse(
  readFileSync(new URL("../fixtures/policies/demo.policy.json", import.meta.url), "utf8"),
) as PolicyDocument;

const scenariosFile = JSON.parse(
  readFileSync(new URL("../fixtures/golden/scenarios.json", import.meta.url), "utf8"),
) as { scenarios: Scenario[] };

function parseClock(clock: string): { hour: number; minute: number; second: number } {
  const [hour, minute] = clock.split(":");
  return {
    hour: Number.parseInt(hour ?? "0", 10),
    minute: Number.parseInt(minute ?? "0", 10),
    second: 0,
  };
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch ?? base) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function policyFor(scenario: Scenario): ProjectPolicy {
  const doc = scenario.policyOverrides
    ? deepMerge(basePolicyDocument, scenario.policyOverrides)
    : basePolicyDocument;
  return loadPolicy(doc);
}

function toUtcIso(date: string, clock: string, timeZone: string): string {
  const parts = { ...parseLocalDate(date), ...parseClock(clock) };
  return new Date(zonedTimeToUtcMs(parts, timeZone)).toISOString();
}

function buildSessions(
  specs: readonly SessionSpec[],
  date: string,
  timeZone: string,
): SessionInput[] {
  return specs.map((spec) => ({
    id: spec.id,
    membershipId: spec.membershipId,
    taskRef: spec.taskRef ?? null,
    branch: spec.branch ?? null,
    intervals: spec.localIntervals.map((interval) => {
      const crossesMidnight = interval.to <= interval.from;
      const endDate = crossesMidnight ? addLocalDays(date, 1) : date;
      return {
        class: interval.class,
        start: toUtcIso(date, interval.from, timeZone),
        end: toUtcIso(endDate, interval.to, timeZone),
        source: interval.source ?? "agent",
        ...(interval.receivedAt ? { receivedAt: interval.receivedAt } : {}),
      };
    }),
  }));
}

function dayInput(
  scenario: Scenario,
  policy: ProjectPolicy,
  date: string,
  sessions: SessionInput[],
): CalculateDayInput {
  const input: CalculateDayInput = { policy, date, sessions };
  if (scenario.input.quality) {
    input.quality = {
      kQuality: scenario.input.quality.kQuality,
      reason: scenario.input.quality.reason,
    };
  }
  if (scenario.input.previous) {
    const previous = scenario.input.previous;
    input.previous = {
      amountKopecks: BigInt(previous.amountKopecks),
      paidSeconds: previous.paidSeconds,
      inputHash: previous.inputHash,
      ...(previous.effectiveAmountKopecks !== undefined
        ? { effectiveAmountKopecks: BigInt(previous.effectiveAmountKopecks) }
        : {}),
    };
  }
  return input;
}

function assertExpectation(actual: DayCalculation, expectSpec: Record<string, unknown>): void {
  for (const [key, expected] of Object.entries(expectSpec)) {
    if (key === "flags") {
      const codes = [...actual.flags.map((dayFlag) => dayFlag.code)].sort();
      expect(codes, `${key}`).toEqual([...(expected as string[])].sort());
      continue;
    }
    const value = (actual as unknown as Record<string, unknown>)[key];
    if (isPlainObject(expected)) {
      expect(value, `${key}`).toMatchObject(expected);
      continue;
    }
    if (typeof expected === "string" && typeof value === "bigint") {
      expect(value.toString(), `${key}`).toBe(expected);
      continue;
    }
    expect(value, `${key}`).toEqual(expected);
  }
}

for (const scenario of scenariosFile.scenarios) {
  describe(`${scenario.id} — ${scenario.title}`, () => {
    it(`источник: ${scenario.source}`, () => {
      const policy = policyFor(scenario);
      const expectSpec = (scenario.expect ?? {}) as Record<string, unknown>;

      switch (scenario.kind) {
        case "day": {
          const date = scenario.input.date as string;
          const sessions = buildSessions(
            scenario.input.sessions ?? [],
            date,
            policy.project.timezone,
          );
          const result = calculateDay(dayInput(scenario, policy, date, sessions));
          assertExpectation(result, expectSpec);
          break;
        }
        case "days": {
          const dates = scenario.input.dates ?? [];
          const firstDate = dates[0] as string;
          const sessions = buildSessions(
            scenario.input.sessions ?? [],
            firstDate,
            policy.project.timezone,
          );
          const expectations = Array.isArray(scenario.expect)
            ? (scenario.expect as Record<string, unknown>[])
            : [];
          dates.forEach((date, index) => {
            const result = calculateDay(dayInput(scenario, policy, date, sessions));
            assertExpectation(result, expectations[index] ?? {});
          });
          break;
        }
        case "month": {
          const startDate = scenario.input.startDate as string;
          const count = scenario.input.days ?? 1;
          const days: DayCalculation[] = [];
          for (let offset = 0; offset < count; offset += 1) {
            const date = addLocalDays(startDate, offset);
            const sessions = buildSessions(
              scenario.input.sessions ?? [],
              date,
              policy.project.timezone,
            );
            days.push(calculateDay(dayInput(scenario, policy, date, sessions)));
          }
          const month = aggregateMonth(days, policy);
          for (const [key, expected] of Object.entries(expectSpec)) {
            const value = (month as unknown as Record<string, unknown>)[key];
            if (typeof expected === "string" && typeof value === "bigint") {
              expect(value.toString(), key).toBe(expected);
            } else {
              expect(value, key).toEqual(expected);
            }
          }
          break;
        }
        case "valuation": {
          const equity = BigInt(scenario.input.equityKopecks ?? "0");
          const shares = (scenario.input.valuationsKopecks ?? []).map((valuation) =>
            displayShare(equity, BigInt(valuation)).toString(),
          );
          expect(shares).toEqual(
            (scenario.expect as { sharesBp?: string[] } | undefined)?.sharesBp,
          );
          break;
        }
        case "pool": {
          const date = scenario.input.date as string;
          const sessions = buildSessions(
            scenario.input.sessions ?? [],
            date,
            policy.project.timezone,
          );
          const input = dayInput(scenario, policy, date, sessions);
          input.pool = { accruedEquityKopecks: BigInt(scenario.input.accruedEquityKopecks ?? "0") };
          const result = calculateDay(input);
          assertExpectation(result, expectSpec);
          break;
        }
        case "vesting": {
          const params = {
            enabled: true,
            months: scenario.input.months ?? 48,
            cliffMonths: scenario.input.cliffMonths ?? 12,
          };
          const fraction = vestingFraction(scenario.input.activeMonths ?? 0, params);
          const split = splitVestedShare(
            BigInt(scenario.input.shareBp ?? "0"),
            scenario.input.activeMonths ?? 0,
            params,
          );
          expect(`${fraction.n}/${fraction.d}`).toBe(
            (scenario.expect as { fraction?: string } | undefined)?.fraction,
          );
          expect(split.vested.toString()).toBe(
            (scenario.expect as { vestedShareBp?: string } | undefined)?.vestedShareBp,
          );
          break;
        }
      }
    });
  });
}

describe("fixtures", () => {
  it("базовая политика проходит схему и V-01…V-08", () => {
    const policy = loadPolicy(basePolicyDocument);
    expect(policy.meta.tenantId).toBe("demo");
    expect(policy.economics.currentRateKopecksPerHour).toBe(50_000n);
    expect(policy.economics.currentValuationKopecks).toBe(1_000_000_000n);
  });

  it("все сценарии имеют уникальные id и источник", () => {
    const ids = new Set<string>();
    for (const scenario of scenariosFile.scenarios) {
      expect(ids.has(scenario.id), `дубль ${scenario.id}`).toBe(false);
      ids.add(scenario.id);
      expect(scenario.source.length).toBeGreaterThan(0);
    }
    expect(ids.size).toBe(20);
  });
});
