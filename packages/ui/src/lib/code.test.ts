import { describe, expect, it } from "vitest";

import { normalizeBackupCode, normalizeOtp } from "./code";

describe("normalizeOtp", () => {
  it("оставляет в OTP только цифры и ограничивает шесть", () => {
    expect(normalizeOtp("12 34-56 78")).toBe("123456");
    expect(normalizeOtp("abc")).toBe("");
  });
});

describe("normalizeBackupCode", () => {
  it("нормализует резервный код без смены регистра", () => {
    expect(normalizeBackupCode("  ab-cd  ")).toBe("ab-cd");
  });
});
