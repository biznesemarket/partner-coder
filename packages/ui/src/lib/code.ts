export const OTP_LENGTH = 6;

const DIGIT_ONLY = /^[0-9]$/;

function toSlotArray(slots: readonly string[]): Array<string> {
  return Array.from({ length: OTP_LENGTH }, (_, index) => {
    const slot = slots[index] ?? "";
    return DIGIT_ONLY.test(slot) ? slot : "";
  });
}

export function normalizeOtp(value: string): string {
  return value.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export function normalizeBackupCode(value: string): string {
  return value.trim();
}

/**
 * Разбирает контролируемое значение CodeInput в шесть позиционных слотов.
 *
 * Если строка содержит пробел, она читается позиционно: пробел — пустой слот,
 * например `"12 456"` → `["1", "2", "", "4", "5", "6"]`. Компактная строка без
 * пробелов (`"123"`) заполняется слева направо, как обычный OTP.
 */
export function otpSlots(value: string): Array<string> {
  if (value.length <= OTP_LENGTH && value.includes(" ")) {
    return Array.from({ length: OTP_LENGTH }, (_, index) => {
      const char = value[index] ?? "";
      return DIGIT_ONLY.test(char) ? char : "";
    });
  }

  const digits = normalizeOtp(value);

  return Array.from({ length: OTP_LENGTH }, (_, index) => digits[index] ?? "");
}

/**
 * Собирает позиционные слоты в значение CodeInput: пробелы сохраняют пустые
 * позиции, хвостовые пустые слоты опускаются. Для отправки используйте
 * `normalizeOtp(value)`.
 */
export function otpSlotsToValue(slots: readonly string[]): string {
  const chars = toSlotArray(slots).map((char) => (char === "" ? " " : char));
  let end = chars.length;

  while (end > 0 && chars[end - 1] === " ") {
    end -= 1;
  }

  return chars.slice(0, end).join("");
}

export function setOtpSlots(
  slots: readonly string[],
  startIndex: number,
  input: string,
): Array<string> {
  const next = toSlotArray(slots);
  const digits = normalizeOtp(input);
  const start = Math.max(startIndex, 0);
  const available = Math.min(digits.length, OTP_LENGTH - start);

  for (let offset = 0; offset < available; offset += 1) {
    next[start + offset] = digits[offset] ?? "";
  }

  return next;
}

export function clearOtpSlot(slots: readonly string[], index: number): Array<string> {
  const next = toSlotArray(slots);

  if (index >= 0 && index < OTP_LENGTH) {
    next[index] = "";
  }

  return next;
}
