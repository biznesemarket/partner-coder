import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  classMilliseconds,
  classifyHeartbeats,
  dayWindowUtc,
  displayShare,
  hashObject,
  loadPolicy,
  percentToBasisPoints,
  PolicyValidationError,
  ratio,
  roundHalfUp,
  seconds,
  splitVestedShare,
  unionTimeline,
  validatePolicy,
  vestingFraction,
  zonedTimeToUtcMs,
  parseLocalDate,
  type PolicyDocument,
  type ProjectPolicy,
  calculateDay,
} from "./index.js";

const demoDoc = JSON.parse(
  readFileSync(new URL("../fixtures/policies/demo.policy.json", import.meta.url), "utf8"),
) as PolicyDocument;

const policy: ProjectPolicy = loadPolicy(demoDoc);

describe("rational", () => {
  it("ROUND_HALF_UP на положительных и отрицательных", () => {
    expect(roundHalfUp(ratio(1n, 2n))).toBe(1n);
    expect(roundHalfUp(ratio(3n, 2n))).toBe(2n);
    expect(roundHalfUp(ratio(-1n, 2n))).toBe(-1n);
    expect(roundHalfUp(ratio(4n, 3n))).toBe(1n);
    expect(roundHalfUp(ratio(5n, 3n))).toBe(2n);
  });

  it("деление на ноль запрещено", () => {
    expect(() => ratio(1n, 0n)).toThrow(RangeError);
  });
});

describe("decimal", () => {
  it("проценты в базисные пункты", () => {
    expect(percentToBasisPoints("20")).toBe(2000n);
    expect(percentToBasisPoints("20.5")).toBe(2050n);
    expect(percentToBasisPoints(0.2)).toBe(20n);
  });

  it("слишком точный процент отвергается", () => {
    expect(() => percentToBasisPoints("0.333")).toThrow(RangeError);
  });
});

describe("timezone", () => {
  it("сутки в Москве начинаются в 21:00 UTC предыдущего дня", () => {
    const window = dayWindowUtc("2026-11-16", "Europe/Moscow");
    expect(new Date(window.startMs).toISOString()).toBe("2026-11-15T21:00:00.000Z");
    expect(new Date(window.endMs).toISOString()).toBe("2026-11-16T21:00:00.000Z");
    expect(window.durationMs).toBe(24 * 3_600_000);
  });

  it("DST: сутки короче и длиннее на час", () => {
    const spring = dayWindowUtc("2026-03-29", "Europe/Berlin");
    expect(spring.durationMs).toBe(23 * 3_600_000);
    const autumn = dayWindowUtc("2026-10-25", "Europe/Berlin");
    expect(autumn.durationMs).toBe(25 * 3_600_000);
  });

  it("локальное время переводится в UTC с учетом пояса", () => {
    const ms = zonedTimeToUtcMs(
      { ...parseLocalDate("2026-11-16"), hour: 14, minute: 0, second: 0 },
      "Europe/Moscow",
    );
    expect(new Date(ms).toISOString()).toBe("2026-11-16T11:00:00.000Z");
  });
});

