import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";

import type { Database } from "../client.js";
import { subscriptionDiscounts } from "../schema/vendor.js";

export type SubscriptionDiscount = typeof subscriptionDiscounts.$inferSelect;

export interface CreateDiscountInput {
  readonly subscriptionId: string;
  readonly percentBp: number;
  readonly startsOn: string;
  readonly endsOn?: string | null;
  readonly note?: string | null;
  readonly createdBy: string;
}

export async function listDiscounts(
  db: Database,
  subscriptionId: string,
): Promise<readonly SubscriptionDiscount[]> {
  return db
    .select()
    .from(subscriptionDiscounts)
    .where(eq(subscriptionDiscounts.subscriptionId, subscriptionId))
    .orderBy(desc(subscriptionDiscounts.startsOn), desc(subscriptionDiscounts.createdAt));
}

export async function getActiveDiscount(
  db: Database,
  subscriptionId: string,
  onDate: string,
): Promise<SubscriptionDiscount | null> {
  const [discount] = await db
    .select()
    .from(subscriptionDiscounts)
    .where(
      and(
        eq(subscriptionDiscounts.subscriptionId, subscriptionId),
        lte(subscriptionDiscounts.startsOn, onDate),
        or(isNull(subscriptionDiscounts.endsOn), gte(subscriptionDiscounts.endsOn, onDate)),
      ),
    )
    .orderBy(desc(subscriptionDiscounts.startsOn), desc(subscriptionDiscounts.createdAt))
    .limit(1);
  return discount ?? null;
}

export async function findOverlappingDiscount(
  db: Database,
  subscriptionId: string,
  startsOn: string,
  endsOn: string | null,
): Promise<SubscriptionDiscount | null> {
  const conditions = [
    eq(subscriptionDiscounts.subscriptionId, subscriptionId),
    or(isNull(subscriptionDiscounts.endsOn), gte(subscriptionDiscounts.endsOn, startsOn)),
  ];
  if (endsOn !== null) {
    conditions.push(lte(subscriptionDiscounts.startsOn, endsOn));
  }

  const [discount] = await db
    .select()
    .from(subscriptionDiscounts)
    .where(and(...conditions))
    .orderBy(desc(subscriptionDiscounts.startsOn), desc(subscriptionDiscounts.createdAt))
    .limit(1);
  return discount ?? null;
}

export async function createDiscount(
  db: Database,
  input: CreateDiscountInput,
): Promise<SubscriptionDiscount> {
  const [discount] = await db
    .insert(subscriptionDiscounts)
    .values({
      subscriptionId: input.subscriptionId,
      percentBp: input.percentBp,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy,
    })
    .returning();

  if (!discount) {
    throw new Error("Failed to create subscription discount");
  }
  return discount;
}
