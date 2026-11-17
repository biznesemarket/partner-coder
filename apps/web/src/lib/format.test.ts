import { describe, expect, it } from "vitest";

import { formatDateTime } from "./format";

describe("formatDateTime", () => {
  it("форматирует дату по-русски: длинная дата и короткое время", () => {
    const formatted = formatDateTime(new Date(2026, 10, 16, 10, 25));

    expect(formatted).toContain("16");
    expect(formatted).toContain("ноябр");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("10:25");
  });

  it("принимает ISO-строку", () => {
    expect(formatDateTime("2026-11-16T10:25:00.000Z")).toMatch(/2026/);
  });

  it("возвращает прочерк для невалидного значения", () => {
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});