describe("union интервалов", () => {
  it("пересечения объединяются, а не суммируются", () => {
    const merged = unionTimeline([
      { startMs: 10, endMs: 12, class: "active_human" },
      { startMs: 11, endMs: 13, class: "active_human" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startMs: 10, endMs: 13 });
  });

  it("при пересечении классов побеждает более приоритетный", () => {
    const merged = unionTimeline([
      { startMs: 0, endMs: 10, class: "autonomous_agent" },
      { startMs: 2, endMs: 6, class: "active_human" },
    ]);
    expect(merged).toEqual([
      { startMs: 0, endMs: 2, class: "autonomous_agent" },
      { startMs: 2, endMs: 6, class: "active_human" },
      { startMs: 6, endMs: 10, class: "autonomous_agent" },
    ]);
  });

  it("интервал с концом раньше начала — ошибка", () => {
    expect(() => unionTimeline([{ startMs: 10, endMs: 5, class: "idle" }])).toThrow();
  });

  it("суммирует миллисекунды по классам", () => {
    const totals = classMilliseconds([
      { startMs: 0, endMs: 1000, class: "active_human" },
      { startMs: 1000, endMs: 2500, class: "autonomous_agent" },
      { startMs: 2500, endMs: 3000, class: "idle" },
    ]);
    expect(totals).toEqual({ activeMs: 1000, supervisedMs: 0, autonomousMs: 1500, idleMs: 500 });
  });
});

describe("политика", () => {
  it("V-02: версии должны возрастать", () => {
    const broken = structuredClone(demoDoc);
    broken.versions.rate.push({
      effective_from: "2026-10-01T00:00:00+03:00",
      value: 400,
      reason: "Назад в прошлое",
      approved_by: "director",
    });
    const issues = validatePolicy(broken);
    expect(issues.map((issue) => issue.code)).toContain("V-02");
  });

  it("V-05: оценке нужен ADR", () => {
    const broken = structuredClone(demoDoc);
    (broken.versions.valuation[0] as { adr_ref: string }).adr_ref = "";
    expect(() => loadPolicy(broken)).toThrow(PolicyValidationError);
  });

  it("V-07: текущая ставка должна совпадать с действующей версией", () => {
    const broken = structuredClone(demoDoc);
    broken.economics.rate_rub_per_hour = 900;
    expect(validatePolicy(broken).map((issue) => issue.code)).toContain("V-07");
  });

  it("пул + пол основателя не больше 100 %", () => {
    const broken = structuredClone(demoDoc);
    broken.economics.pool_pct = 60;
    broken.economics.founder_floor_pct = 50;
    expect(validatePolicy(broken).map((issue) => issue.code)).toContain("C-pool-sum");
  });

  it("кап автономного класса не больше дневного", () => {
    const broken = structuredClone(demoDoc);
    broken.time.autonomous_paid_cap_hours = 20;
    expect(validatePolicy(broken).map((issue) => issue.code)).toContain("C-caps");
  });

  it("неизвестный часовой пояс отвергается", () => {
    const broken = structuredClone(demoDoc);
    broken.project.timezone = "Mars/Olympus";
    expect(validatePolicy(broken).map((issue) => issue.code)).toContain("C-timezone");
  });
});

describe("идемпотентность и компенсации", () => {
  const date = "2026-11-16";
  const sessions = [
    {
      id: "s",
      membershipId: "dev-1",
      taskRef: "PC-1",
      branch: "feat/x",
      intervals: [
        {
          class: "active_human" as const,
          start: "2026-11-15T21:00:00Z",
          end: "2026-11-16T01:00:00Z",
        },
      ],
    },
  ];

  it("повторный расчет с теми же входами дает тот же хеш", () => {
    const first = calculateDay({ policy, date, sessions });
    const second = calculateDay({ policy, date, sessions });
    expect(second.inputHash).toBe(first.inputHash);
    expect(second.amountKopecks).toBe(first.amountKopecks);
  });

  it("закрытый день с тем же хешем идемпотентен", () => {
    const first = calculateDay({ policy, date, sessions });
    const repeat = calculateDay({
      policy,
      date,
      sessions,
      previous: {
        amountKopecks: first.amountKopecks,
        paidSeconds: first.paidSeconds,
        inputHash: first.inputHash,
      },
    });
    expect(repeat.idempotent).toBe(true);
    expect(repeat.adjustmentKopecks).toBeNull();
  });

  it("изменившиеся данные дают компенсацию на дельту", () => {
    const first = calculateDay({ policy, date, sessions });
    const changed = calculateDay({
      policy,
      date,
      sessions: [
        {
          ...sessions[0]!,
          intervals: [
            {
              class: "active_human" as const,
              start: "2026-11-15T21:00:00Z",
              end: "2026-11-16T03:00:00Z",
            },
          ],
        },
      ],
      previous: {
        amountKopecks: first.amountKopecks,
        paidSeconds: first.paidSeconds,
        inputHash: first.inputHash,
      },
    });
    expect(changed.amountKopecks).toBe(300_000n);
    expect(changed.adjustmentKopecks).toBe(100_000n);
  });

  it("хеш не зависит от порядка ключей", () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
  });
});

