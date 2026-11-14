/**
 * Единицы измерения домена.
 *
 * | Тип          | Что это                          | Пример                |
 * |--------------|----------------------------------|-----------------------|
 * | Kopecks      | деньги, целые копейки            | 330000n = 3 300,00 ₽  |
 * | BasisPoints  | проценты, 1 bp = 0,01 %          | 10000n = 100 %        |
 * | ShareUnits   | доля, 1 = 0,0001 % (1e-6)        | 330n = 0,0330 %       |
 * | Seconds      | время, целые секунды             | 23760 = 6,6 ч         |
 *
 * `ShareUnits` и `BasisPoints` намеренно разные: формула доли дня
 * (`amount × 1e6 / valuation`) дает 1 % = 10000 единиц доли, а формула пула
 * (`equity × 10000 / budget`) дает 1 % = 100 bp. Обе формулы зафиксированы
 * в нормативной спецификации (docs/02-domain/economics.md).
 */

export type Seconds = number & { readonly __seconds: unique symbol };
export type Kopecks = bigint;
export type BasisPoints = bigint;
export type ShareUnits = bigint;

export const SECONDS_PER_HOUR = 3600;
export const MS_PER_SECOND = 1000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function seconds(value: number): Seconds {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Ожидались целые неотрицательные секунды, получено ${value}`);
  }
  return value as Seconds;
}

export function kopecks(value: bigint): Kopecks {
  return value;
}

export function hoursToSeconds(hours: number): Seconds {
  return seconds(Math.round(hours * SECONDS_PER_HOUR));
}

/** Доля дня в процентах для отображения: 330 → "0.0330". */
export function shareUnitsToPercent(value: ShareUnits): string {
  return formatScaled(value, 4);
}

/** Базисные пункты в процентах: 10000 → "100.00". */
export function basisPointsToPercent(value: BasisPoints): string {
  return formatScaled(value, 2);
}

export function formatRoubles(value: Kopecks): string {
  return formatScaled(value, 2);
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const sign = negative ? "-" : "";
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
