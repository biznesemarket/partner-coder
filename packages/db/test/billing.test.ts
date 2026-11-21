import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../src/index.js";
import {
  createContract,
  createDiscount,
  createInvoice,
  createPayment,
  createSubscription,
  findOverlappingDiscount,
  getActiveDiscount,
  getContractById,
  getInvoiceById,
  getSubscriptionById,
  listInvoices,
  listPayments,
  listSubscriptions,
  renewSubscription,
  updateInvoice,
  updateSubscriptionStatus,
} from "../src/vendor/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";
import { seedVendorBase } from "./fixtures.js";

let testDb: TestDatabase;
let db: Database;
let customerId: string;
let planId: string;
let vendorUserId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDatabase(testDb.pool);
  const base = await seedVendorBase(testDb.pool);
  vendorUserId = base.vendorUserId;
  planId = base.planId;
  const customer = await testDb.pool.query<{ id: string }>(
    `insert into customers (legal_name, status)
     values ('ООО Биллинг', 'trial')
     returning id`,
  );
  customerId = customer.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await testDb?.drop();
}, 60_000);

describe("договоры и подписки", () => {
  it("создаёт договор и подписку и запрещает повторный номер", async () => {
    const number = `C-${randomUUID().slice(0, 8)}`;
    const contract = await createContract(db, {
      customerId,
      planId,
      number,
      startsOn: "2026-11-01",
      endsOn: null,
      limits: { seats: 3, projects: 1 },
      status: "active",
    });

    expect(contract).toMatchObject({
      customerId,
      planId,
      number,
      status: "active",
    });
    expect(await getContractById(db, contract.id)).toMatchObject({ number });

    await expect(
      createContract(db, {
        customerId,
        planId,
        number,
        startsOn: "2026-12-01",
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const subscription = await createSubscription(db, {
      customerId,
      contractId: contract.id,
      status: "trial",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
      seats: 3,
      projectsLimit: 1,
    });

    expect(subscription).toMatchObject({
      customerId,
      contractId: contract.id,
      status: "trial",
      seats: 3,
    });
    expect(await getSubscriptionById(db, subscription.id)).toMatchObject({ id: subscription.id });
    expect(await listSubscriptions(db, { customerId })).toContainEqual(
      expect.objectContaining({ id: subscription.id }),
    );
  });

  it("продлевает подписку и меняет ручной статус", async () => {
    const contract = await createContract(db, {
      customerId,
      planId,
      number: `C-${randomUUID().slice(0, 8)}`,
      startsOn: "2026-11-01",
    });
    const subscription = await createSubscription(db, {
      customerId,
      contractId: contract.id,
      status: "trial",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
      seats: 3,
      projectsLimit: 1,
    });

    const renewed = await renewSubscription(db, subscription.id, {
      periodStart: "2026-11-15",
      periodEnd: "2026-12-15",
      changedAt: new Date("2026-11-15T10:00:00.000Z"),
    });
    expect(renewed).toMatchObject({
      status: "active",
      periodStart: "2026-11-15",
      periodEnd: "2026-12-15",
      graceUntil: null,
    });

    const grace = await updateSubscriptionStatus(db, subscription.id, {
      status: "grace",
      graceUntil: new Date("2026-12-22T00:00:00.000Z"),
      changedAt: new Date("2026-12-15T00:00:00.000Z"),
    });
    expect(grace).toMatchObject({ status: "grace" });
  });
});

describe("счета, платежи и скидки", () => {
  it("создаёт счёт, исключает дубль номера и обновляет статус", async () => {
    const contract = await createContract(db, {
      customerId,
      planId,
      number: `C-${randomUUID().slice(0, 8)}`,
      startsOn: "2026-11-01",
    });
    const number = `INV-${randomUUID().slice(0, 8)}`;
    const invoice = await createInvoice(db, {
      customerId,
      contractId: contract.id,
      number,
      issuedOn: "2026-11-01",
      dueOn: "2026-11-10",
      amountKopecks: 1_000_000n,
      status: "draft",
      pdfUrl: null,
    });

    expect(invoice).toMatchObject({ number, amountKopecks: 1_000_000n, status: "draft" });
    expect(await getInvoiceById(db, invoice.id)).toMatchObject({ number });

    await expect(
      createInvoice(db, {
        customerId,
        contractId: contract.id,
        number,
        issuedOn: "2026-12-01",
        dueOn: "2026-12-10",
        amountKopecks: 1_000_000n,
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const issued = await updateInvoice(db, invoice.id, {
      status: "issued",
      pdfUrl: "https://example.test/invoices/1.pdf",
    });
    expect(issued).toMatchObject({
      status: "issued",
      pdfUrl: "https://example.test/invoices/1.pdf",
    });
    expect(await listInvoices(db, { customerId, status: "issued" })).toContainEqual(
      expect.objectContaining({ id: invoice.id }),
    );
  });

  it("записывает платёж и отдаёт его в списке по клиенту", async () => {
    const contract = await createContract(db, {
      customerId,
      planId,
      number: `C-${randomUUID().slice(0, 8)}`,
      startsOn: "2026-11-01",
    });
    const invoice = await createInvoice(db, {
      customerId,
      contractId: contract.id,
      number: `INV-${randomUUID().slice(0, 8)}`,
      issuedOn: "2026-11-01",
      dueOn: "2026-11-10",
      amountKopecks: 1_000_000n,
      status: "issued",
    });

    const payment = await createPayment(db, {
      invoiceId: invoice.id,
      paidOn: "2026-11-05",
      amountKopecks: 400_000n,
      method: "bank_transfer",
      reference: "п/п 1",
      recordedBy: vendorUserId,
    });

    expect(payment).toMatchObject({ invoiceId: invoice.id, amountKopecks: 400_000n });
    const payments = await listPayments(db, { customerId });
    expect(payments).toContainEqual(
      expect.objectContaining({
        id: payment.id,
        invoiceNumber: invoice.number,
        customerLegalName: "ООО Биллинг",
      }),
    );
  });

  it("назначает скидку и не даёт пересечь периоды", async () => {
    const contract = await createContract(db, {
      customerId,
      planId,
      number: `C-${randomUUID().slice(0, 8)}`,
      startsOn: "2026-11-01",
    });
    const subscription = await createSubscription(db, {
      customerId,
      contractId: contract.id,
      status: "active",
      periodStart: "2026-11-01",
      periodEnd: "2026-12-01",
      seats: 3,
      projectsLimit: 1,
    });

    const discount = await createDiscount(db, {
      subscriptionId: subscription.id,
      percentBp: 1500,
      startsOn: "2026-11-01",
      endsOn: "2026-12-01",
      note: "Пилот",
      createdBy: vendorUserId,
    });
    expect(discount).toMatchObject({ percentBp: 1500 });

    expect(
      await findOverlappingDiscount(db, subscription.id, "2026-11-15", "2026-12-15"),
    ).toMatchObject({ id: discount.id });
    expect(
      await findOverlappingDiscount(db, subscription.id, "2026-12-02", "2026-12-15"),
    ).toBeNull();
    expect(await getActiveDiscount(db, subscription.id, "2026-11-15")).toMatchObject({
      id: discount.id,
    });
  });
});