describe("классификация сигналов", () => {
  const make = (receivedAt: string, input: number, agentRunning: boolean) => ({
    receivedAt,
    signals: { inputEvents: input, scroll: 0, filesTouched: 0, focus: input > 0 },
    agentRunning,
  });

  it("ввод за последние 120 с — активная работа", () => {
    const result = classifyHeartbeats(
      [make("2026-11-16T09:00:00Z", 3, true), make("2026-11-16T09:00:30Z", 2, true)],
      policy,
    );
    expect(result.intervals[0]).toMatchObject({ class: "active_human" });
  });

  it("нет ввода, агент работает, присутствие есть — супервизия", () => {
    const result = classifyHeartbeats(
      [
        make("2026-11-16T09:00:00Z", 5, true),
        make("2026-11-16T09:04:00Z", 0, true),
        make("2026-11-16T09:04:30Z", 0, true),
      ],
      policy,
    );
    expect(result.intervals[1]).toMatchObject({ class: "supervised_agent" });
  });

  it("нет присутствия и агент работает — автономный класс", () => {
    const result = classifyHeartbeats(
      [
        make("2026-11-16T09:00:00Z", 5, false),
        make("2026-11-16T09:20:00Z", 0, true),
        make("2026-11-16T09:20:30Z", 0, true),
      ],
      policy,
    );
    expect(result.intervals[1]).toMatchObject({ class: "autonomous_agent" });
  });

  it("разрыв больше idle_timeout кредитуется не дольше порога", () => {
    const result = classifyHeartbeats(
      [make("2026-11-16T09:00:00Z", 1, true), make("2026-11-16T09:30:00Z", 0, true)],
      policy,
    );
    const interval = result.intervals[0]!;
    expect(interval.endMs - interval.startMs).toBe(policy.time.idleTimeoutSec * 1000);
  });

  it("расхождение часов фиксируется в секундах", () => {
    const result = classifyHeartbeats(
      [
        {
          receivedAt: "2026-11-16T09:00:00Z",
          clientTime: "2026-11-16T08:50:00Z",
          signals: { inputEvents: 1 },
          agentRunning: true,
        },
      ],
      policy,
    );
    expect(result.maxClockSkewSeconds).toBe(600);
  });
});

describe("вестинг и активный месяц", () => {
  it("клифф и доля", () => {
    expect(vestingFraction(11, { enabled: true, months: 48, cliffMonths: 12 }).n).toBe(0n);
    expect(vestingFraction(12, { enabled: true, months: 48, cliffMonths: 12 })).toEqual(
      ratio(1n, 4n),
    );
    expect(vestingFraction(60, { enabled: true, months: 48, cliffMonths: 12 })).toEqual(ratio(1n));
  });

  it("вестинговая часть доли округляется", () => {
    const split = splitVestedShare(100_000n, 12, { enabled: true, months: 48, cliffMonths: 12 });
    expect(split.vested).toBe(25_000n);
    expect(split.unvested).toBe(75_000n);
  });

  it("отображаемая доля падает при переоценке", () => {
    expect(displayShare(10_000_000n, 1_000_000_000n)).toBe(10_000n);
    expect(displayShare(10_000_000n, 2_000_000_000n)).toBe(5_000n);
  });
});

describe("units", () => {
  it("секунды только целые и неотрицательные", () => {
    expect(seconds(0)).toBe(0);
    expect(() => seconds(-1)).toThrow(RangeError);
    expect(() => seconds(1.5)).toThrow(RangeError);
  });
});
