import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { contracts, type ContractLimits } from "../schema/vendor.js";

export type Contract = typeof contracts.$inferSelect;

export interface CreateContractInput {
  readonly customerId: string;
  readonly planId: string;
  readonly number: string;
  readonly startsOn: string;
  readonly endsOn?: string | null;
  readonly limits?: ContractLimits;
  readonly status?: Contract["status"];
}

export interface ListContractsOptions {
  readonly customerId?: string;
  readonly status?: Contract["status"];
  readonly limit?: number;
}

export async function listContracts(
  db: Database,
  options: ListContractsOptions = {},
): Promise<readonly Contract[]> {
  const conditions = [];
  if (options.customerId !== undefined) {
    conditions.push(eq(contracts.customerId, options.customerId));
  }
  if (options.status !== undefined) {
    conditions.push(eq(contracts.status, options.status));
  }

  return db
    .select()
    .from(contracts)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(contracts.startsOn), desc(contracts.createdAt))
    .limit(options.limit ?? 100);
}

export async function getContractById(db: Database, contractId: string): Promise<Contract | null> {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
  return contract ?? null;
}

export async function createContract(db: Database, input: CreateContractInput): Promise<Contract> {
  const [contract] = await db
    .insert(contracts)
    .values({
      customerId: input.customerId,
      planId: input.planId,
      number: input.number,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      limits: input.limits ?? {},
      status: input.status ?? "draft",
    })
    .returning();

  if (!contract) {
    throw new Error("Failed to create contract");
  }
  return contract;
}
