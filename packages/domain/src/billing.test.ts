import { describe, expect, it } from "vitest";

import { nextSubscriptionTransition } from "./billing.js";

const graceDeadline = new Date("2026-12-08T00:00:00.000Z");

describe("жизненный цикл подписки", () => {
  it("переводит active в grace в начале даты окончания периода", () => {
    const state = {
      status: "active" as const,
      periodEnd: "2026-12-01",
      graceUntil: null,
      statusChangedAt: new Date("2026-11-01T00:00:00.000Z"),
    };

    expect(nextSubscriptionTransition(state, new Date("2026-11-30T23:59:59.999Z"))).toBeNull();
    expect(nextSubscriptionTransition(state, new Date("2026-12-01T00:00:00.000Z"))).toEqual({
      from: "active",
      to: "grace",
      reason: "period_ended",
      graceUntil: graceDeadline,
      statusChangedAt: new Date("2026-12-01T00:00:00.000Z"),
    });
  });

  it("переводит grace в expired по grace_until и отсчитывает expired от него", () => {
    const state = {
      status: "grace" as const,
      periodEnd: "2026-12-01",
      graceUntil: graceDeadline,
      statusChangedAt: new Date("2026-12-01T00:00:00.000Z"),
    };

    expect(nextSubscriptionTransition(state, new Date("2026-12-07T23:59:59.999Z"))).toBeNull();
    expect(nextSubscriptionTransition(state, new Date("2026-12-08T00:00:00.000Z"))).toEqual({
      from: "grace",
      to: "expired",
      reason: "grace_ended",
      graceUntil: null,
      statusChangedAt: graceDeadline,
    });
  });

  it("переводит expired в suspended через 30 дней после начала expired", () => {
    const state = {
      status: "expired" as const,
      periodEnd: "2026-12-01",
      graceUntil: null,
      statusChangedAt: graceDeadline,
    };

    expect(nextSubscriptionTransition(state, new Date("2027-01-06T23:59:59.999Z"))).toBeNull();
    expect(nextSubscriptionTransition(state, new Date("2027-01-07T00:00:00.000Z"))).toEqual({
      from: "expired",
      to: "suspended",
      reason: "expired_limit",
      graceUntil: null,
      statusChangedAt: new Date("2027-01-07T00:00:00.000Z"),
    });
  });

  it("переводит trial в expired без grace и считает 30 дней от конца trial", () => {
    const state = {
      status: "trial" as const,
      periodEnd: "2026-11-20",
      graceUntil: null,
      statusChangedAt: new Date("2026-11-06T00:00:00.000Z"),
    };

    expect(nextSubscriptionTransition(state, new Date("2026-11-19T23:59:59.999Z"))).toBeNull();
    expect(nextSubscriptionTransition(state, new Date("2026-11-20T00:00:00.000Z"))).toEqual({
      from: "trial",
      to: "expired",
      reason: "trial_ended",
      graceUntil: null,
      statusChangedAt: new Date("2026-11-20T00:00:00.000Z"),
    });
  });

  it("оставляет suspended и cancelled без автопереходов", () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    expect(
      nextSubscriptionTransition(
        {
          status: "suspended",
          periodEnd: "2026-12-01",
          graceUntil: null,
          statusChangedAt: new Date("2026-12-01T00:00:00.000Z"),
        },
        now,
      ),
    ).toBeNull();
    expect(
      nextSubscriptionTransition(
        {
          status: "cancelled",
          periodEnd: "2026-12-01",
          graceUntil: null,
          statusChangedAt: new Date("2026-12-01T00:00:00.000Z"),
        },
        now,
      ),
    ).toBeNull();
  });
});
