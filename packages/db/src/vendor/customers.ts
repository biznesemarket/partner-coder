import { and, desc, eq, ilike } from "drizzle-orm";

import type { Database } from "../client.js";
import { customers, type VendorContact } from "../schema/vendor.js";

export type Customer = typeof customers.$inferSelect;

export interface CreateCustomerInput {
  readonly legalName: string;
  readonly inn?: string | null;
  readonly kpp?: string | null;
  readonly contact?: VendorContact;
  readonly status?: Customer["status"];
  readonly notes?: string | null;
}

export interface UpdateCustomerInput {
  readonly legalName?: string;
  readonly inn?: string | null;
  readonly kpp?: string | null;
  readonly contact?: VendorContact;
  readonly status?: Customer["status"];
  readonly notes?: string | null;
}

export interface ListCustomersOptions {
  readonly status?: Customer["status"];
  readonly query?: string;
  readonly limit?: number;
}

export async function listCustomers(
  db: Database,
  options: ListCustomersOptions = {},
): Promise<readonly Customer[]> {
  const conditions = [];
  if (options.status !== undefined) {
    conditions.push(eq(customers.status, options.status));
  }
  if (options.query !== undefined && options.query.trim() !== "") {
    conditions.push(ilike(customers.legalName, `%${options.query.trim()}%`));
  }

  return db
    .select()
    .from(customers)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(customers.createdAt))
    .limit(options.limit ?? 100);
}

export async function getCustomerById(db: Database, customerId: string): Promise<Customer | null> {
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  return customer ?? null;
}

export async function getCustomerByInn(db: Database, inn: string): Promise<Customer | null> {
  const [customer] = await db.select().from(customers).where(eq(customers.inn, inn)).limit(1);
  return customer ?? null;
}

export async function createCustomer(db: Database, input: CreateCustomerInput): Promise<Customer> {
  const [customer] = await db
    .insert(customers)
    .values({
      legalName: input.legalName,
      inn: input.inn ?? null,
      kpp: input.kpp ?? null,
      contact: input.contact ?? {},
      status: input.status ?? "lead",
      notes: input.notes ?? null,
    })
    .returning();

  if (!customer) {
    throw new Error("Failed to create customer");
  }
  return customer;
}

export async function updateCustomer(
  db: Database,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<Customer | null> {
  const patch: {
    legalName?: string;
    inn?: string | null;
    kpp?: string | null;
    contact?: VendorContact;
    status?: Customer["status"];
    notes?: string | null;
    updatedAt?: Date;
  } = {};

  if (input.legalName !== undefined) {
    patch.legalName = input.legalName;
  }
  if (input.inn !== undefined) {
    patch.inn = input.inn;
  }
  if (input.kpp !== undefined) {
    patch.kpp = input.kpp;
  }
  if (input.contact !== undefined) {
    patch.contact = input.contact;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes;
  }
  if (Object.keys(patch).length === 0) {
    return getCustomerById(db, customerId);
  }
  patch.updatedAt = new Date();

  const [customer] = await db
    .update(customers)
    .set(patch)
    .where(eq(customers.id, customerId))
    .returning();
  return customer ?? null;
}
