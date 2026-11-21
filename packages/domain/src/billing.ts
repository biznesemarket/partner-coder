/** Сроки и автопереходы подписки, утвержденные в `docs/01-product/pricing.md`. */

export type SubscriptionLifecycleStatus =
  "trial" | "active" | "grace" | "expired" | "suspended" | "cancelled";

export interface SubscriptionLifecycleState {
  readonly status: SubscriptionLifecycleStatus;
  /** Дата окончания оплаченного периода или trial, YYYY-MM-DD. */
  readonly periodEnd: string;
  readonly graceUntil: Date | null;
  readonly statusChangedAt: Date;
}

export type SubscriptionLifecycleTransitionReason =
  "period_ended" | "trial_ended" | "grace_ended" | "expired_limit";

export interface SubscriptionLifecycleTransition {
  readonly from: "trial" | "active" | "grace" | "expired";
  readonly to: "grace" | "expired" | "suspended";
  readonly reason: SubscriptionLifecycleTransitionReason;
  readonly graceUntil: Date | null;
  readonly statusChangedAt: Date;
}

export const BILLING_GRACE_DAYS = 7;
export const BILLING_EXPIRED_DAYS = 30;

const MS_PER_DAY = 86_400_000;

function startOfUtcDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`Ожидалась дата YYYY-MM-DD, получено "${date}"`);
  }
  return Date.UTC(
    Number.parseInt(match[1] as string, 10),
    Number.parseInt(match[2] as string, 10) - 1,
    Number.parseInt(match[3] as string, 10),
  );
}

/**
 * Следующий автопереход или null.
 *
 * `active -> grace` наступает в 00:00 UTC даты `period_end`; `grace -> expired`
 * — в `grace_until`; `expired -> suspended` — через 30 дней после начала
 * expired. Время перехода фиксируется по календарной границе, а не по моменту
 * запуска worker, чтобы поздний запуск не продлевал льготный период.
 */
export function nextSubscriptionTransition(
  state: SubscriptionLifecycleState,
  now: Date,
): SubscriptionLifecycleTransition | null {
  const nowMs = now.getTime();

  if (state.status === "active") {
    const periodEndMs = startOfUtcDate(state.periodEnd);
    if (nowMs < periodEndMs) {
      return null;
    }
    return {
      from: "active",
      to: "grace",
      reason: "period_ended",
      graceUntil: new Date(periodEndMs + BILLING_GRACE_DAYS * MS_PER_DAY),
      statusChangedAt: new Date(periodEndMs),
    };
  }

  if (state.status === "trial") {
    const periodEndMs = startOfUtcDate(state.periodEnd);
    if (nowMs < periodEndMs) {
      return null;
    }
    return {
      from: "trial",
      to: "expired",
      reason: "trial_ended",
      graceUntil: null,
      statusChangedAt: new Date(periodEndMs),
    };
  }

  if (state.status === "grace") {
    const graceUntilMs =
      state.graceUntil?.getTime() ??
      startOfUtcDate(state.periodEnd) + BILLING_GRACE_DAYS * MS_PER_DAY;
    if (nowMs < graceUntilMs) {
      return null;
    }
    return {
      from: "grace",
      to: "expired",
      reason: "grace_ended",
      graceUntil: null,
      statusChangedAt: new Date(graceUntilMs),
    };
  }

  if (state.status === "expired") {
    const suspendedAtMs = state.statusChangedAt.getTime() + BILLING_EXPIRED_DAYS * MS_PER_DAY;
    if (nowMs < suspendedAtMs) {
      return null;
    }
    return {
      from: "expired",
      to: "suspended",
      reason: "expired_limit",
      graceUntil: null,
      statusChangedAt: new Date(suspendedAtMs),
    };
  }

  return null;
}
