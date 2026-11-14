import { div, mul, ratio, roundHalfUp } from "../rational.js";
import type { BasisPoints, Kopecks } from "../units.js";

/**
 * Пул участников и режим pending (R12, R15).
 *
 * pool_budget = valuation × pool_pct
 * pool_used_bp = Σ equity / pool_budget × 10000
 *
 * При used ≥ 100 % новый день получает pending: рубли копятся, доля не растет.
 */

export const POOL_PENDING_BP = 10_000n;

export interface PoolInput {
  valuationKopecks: Kopecks;
  poolPctBp: BasisPoints;
  /** Накопленный вклад участников (equity) до текущего дня, копейки. */
  accruedEquityKopecks: Kopecks;
}

export interface PoolStatus {
  budgetKopecks: Kopecks;
  usedBp: BasisPoints;
  /** true, когда бюджет пула исчерпан и новые дни идут в pending. */
  pending: boolean;
  remainingKopecks: Kopecks;
}

export function poolStatus(input: PoolInput): PoolStatus {
  const budget = roundHalfUp(
    div(mul(ratio(input.valuationKopecks), ratio(input.poolPctBp)), ratio(10_000n)),
  );
  if (budget <= 0n) {
    return { budgetKopecks: 0n, usedBp: POOL_PENDING_BP, pending: true, remainingKopecks: 0n };
  }
  const usedBp = roundHalfUp(
    div(mul(ratio(input.accruedEquityKopecks), ratio(10_000n)), ratio(budget)),
  );
  const remaining = budget - input.accruedEquityKopecks;
  return {
    budgetKopecks: budget,
    usedBp: usedBp < 0n ? 0n : usedBp,
    pending: usedBp >= POOL_PENDING_BP,
    remainingKopecks: remaining > 0n ? remaining : 0n,
  };
}

export type PoolWarning = "ok" | "info" | "warning" | "closed";

/** Порог предупреждений для дайджеста (equity-model §4). */
export function poolWarning(
  usedBp: BasisPoints,
  infoPctBp: BasisPoints,
  warnPctBp: BasisPoints,
): PoolWarning {
  if (usedBp >= POOL_PENDING_BP) return "closed";
  if (usedBp >= warnPctBp) return "warning";
  if (usedBp >= infoPctBp) return "info";
  return "ok";
}
