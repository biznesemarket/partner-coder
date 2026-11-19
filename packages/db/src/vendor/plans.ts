import { and, asc, eq, ilike } from "drizzle-orm";

import type { Database } from "../client.js";
import { plans, type PlanFeatures } from "../schema/vendor.js";

export type Plan = typeof plans.$inferSelect;

export interface CreatePlanInput {
  readonly code: string;
  readonly name: string;
  readonly priceKopecks: bigint;
  readonly period?: Plan["period"];
  readonly seatsLimit: number;
  readonly projectsLimit: number;
  readonly features?: PlanFeatures;
  readonly isActive?: boolean;
}

export interface UpdatePlanInput {
  readonly name?: string;
  readonly priceKopecks?: bigint;
  readonly period?: Plan["period"];
  readonly seatsLimit?: number;
  readonly projectsLimit?: number;
  readonly features?: PlanFeatures;
  readonly isActive?: boolean;
}

export interface ListPlansOptions {
  readonly activeOnly?: boolean;
  readonly query?: string;
  readonly limit?: number;
}

export async function listPlans(
  db: Database,
  options: ListPlansOptions = {},
): Promise<readonly Plan[]> {
  const conditions = [];
  if (options.activeOnly === true) {
    conditions.push(eq(plans.isActive, true));
  }
  if (options.query !== undefined && options.query.trim() !== "") {
    conditions.push(ilike(plans.name, `%${options.query.trim()}%`));
  }

  return db
    .select()
    .from(plans)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(plans.priceKopecks), asc(plans.code))
    .limit(options.limit ?? 100);
}

export async function getPlanById(db: Database, planId: string): Promise<Plan | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  return plan ?? null;
}

export async function getPlanByCode(db: Database, code: string): Promise<Plan | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.code, code)).limit(1);
  return plan ?? null;
}

export async function createPlan(db: Database, input: CreatePlanInput): Promise<Plan> {
  const [plan] = await db
    .insert(plans)
    .values({
      code: input.code,
      name: input.name,
      priceKopecks: input.priceKopecks,
      period: input.period ?? "month",
      seatsLimit: input.seatsLimit,
      projectsLimit: input.projectsLimit,
      features: input.features ?? {},
      isActive: input.isActive ?? true,
    })
    .returning();

  if (!plan) {
    throw new Error("Failed to create plan");
  }
  return plan;
}

export async function updatePlan(
  db: Database,
  planId: string,
  input: UpdatePlanInput,
): Promise<Plan | null> {
  const patch: {
    name?: string;
    priceKopecks?: bigint;
    period?: Plan["period"];
    seatsLimit?: number;
    projectsLimit?: number;
    features?: PlanFeatures;
    isActive?: boolean;
    updatedAt?: Date;
  } = {};

  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.priceKopecks !== undefined) {
    patch.priceKopecks = input.priceKopecks;
  }
  if (input.period !== undefined) {
    patch.period = input.period;
  }
  if (input.seatsLimit !== undefined) {
    patch.seatsLimit = input.seatsLimit;
  }
  if (input.projectsLimit !== undefined) {
    patch.projectsLimit = input.projectsLimit;
  }
  if (input.features !== undefined) {
    patch.features = input.features;
  }
  if (input.isActive !== undefined) {
    patch.isActive = input.isActive;
  }
  if (Object.keys(patch).length === 0) {
    return getPlanById(db, planId);
  }
  patch.updatedAt = new Date();

  const [plan] = await db.update(plans).set(patch).where(eq(plans.id, planId)).returning();
  return plan ?? null;
}
