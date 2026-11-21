import { randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { hashAuthToken } from "../auth/hash.js";
import type { Database } from "../client.js";
import { customers, onboardingSessions, provisioningPackages } from "../schema/vendor.js";

const PACKAGE_PREFIX = "pcp_";

export type ProvisioningPackage = typeof provisioningPackages.$inferSelect;
export type ProvisioningPackageWithCustomer = ProvisioningPackage & {
  readonly customerLegalName: string;
};
export type OnboardingSession = typeof onboardingSessions.$inferSelect;

export interface IssueProvisioningPackageInput {
  readonly customerId: string;
  readonly version: string;
  readonly ttlDays: number;
  readonly createdBy?: string | null;
  readonly now?: Date;
}

export interface IssuedProvisioningPackage {
  readonly package: ProvisioningPackage;
  /** Одноразовый токен; в БД хранится только SHA-256. */
  readonly token: string;
}

export interface ListProvisioningPackagesOptions {
  readonly customerId?: string;
  readonly status?: ProvisioningPackage["status"];
  readonly limit?: number;
}

export interface UpsertOnboardingSessionInput {
  readonly customerId: string;
  readonly packageId: string;
  readonly now?: Date;
}

function createPackageToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${PACKAGE_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashAuthToken(token), tokenPrefix: token.slice(0, 12) };
}

export async function issueProvisioningPackage(
  db: Database,
  input: IssueProvisioningPackageInput,
): Promise<IssuedProvisioningPackage> {
  const { token, tokenHash, tokenPrefix } = createPackageToken();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlDays * 86_400_000);

  const [created] = await db
    .insert(provisioningPackages)
    .values({
      id: randomUUID(),
      customerId: input.customerId,
      tokenHash,
      tokenPrefix,
      version: input.version,
      status: "issued",
      expiresAt,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to issue provisioning package");
  }
  return { package: created, token };
}

export async function getProvisioningPackageById(
  db: Database,
  packageId: string,
): Promise<ProvisioningPackage | null> {
  const [item] = await db
    .select()
    .from(provisioningPackages)
    .where(eq(provisioningPackages.id, packageId))
    .limit(1);
  return item ?? null;
}

export async function listProvisioningPackages(
  db: Database,
  options: ListProvisioningPackagesOptions = {},
): Promise<readonly ProvisioningPackageWithCustomer[]> {
  const conditions = [];
  if (options.customerId !== undefined) {
    conditions.push(eq(provisioningPackages.customerId, options.customerId));
  }
  if (options.status !== undefined) {
    conditions.push(eq(provisioningPackages.status, options.status));
  }

  const rows = await db
    .select({
      package: provisioningPackages,
      customerLegalName: customers.legalName,
    })
    .from(provisioningPackages)
    .innerJoin(customers, eq(provisioningPackages.customerId, customers.id))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(provisioningPackages.createdAt))
    .limit(options.limit ?? 100);

  return rows.map((row) => ({
    ...row.package,
    customerLegalName: row.customerLegalName,
  }));
}

export async function revokeProvisioningPackage(
  db: Database,
  packageId: string,
  now: Date = new Date(),
): Promise<ProvisioningPackage | null> {
  const [updated] = await db
    .update(provisioningPackages)
    .set({ status: "revoked", updatedAt: now })
    .where(eq(provisioningPackages.id, packageId))
    .returning();
  return updated ?? null;
}

export async function upsertOnboardingSession(
  db: Database,
  input: UpsertOnboardingSessionInput,
): Promise<OnboardingSession> {
  const now = input.now ?? new Date();
  const [existing] = await db
    .select()
    .from(onboardingSessions)
    .where(eq(onboardingSessions.customerId, input.customerId))
    .orderBy(desc(onboardingSessions.createdAt))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(onboardingSessions)
      .set({
        packageId: input.packageId,
        state: "issued",
        answers: {},
        progressBp: 0,
        blockedReason: null,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(onboardingSessions.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error("Failed to update onboarding session");
    }
    return updated;
  }

  const [created] = await db
    .insert(onboardingSessions)
    .values({
      id: randomUUID(),
      customerId: input.customerId,
      packageId: input.packageId,
      state: "issued",
      answers: {},
      progressBp: 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) {
    throw new Error("Failed to create onboarding session");
  }
  return created;
}
