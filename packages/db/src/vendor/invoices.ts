import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { invoices } from "../schema/vendor.js";

export type Invoice = typeof invoices.$inferSelect;

export interface CreateInvoiceInput {
  readonly customerId: string;
  readonly contractId: string;
  readonly number: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly amountKopecks: bigint;
  readonly status?: Invoice["status"];
  readonly pdfUrl?: string | null;
}

export interface UpdateInvoiceInput {
  readonly status?: Invoice["status"];
  readonly pdfUrl?: string | null;
}

export interface ListInvoicesOptions {
  readonly customerId?: string;
  readonly status?: Invoice["status"];
  readonly limit?: number;
}

export async function listInvoices(
  db: Database,
  options: ListInvoicesOptions = {},
): Promise<readonly Invoice[]> {
  const conditions = [];
  if (options.customerId !== undefined) {
    conditions.push(eq(invoices.customerId, options.customerId));
  }
  if (options.status !== undefined) {
    conditions.push(eq(invoices.status, options.status));
  }

  return db
    .select()
    .from(invoices)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(invoices.issuedOn), desc(invoices.createdAt))
    .limit(options.limit ?? 100);
}

export async function getInvoiceById(db: Database, invoiceId: string): Promise<Invoice | null> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  return invoice ?? null;
}

export async function getInvoiceByNumber(db: Database, number: string): Promise<Invoice | null> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.number, number)).limit(1);
  return invoice ?? null;
}

export async function createInvoice(db: Database, input: CreateInvoiceInput): Promise<Invoice> {
  const [invoice] = await db
    .insert(invoices)
    .values({
      customerId: input.customerId,
      contractId: input.contractId,
      number: input.number,
      issuedOn: input.issuedOn,
      dueOn: input.dueOn,
      amountKopecks: input.amountKopecks,
      status: input.status ?? "draft",
      pdfUrl: input.pdfUrl ?? null,
    })
    .returning();

  if (!invoice) {
    throw new Error("Failed to create invoice");
  }
  return invoice;
}

export async function updateInvoice(
  db: Database,
  invoiceId: string,
  input: UpdateInvoiceInput,
): Promise<Invoice | null> {
  const patch: {
    status?: Invoice["status"];
    pdfUrl?: string | null;
    updatedAt?: Date;
  } = {};
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (input.pdfUrl !== undefined) {
    patch.pdfUrl = input.pdfUrl;
  }
  if (Object.keys(patch).length === 0) {
    return getInvoiceById(db, invoiceId);
  }
  patch.updatedAt = new Date();

  const [invoice] = await db
    .update(invoices)
    .set(patch)
    .where(eq(invoices.id, invoiceId))
    .returning();
  return invoice ?? null;
}
