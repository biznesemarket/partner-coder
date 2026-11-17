import { describe, expect, it } from "vitest";

import {
  clearOtpSlot,
  normalizeBackupCode,
  normalizeOtp,
  otpSlots,
  otpSlotsToValue,
  setOtpSlots,
} from "./code";

describe("normalizeOtp", () => {
  it("оставляет в OTP только цифры и ограничивает шесть", () => {
    expect(normalizeOtp("12 34-56 78")).toBe("123456");
    expect(normalizeOtp("abc")).toBe("");
  });
});

describe("normalizeBackupCode", () => {
  it("нормализует резервный код без смены регистра", () => {
    expect(normalizeBackupCode("  Ab-Cd  ")).toBe("Ab-Cd");
  });
});

describe("otpSlots", () => {
  it("сохраняет позицию после удаления средней цифры", () => {
    const slots = otpSlots("123456");
    const next = clearOtpSlot(slots, 2);

    expect(otpSlotsToValue(next)).toBe("12 456");
    expect(otpSlots(otpSlotsToValue(next))).toEqual(["1", "2", "", "4", "5", "6"]);
  });

  it("заполняет пропуск, не сдвигая последующие цифры", () => {
    const slots = otpSlots("12 456");
    const next = setOtpSlots(slots, 2, "3");

    expect(otpSlotsToValue(next)).toBe("123456");
  });

  it("читает компактное значение слева направо", () => {
    expect(otpSlots("123")).toEqual(["1", "2", "3", "", "", ""]);
    expect(otpSlots("")).toEqual(["", "", "", "", "", ""]);
  });
});
