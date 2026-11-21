import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { subscriptions } from "../schema/vendor.js";

export type Subscription = typeof subscriptions.$inferSelect;

export interface CreateSubscriptionInput {
  readonly customerId: string;
  readonly contractId: string;
  readonly status?: Subscription["status"];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly graceUntil?: Date | null;
  readonly seats: number;
  readonly projectsLimit: number;
}

export interface ListSubscriptionsOptions {
  readonly customerId?: string;
  readonly status?: Subscription["status"];
  readonly limit?: number;
}

export interface UpdateSubscriptionStatusInput {
  readonly status: Subscription["status"];
  readonly graceUntil?: Date | null;
  readonly changedAt?: Date;
}

export interface RenewSubscriptionInput {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly changedAt?: Date;
}

export async function listSubscriptions(
  db: Database,
  options: ListSubscriptionsOptions = {},
): Promise<readonly Subscription[]> {
  const conditions = [];
  if (options.customerId !== undefined) {
    conditions.push(eq(subscriptions.customerId, options.customerId));
  }
  if (options.status !== undefined) {
    conditions.push(eq(subscriptions.status, options.status));
  }

  return db
    .select()
    .from(subscriptions)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(subscriptions.periodStart), desc(subscriptions.createdAt))
    .limit(options.limit ?? 100);
}

export async function getSubscriptionById(
  db: Database,
  subscriptionId: string,
): Promise<Subscription | null> {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  return subscription ?? null;
}

export async function createSubscription(
  db: Database,
  input: CreateSubscriptionInput,
): Promise<Subscription> {
  const [subscription] = await db
    .insert(subscriptions)
    .values({
      customerId: input.customerId,
      contractId: input.contractId,
      status: input.status ?? "trial",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      graceUntil: input.graceUntil ?? null,
      seats: input.seats,
      projectsLimit: input.projectsLimit,
    })
    .returning();

  if (!subscription) {
    throw new Error("Failed to create subscription");
  }
  return subscription;
}

export async function updateSubscriptionStatus(
  db: Database,
  subscriptionId: string,
  input: UpdateSubscriptionStatusInput,
): Promise<Subscription | null> {
  const changedAt = input.changedAt ?? new Date();
  const [subscription] = await db
    .update(subscriptions)
    .set({
      status: input.status,
      graceUntil: input.graceUntil === undefined ? null : input.graceUntil,
      statusChangedAt: changedAt,
      updatedAt: changedAt,
    })
    .where(eq(subscriptions.id, subscriptionId))
    .returning();
  return subscription ?? null;
}

export async function renewSubscription(
  db: Database,
  subscriptionId: string,
  input: RenewSubscriptionInput,
): Promise<Subscription | null> {
  const changedAt = input.changedAt ?? new Date();
  const [subscription] = await db
    .update(subscriptions)
    .set({
      status: "active",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      graceUntil: null,
      statusChangedAt: changedAt,
      updatedAt: changedAt,
    })
    .where(eq(subscriptions.id, subscriptionId))
    .returning();
  return subscription ?? null;
}
