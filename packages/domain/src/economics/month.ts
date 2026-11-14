import { div, mul, ratio, roundHalfUp } from "../rational.js";
import type { ProjectPolicy } from "../policy/policy.js";
import type { BasisPoints, Kopecks, ShareUnits } from "../units.js";
import type { DayCalculation } from "./calculator.js";
import {
  activeMonthProgress,
  isActiveMonth,
  vestingParamsOf,
  vestingState,
  type VestingState,
} from "./vesting.js";

/**
 * Месячные агрегаты и отображаемая доля.
 *
 * Накопленные рубли никогда не пересчитываются: месячный итог — сумма
 * закрытых дней, а отображаемая доля пересчитывается от текущей оценки
 * (equity-model §3). Доля месяца — сумма долей закрытых дней, каждая из
 * которых уже округлена на своем шаге.
 */

export interface MonthAggregate {
  /** Месяц YYYY-MM. */
  month: string;
  daysClosed: number;
  paidSeconds: number;
  /** Оплачиваемые часы строкой с двумя знаками: "145.20". */
  paidHours: string;
  amountKopecks: Kopecks;
  cashKopecks: Kopecks;
  equityKopecks: Kopecks;
  shareBp: ShareUnits;
  pendingEquityKopecks: Kopecks;
  activeMonth: boolean;
  progressToActiveMonth: { hours: string; thresholdHours: string; reached: boolean };
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function aggregateMonth(
  days: readonly DayCalculation[],
  policy: ProjectPolicy,
): MonthAggregate {
  if (days.length === 0) {
    throw new RangeError("aggregateMonth: нужен хотя бы один закрытый день");
  }
  const months = new Set(days.map((day) => monthOf(day.date)));
  if (months.size > 1) {
    throw new RangeError(`aggregateMonth: дни из разных месяцев (${[...months].join(", ")})`);
  }

  let paidSeconds = 0;
  let amountKopecks = 0n;
  let cashKopecks = 0n;
  let equityKopecks = 0n;
  let shareBp = 0n;
  let pendingEquityKopecks = 0n;

  for (const day of days) {
    paidSeconds += day.paidSeconds;
    amountKopecks += day.amountKopecks;
    cashKopecks += day.cashKopecks;
    equityKopecks += day.equityKopecks;
    shareBp += day.shareBp;
    pendingEquityKopecks += day.pendingEquityKopecks;
  }

  return {
    month: [...months][0] as string,
    daysClosed: days.length,
    paidSeconds,
    paidHours: hoursString(paidSeconds),
    amountKopecks,
    cashKopecks,
    equityKopecks,
    shareBp,
    pendingEquityKopecks,
    activeMonth: isActiveMonth({ paidSeconds, equityKopecks }, policy),
    progressToActiveMonth: activeMonthProgress(paidSeconds, policy),
  };
}

/** Отображаемая доля «рубли вклада / текущая оценка». */
export function displayShare(equityKopecks: Kopecks, valuationKopecks: Kopecks): ShareUnits {
  if (valuationKopecks <= 0n) {
    throw new RangeError("displayShare: оценка должна быть больше нуля");
  }
  return roundHalfUp(div(mul(ratio(equityKopecks), ratio(1_000_000n)), ratio(valuationKopecks)));
}

export function countActiveMonths(months: readonly MonthAggregate[]): number {
  return months.filter((month) => month.activeMonth).length;
}

/** Итог по всем месяцам: часы, рубли, доля и вестинг. */
export interface CumulativeSummary {
  paidSeconds: number;
  paidHours: string;
  amountKopecks: Kopecks;
  equityKopecks: Kopecks;
  shareBp: ShareUnits;
  activeMonths: number;
  vesting: VestingState;
}

export function cumulativeSummary(
  months: readonly MonthAggregate[],
  policy: ProjectPolicy,
): CumulativeSummary {
  let paidSeconds = 0;
  let amountKopecks = 0n;
  let equityKopecks = 0n;
  let shareBp = 0n;
  for (const month of months) {
    paidSeconds += month.paidSeconds;
    amountKopecks += month.amountKopecks;
    equityKopecks += month.equityKopecks;
    shareBp += month.shareBp;
  }
  const activeMonths = countActiveMonths(months);
  return {
    paidSeconds,
    paidHours: hoursString(paidSeconds),
    amountKopecks,
    equityKopecks,
    shareBp,
    activeMonths,
    vesting: vestingState(activeMonths, vestingParamsOf(policy)),
  };
}

export function hoursString(paidSeconds: number): string {
  const hundredths = roundHalfUp(mul(ratio(BigInt(paidSeconds), 3600n), ratio(100n)));
  return (Number(hundredths) / 100).toFixed(2);
}

/** Доля пула в базисных пунктах по накопленному вкладу. */
export function poolUsedBp(
  equityKopecks: Kopecks,
  valuationKopecks: Kopecks,
  poolPctBp: BasisPoints,
): BasisPoints {
  const budget = roundHalfUp(div(mul(ratio(valuationKopecks), ratio(poolPctBp)), ratio(10_000n)));
  if (budget <= 0n) return 10_000n;
  return roundHalfUp(div(mul(ratio(equityKopecks), ratio(10_000n)), ratio(budget)));
}
