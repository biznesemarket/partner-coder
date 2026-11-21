import { and, asc, eq, inArray } from "drizzle-orm";

import { customers, subscriptions, writeVendorAudit, type Database } from "@partner-coder/db";
import { nextSubscriptionTransition } from "@partner-coder/domain";

const LIFECYCLE_STATUSES = ["trial", "active", "grace", "expired"] as const;
const CUSTOMER_LIFECYCLE_STATUSES = ["trial", "active", "grace", "expired", "suspended"] as const;

export interface BillingStatusOptions {
  readonly now?: Date;
  readonly limit?: number;
}

export interface BillingStatusResult {
  readonly checked: number;
  readonly transitions: number;
}

/**
 * Проверяет подписки и выполняет утвержденные автопереходы:
 * `trial -> expired`, `active -> grace -> expired -> suspended`.
 *
 * Время перехода определяется доменной функцией по календарным границам, а не
 * по моменту запуска. Один запуск может провести подписку через несколько
 * состояний (например, после долгого простоя worker).
 */
export async function advanceBillingStatuses(
  db: Database,
  options: BillingStatusOptions = {},
): Promise<BillingStatusResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 1000;

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(subscriptions)
      .where(inArray(subscriptions.status, LIFECYCLE_STATUSES))
      .orderBy(asc(subscriptions.periodEnd), asc(subscriptions.id))
      .limit(limit);

    let transitions = 0;

    for (const row of rows) {
      let current = row;

      for (let step = 0; step < 4; step += 1) {
        const transition = nextSubscriptionTransition(
          {
            status: current.status,
            periodEnd: current.periodEnd,
            graceUntil: current.graceUntil,
            statusChangedAt: current.statusChangedAt,
          },
          now,
        );
        if (transition === null) {
          break;
        }

        const [updated] = await tx
          .update(subscriptions)
          .set({
            status: transition.to,
            graceUntil: transition.graceUntil,
            statusChangedAt: transition.statusChangedAt,
            updatedAt: now,
          })
          .where(and(eq(subscriptions.id, current.id), eq(subscriptions.status, current.status)))
          .returning();

        if (!updated) {
          break;
        }

        await tx
          .update(customers)
          .set({ status: transition.to, updatedAt: now })
          .where(
            and(
              eq(customers.id, current.customerId),
              inArray(customers.status, CUSTOMER_LIFECYCLE_STATUSES),
            ),
          );

        await writeVendorAudit(tx, {
          actorId: null,
          customerId: current.customerId,
          action: "vendor.subscription.auto_transitioned",
          entity: "subscription",
          before: {
            status: current.status,
            periodEnd: current.periodEnd,
            graceUntil: current.graceUntil?.toISOString() ?? null,
          },
          after: {
            subscriptionId: current.id,
            status: transition.to,
            reason: transition.reason,
            graceUntil: transition.graceUntil?.toISOString() ?? null,
          },
        });

        current = updated;
        transitions += 1;
      }
    }

    return { checked: rows.length, transitions };
  });
}
