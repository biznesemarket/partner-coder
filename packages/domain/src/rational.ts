/**
 * Точная рациональная арифметика на BigInt.
 *
 * Деньги, доли и коэффициенты политики никогда не считаются во float
 * (инвариант 9, ADR-0003). Любое деление выполняется последним шагом
 * с округлением ROUND_HALF_UP.
 */

export interface Ratio {
  readonly n: bigint;
  readonly d: bigint;
}

export const RATIO_ZERO: Ratio = { n: 0n, d: 1n };
export const RATIO_ONE: Ratio = { n: 1n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

/** Создает нормализованную дробь; знаменатель приводится к положительному. */
export function ratio(n: bigint, d: bigint = 1n): Ratio {
  if (d === 0n) {
    throw new RangeError("ratio: нулевой знаменатель");
  }
  const sign = d < 0n ? -1n : 1n;
  const num = n * sign;
  const den = d * sign;
  const g = gcd(num, den);
  return { n: num / g, d: den / g };
}

export function fromInt(value: bigint | number): Ratio {
  return typeof value === "bigint" ? { n: value, d: 1n } : ratio(BigInt(value));
}

export function add(a: Ratio, b: Ratio): Ratio {
  return ratio(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Ratio, b: Ratio): Ratio {
  return ratio(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Ratio, b: Ratio): Ratio {
  return ratio(a.n * b.n, a.d * b.d);
}

export function div(a: Ratio, b: Ratio): Ratio {
  if (b.n === 0n) {
    throw new RangeError("ratio: деление на ноль");
  }
  return ratio(a.n * b.d, a.d * b.n);
}

export function neg(a: Ratio): Ratio {
  return { n: -a.n, d: a.d };
}

export function cmp(a: Ratio, b: Ratio): -1 | 0 | 1 {
  const left = a.n * b.d;
  const right = b.n * a.d;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function eq(a: Ratio, b: Ratio): boolean {
  return cmp(a, b) === 0;
}

export function isZero(a: Ratio): boolean {
  return a.n === 0n;
}

export function isNegative(a: Ratio): boolean {
  return a.n < 0n;
}

export function minRatio(a: Ratio, b: Ratio): Ratio {
  return cmp(a, b) <= 0 ? a : b;
}

export function maxRatio(a: Ratio, b: Ratio): Ratio {
  return cmp(a, b) >= 0 ? a : b;
}

/**
 * Округление половины вверх (ROUND_HALF_UP): 0,5 → 1, −0,5 → −1.
 * Единственное место, где точная дробь превращается в целое.
 */
export function roundHalfUp(value: Ratio): bigint {
  const negative = value.n < 0n;
  const n = negative ? -value.n : value.n;
  const q = n / value.d;
  const rem = n % value.d;
  const rounded = rem * 2n >= value.d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

export function floorRatio(value: Ratio): bigint {
  const q = value.n / value.d;
  const rem = value.n % value.d;
  return rem < 0n ? q - 1n : q;
}

/** Приблизительное значение только для отображения и логов. */
export function approx(value: Ratio): number {
  return Number(value.n) / Number(value.d);
}

/** Форматирует дробь как десятичную строку с фиксированным числом знаков. */
export function toDecimalString(value: Ratio, scale: number): string {
  const factor = 10n ** BigInt(scale);
  const scaled = roundHalfUp(mul(value, { n: factor, d: 1n }));
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const digits = abs.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const sign = negative ? "-" : "";
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
