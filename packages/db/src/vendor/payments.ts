import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { customers, invoices, payments } from "../schema/vendor.js";

export type Payment = typeof payments.$inferSelect;

export type PaymentWithInvoice = Payment & {
  readonly invoiceNumber: string;
  readonly customerId: string;
  readonly customerLegalName: string;
};

export interface CreatePaymentInput {
  readonly invoiceId: string;
  readonly paidOn: string;
  readonly amountKopecks: bigint;
  readonly method?: Payment["method"];
  readonly reference?: string | null;
  readonly recordedBy: string;
}

export interface ListPaymentsOptions {
  readonly invoiceId?: string;
  readonly customerId?: string;
  readonly limit?: number;
}

export async function listPayments(
  db: Database,
  options: ListPaymentsOptions = {},
): Promise<readonly PaymentWithInvoice[]> {
  const conditions = [];
  if (options.invoiceId !== undefined) {
    conditions.push(eq(payments.invoiceId, options.invoiceId));
  }
  if (options.customerId !== undefined) {
    conditions.push(eq(invoices.customerId, options.customerId));
  }

  const rows = await db
    .select({
      payment: payments,
      invoiceNumber: invoices.number,
      customerId: invoices.customerId,
      customerLegalName: customers.legalName,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(payments.paidOn), desc(payments.createdAt))
    .limit(options.limit ?? 100);

  return rows.map((row) => ({
    ...row.payment,
    invoiceNumber: row.invoiceNumber,
    customerId: row.customerId,
    customerLegalName: row.customerLegalName,
  }));
}

export async function getPaymentById(db: Database, paymentId: string): Promise<Payment | null> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  return payment ?? null;
}

export async function createPayment(db: Database, input: CreatePaymentInput): Promise<Payment> {
  const [payment] = await db
    .insert(payments)
    .values({
      invoiceId: input.invoiceId,
      paidOn: input.paidOn,
      amountKopecks: input.amountKopecks,
      method: input.method ?? "bank_transfer",
      reference: input.reference ?? null,
      recordedBy: input.recordedBy,
    })
    .returning();

  if (!payment) {
    throw new Error("Failed to create payment");
  }
  return payment;
}
