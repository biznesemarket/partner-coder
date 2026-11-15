import { describe, expect, it } from "vitest";

import { dateRange, dueCloseDate } from "./schedule.js";

describe("расписание закрытия дня", () => {
  it("в полночь по поясу проекта закрывает предыдущую локальную дату", () => {
    expect(dueCloseDate(new Date("2026-11-02T20:59:00Z"), "Europe/Moscow", "00:00")).toBe(
      "2026-11-01",
    );
    expect(dueCloseDate(new Date("2026-11-02T21:00:00Z"), "Europe/Moscow", "00:00")).toBe(
      "2026-11-02",
    );
  });

  it("учитывает неполночный close_at", () => {
    expect(dueCloseDate(new Date("2026-11-02T23:59:00Z"), "Europe/Moscow", "03:00")).toBe(
      "2026-11-01",
    );
    expect(dueCloseDate(new Date("2026-11-03T00:00:00Z"), "Europe/Moscow", "03:00")).toBe(
      "2026-11-02",
    );
  });

  it("строит диапазон дат включительно и ограничивает его", () => {
    expect(dateRange("2026-11-01", "2026-11-03")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(dateRange("2026-10-01", "2026-11-03", 2)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(dateRange("2026-11-03", "2026-11-01")).toEqual([]);
  });
});
