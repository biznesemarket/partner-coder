import { cmp, mul, ratio, roundHalfUp, RATIO_ZERO, type Ratio } from "../rational.js";
import type { Kopecks, ShareUnits } from "../units.js";
import type { ProjectPolicy } from "../policy/policy.js";

/**
 * Вестинг по активным месяцам (R13, ADR-0019).
 *
 * fraction = 0, если активных месяцев меньше клиффа,
 *          = min(AM / months, 1) иначе.
 */

export interface VestingParams {
  enabled: boolean;
  months: number;
  cliffMonths: number;
}

export interface VestingState {
  activeMonths: number;
  fraction: Ratio;
  cliffReached: boolean;
  completed: boolean;
}

export function vestingFraction(activeMonths: number, params: VestingParams): Ratio {
  if (!params.enabled) {
    return ratio(1n);
  }
  if (activeMonths <= 0 || params.months <= 0) {
    return RATIO_ZERO;
  }
  if (activeMonths < params.cliffMonths) {
    return RATIO_ZERO;
  }
  const filled = Math.min(activeMonths, params.months);
  return ratio(BigInt(filled), BigInt(params.months));
}

export function vestingState(activeMonths: number, params: VestingParams): VestingState {
  const fraction = vestingFraction(activeMonths, params);
  return {
    activeMonths,
    fraction,
    cliffReached: fraction.n > 0n,
    completed: cmp(fraction, ratio(1n)) >= 0,
  };
}

export function vestingParamsOf(policy: ProjectPolicy): VestingParams {
  return {
    enabled: policy.vesting.enabled,
    months: policy.vesting.months,
    cliffMonths: policy.vesting.cliffMonths,
  };
}

export interface MonthActivityInput {
  paidSeconds: number;
  equityKopecks: Kopecks;
}

/** Активный месяц: порог в оплачиваемых часах или в сумме вклада. */
export function isActiveMonth(input: MonthActivityInput, policy: ProjectPolicy): boolean {
  switch (policy.vesting.activeMonthRule) {
    case "paid_hours": {
      const hours = ratio(BigInt(input.paidSeconds), 3600n);
      return cmp(hours, policy.vesting.activeMonthMinPaidHours) >= 0;
    }
    case "amount":
      return input.equityKopecks >= policy.vesting.activeMonthMinAmountKopecks;
  }
}

/** Прогресс текущего месяца до порога активного месяца. */
export function activeMonthProgress(
  paidSeconds: number,
  policy: ProjectPolicy,
): { hours: string; thresholdHours: string; reached: boolean } {
  const hours = ratio(BigInt(paidSeconds), 3600n);
  const reached = cmp(hours, policy.vesting.activeMonthMinPaidHours) >= 0;
  return {
    hours: formatHours(hours),
    thresholdHours: formatHours(policy.vesting.activeMonthMinPaidHours),
    reached,
  };
}

function formatHours(value: Ratio): string {
  const scaled = roundHalfUp(mul(value, ratio(100n)));
  return (Number(scaled) / 100).toFixed(2);
}

/** Вестинговая и невестинговая части расчетной доли (в единицах доли). */
export function splitVestedShare(
  shareUnits: ShareUnits,
  activeMonths: number,
  params: VestingParams,
): { fraction: string; vested: ShareUnits; unvested: ShareUnits } {
  const fraction = vestingFraction(activeMonths, params);
  const vested = roundHalfUp(mul(ratio(shareUnits), fraction));
  return {
    fraction: `${fraction.n}/${fraction.d}`,
    vested,
    unvested: shareUnits - vested,
  };
}
