import { ratio, type Ratio } from "./rational.js";

/**
 * Разбор десятичных значений политики в точные дроби.
 *
 * Принимает строки ("0.2", "12.5") и числа (0.2) — число переводится
 * через его десятичное представление, а не через двоичную мантиссу.
 * Экспоненциальная запись ("1e-7") поддерживается.
 */

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

export class DecimalParseError extends Error {
  constructor(readonly input: string) {
    super(`Некорректное десятичное значение: "${input}"`);
    this.name = "DecimalParseError";
  }
}

export function parseDecimal(input: string | number | bigint): Ratio {
  if (typeof input === "bigint") return ratio(input);
  const text = typeof input === "number" ? numberToPlainString(input) : input.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new DecimalParseError(text);

  const [, sign, whole, fraction = "", exponentText = "0"] = match;
  const digits = `${whole}${fraction}`;
  const exponent = Number.parseInt(exponentText, 10) - fraction.length;
  const numerator = BigInt(`${sign === "-" ? "-" : ""}${digits}`);
  if (exponent >= 0) {
    return ratio(numerator * 10n ** BigInt(exponent));
  }
  return ratio(numerator, 10n ** BigInt(-exponent));
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new DecimalParseError(String(value));
  }
  const text = String(value);
  return text;
}

/** Десятичная запись дроби без потери точности, если она конечна. */
export function decimalString(value: Ratio, maxScale = 8): string {
  for (let scale = 0; scale <= maxScale; scale += 1) {
    const factor = 10n ** BigInt(scale);
    if ((value.n * factor) % value.d === 0n) {
      const scaled = (value.n * factor) / value.d;
      const negative = scaled < 0n;
      const abs = negative ? -scaled : scaled;
      const digits = abs.toString().padStart(scale + 1, "0");
      const whole = digits.slice(0, digits.length - scale);
      const fraction = digits.slice(digits.length - scale);
      const sign = negative ? "-" : "";
      return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
    }
  }
  return `${value.n}/${value.d}`;
}

/** Проценты (0…100) в базисные пункты, где 1 bp = 0,01 %. */
export function percentToBasisPoints(value: string | number): bigint {
  const parsed = parseDecimal(value);
  const scaled = parsed.n * 100n;
  if (scaled % parsed.d !== 0n) {
    throw new RangeError(`Процент ${value} не представим в целых базисных пунктах`);
  }
  return scaled / parsed.d;
}
