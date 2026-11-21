import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database, type VendorRole } from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { buildServer } from "../server.js";
import type { VendorAuth } from "./config.js";
import type { VendorAuthRuntime, VendorIdentity } from "./runtime.js";

const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";
const STEPPED_UP = new Date(Date.now() + 5 * 60_000);

let database: TestDatabase;
let db: Database;
let currentSession: unknown = null;
const openApps: FastifyInstance[] = [];

interface SeededUser {
  readonly id: string;
  readonly email: string;
}

async function seedUser(role: VendorRole): Promise<SeededUser> {
  const id = randomUUID();
  const email = `${role}-${id}@example.com`;
  await database.pool.query(
    `insert into vendor_users (id, email, name, role, status, mfa_enabled)
     values ($1, $2, $3, $4, 'active', true)`,
    [id, email, role, role],
  );
  return { id, email };
}

function identity(
  user: SeededUser,
  role: VendorRole,
  overrides: Partial<VendorIdentity> = {},
): VendorIdentity {
  return {
    userId: user.id,
    email: user.email,
    name: user.email,
    role,
    status: "active",
    twoFactorEnabled: true,
    sessionId: randomUUID(),
    sessionExpiresAt: new Date("2026-11-21T20:00:00.000Z"),
    stepUpUntil: null,
    ...overrides,
  };
}

function setSession(value: VendorIdentity): void {
  currentSession = {
    user: {
      id: value.userId,
      email: value.email,
      name: value.name,
      role: value.role,
      status: value.status,
      twoFactorEnabled: value.twoFactorEnabled,
    },
    session: {
      id: value.sessionId,
      expiresAt: value.sessionExpiresAt,
      stepUpUntil: value.stepUpUntil,
    },
  };
}

async function app(): Promise<FastifyInstance> {
  const auth = {
    api: { getSession: async () => currentSession },
  } as unknown as VendorAuth;
  const runtime: VendorAuthRuntime = {
    auth,
    db,
    authDb: db,
    vendorBaseUrl,
    stepUpMinutes: 5,
  };
  const server = buildServer({
    apiBaseUrl,
    appEnv: "local",
    vendorRuntime: runtime,
  });
  await server.ready();
  openApps.push(server);
  return server;
}

async function audit(action: string): Promise<Record<string, unknown> | undefined> {
  const result = await database.pool.query<{
    actor_id: string | null;
    after: Record<string, unknown> | null;
  }>(
    `select actor_id, after
       from vendor_audit_events
      where action = $1
      order by created_at desc
      limit 1`,
    [action],
  );
  return result.rows[0];
}

let admin: SeededUser;
let finance: SeededUser;
let support: SeededUser;
let readonly: SeededUser;
let customerId: string;
let planId: string;
let contractId: string;
let subscriptionId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDatabase(database.pool);
  admin = await seedUser("superadmin");
  finance = await seedUser("finance");
  support = await seedUser("support");
  readonly = await seedUser("readonly");
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((server) => server.close()));
  currentSession = null;
});

describe("биллинг вендорской консоли", () => {
  it("создаёт клиента, тариф, договор и подписку", async () => {
    const server = await app();
    setSession(identity(admin, "superadmin"));

    const customer = await server.inject({
      method: "POST",
      url: "/v1/vendor/customers",
      payload: { legalName: `ООО Биллинг ${randomUUID().slice(0, 8)}` },
    });
    expect(customer.statusCode).toBe(201);
    customerId = customer.json().customer.id;

    const plan = await server.inject({
      method: "POST",
      url: "/v1/vendor/plans",
      payload: {
        code: `billing-${randomUUID().slice(0, 8)}`,
        name: "Базовый",
        priceKopecks: "1500000",
        seatsLimit: 5,
        projectsLimit: 3,
      },
    });
    expect(plan.statusCode).toBe(201);
    planId = plan.json().plan.id;

    const contract = await server.inject({
      method: "POST",
      url: "/v1/vendor/contracts",
      payload: {
        customerId,
        planId,
        number: `C-${randomUUID().slice(0, 8)}`,
        startsOn: "2026-11-01",
        status: "active",
      },
    });
    expect(contract.statusCode).toBe(201);
    expect(contract.json().contract).toMatchObject({ customerId, planId, status: "active" });
    contractId = contract.json().contract.id;
    expect(await audit("vendor.contract.created")).toMatchObject({
      actor_id: admin.id,
      after: { contractId },
    });

    const subscription = await server.inject({
      method: "POST",
      url: "/v1/vendor/subscriptions",
      payload: {
        customerId,
        contractId,
        periodStart: "2026-11-01",
        periodEnd: "2026-12-01",
        status: "active",
      },
    });
    expect(subscription.statusCode).toBe(201);
    expect(subscription.json().subscription).toMatchObject({
      customerId,
      contractId,
      status: "active",
      seats: 5,
      projectsLimit: 3,
    });
    subscriptionId = subscription.json().subscription.id;
    expect(await audit("vendor.subscription.created")).toMatchObject({
      actor_id: admin.id,
      after: { subscriptionId },
    });
  });

  it("требует step-up для счёта, платежа и продления", async () => {
    const server = await app();
    setSession(identity(finance, "finance"));

    const withoutStepUp = await server.inject({
      method: "POST",
      url: "/v1/vendor/invoices",
      payload: {
        customerId,
        contractId,
        number: `INV-${randomUUID().slice(0, 8)}`,
        issuedOn: "2026-11-01",
        dueOn: "2026-11-10",
        amountKopecks: "1500000",
        status: "issued",
      },
    });
    expect(withoutStepUp.statusCode).toBe(403);
    expect(withoutStepUp.json()).toMatchObject({ error: { code: "vendor_step_up_required" } });

    setSession(identity(finance, "finance", { stepUpUntil: STEPPED_UP }));
    const invoice = await server.inject({
      method: "POST",
      url: "/v1/vendor/invoices",
      payload: {
        customerId,
        contractId,
        number: `INV-${randomUUID().slice(0, 8)}`,
        issuedOn: "2026-11-01",
        dueOn: "2026-11-10",
        amountKopecks: "1500000",
        status: "issued",
      },
    });
    const unsafePdf = await server.inject({
      method: "POST",
      url: "/v1/vendor/invoices",
      payload: {
        customerId,
        contractId,
        number: `INV-${randomUUID().slice(0, 8)}`,
        issuedOn: "2026-11-01",
        dueOn: "2026-11-10",
        amountKopecks: "100000",
        status: "issued",
        pdfUrl: "javascript:alert(1)",
      },
    });
    expect(unsafePdf.statusCode).toBe(400);
    expect(invoice.statusCode, JSON.stringify(invoice.json())).toBe(201);
    const invoiceId = invoice.json().invoice.id;
    expect(await audit("vendor.invoice.created")).toMatchObject({
      actor_id: finance.id,
      after: { invoiceId, amountKopecks: "1500000" },
    });

    const payment = await server.inject({
      method: "POST",
      url: "/v1/vendor/payments",
      payload: {
        invoiceId,
        paidOn: "2026-11-05",
        amountKopecks: "400000",
        method: "bank_transfer",
        reference: "п/п 1",
      },
    });
    expect(payment.statusCode, JSON.stringify(payment.json())).toBe(201);
    expect(payment.json().payment).toMatchObject({
      invoiceId,
      invoiceNumber: invoice.json().invoice.number,
      amountKopecks: "400000",
    });
    expect(await audit("vendor.payment.recorded")).toMatchObject({
      actor_id: finance.id,
      after: { invoiceId, amountKopecks: "400000" },
    });

    const unchanged = await server.inject({
      method: "GET",
      url: `/v1/vendor/invoices?customerId=${customerId}`,
    });
    expect(unchanged.json().items).toContainEqual(
      expect.objectContaining({ id: invoiceId, status: "issued" }),
    );

    const renewed = await server.inject({
      method: "POST",
      url: `/v1/vendor/subscriptions/${subscriptionId}/renew`,
      payload: { periodStart: "2026-12-01", periodEnd: "2027-01-01" },
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().subscription).toMatchObject({
      status: "active",
      periodStart: "2026-12-01",
      periodEnd: "2027-01-01",
    });
    expect(await audit("vendor.subscription.renewed")).toMatchObject({
      actor_id: finance.id,
      after: { subscriptionId, periodEnd: "2027-01-01" },
    });
  });

  it("не даёт support, readonly и superadmin менять деньги", async () => {
    const server = await app();
    const payload = {
      customerId,
      contractId,
      number: `INV-${randomUUID().slice(0, 8)}`,
      issuedOn: "2026-11-01",
      dueOn: "2026-11-10",
      amountKopecks: "100000",
    };

    for (const [user, role] of [
      [support, "support"],
      [readonly, "readonly"],
      [admin, "superadmin"],
    ] as const) {
      setSession(identity(user, role, { stepUpUntil: STEPPED_UP }));
      const response = await server.inject({
        method: "POST",
        url: "/v1/vendor/invoices",
        payload,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "vendor_role_denied" } });
    }

    setSession(identity(readonly, "readonly"));
    const read = await server.inject({
      method: "GET",
      url: `/v1/vendor/invoices?customerId=${customerId}`,
    });
    expect(read.statusCode).toBe(200);
  });

  it("меняет статус финансово и защищает скидку и приостановку", async () => {
    const server = await app();
    setSession(identity(finance, "finance", { stepUpUntil: STEPPED_UP }));
    const grace = await server.inject({
      method: "POST",
      url: `/v1/vendor/subscriptions/${subscriptionId}/status`,
      payload: {
        status: "grace",
        graceUntil: "2027-01-08T00:00:00.000Z",
        reason: "ожидаем оплату",
      },
    });
    expect(grace.statusCode, JSON.stringify(grace.json())).toBe(200);
    expect(grace.json().subscription).toMatchObject({
      status: "grace",
      graceUntil: "2027-01-08T00:00:00.000Z",
    });
    expect(await audit("vendor.subscription.status_changed")).toMatchObject({
      actor_id: finance.id,
      after: { status: "grace", reason: "ожидаем оплату" },
    });

    setSession(identity(finance, "finance"));
    const discountDenied = await server.inject({
      method: "POST",
      url: `/v1/vendor/subscriptions/${subscriptionId}/discounts`,
      payload: { percentBp: 1500, startsOn: "2027-01-01" },
    });
    expect(discountDenied.statusCode).toBe(403);
    expect(discountDenied.json()).toMatchObject({ error: { code: "vendor_role_denied" } });

    setSession(identity(admin, "superadmin"));
    const discountStepUp = await server.inject({
      method: "POST",
      url: `/v1/vendor/subscriptions/${subscriptionId}/discounts`,
      payload: { percentBp: 1500, startsOn: "2027-01-01" },
    });
    expect(discountStepUp.statusCode).toBe(403);
    expect(discountStepUp.json()).toMatchObject({ error: { code: "vendor_step_up_required" } });

    setSession(identity(admin, "superadmin", { stepUpUntil: STEPPED_UP }));
    const discount = await server.inject({
      method: "POST",
      url: `/v1/vendor/subscriptions/${subscriptionId}/discounts`,
      payload: { percentBp: 1500, startsOn: "2027-01-01", endsOn: "2027-02-01" },
    });
    expect(discount.statusCode).toBe(201);
    expect(await audit("vendor.discount.assigned")).toMatchObject({
      actor_id: admin.id,
      after: { percentBp: 1500 },
    });

    const overlap = await server.inject({
      method: "POST",
      url: `/v1/vendor/subscriptions/${subscriptionId}/discounts`,
      payload: { percentBp: 2000, startsOn: "2027-01-15" },
    });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json()).toMatchObject({ error: { code: "vendor_discount_overlap" } });

    setSession(identity(finance, "finance"));
    const suspendDenied = await server.inject({
      method: "POST",
      url: `/v1/vendor/customers/${customerId}/suspend`,
      payload: { reason: "тест" },
    });
    expect(suspendDenied.statusCode).toBe(403);
    expect(suspendDenied.json()).toMatchObject({ error: { code: "vendor_role_denied" } });

    setSession(identity(admin, "superadmin", { stepUpUntil: STEPPED_UP }));
    const suspended = await server.inject({
      method: "POST",
      url: `/v1/vendor/customers/${customerId}/suspend`,
      payload: { reason: "тест" },
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().customer).toMatchObject({ status: "suspended" });
    expect(await audit("vendor.customer.suspended")).toMatchObject({
      actor_id: admin.id,
      after: { status: "suspended", reason: "тест" },
    });

    const subscriptions = await server.inject({
      method: "GET",
      url: `/v1/vendor/subscriptions?customerId=${customerId}`,
    });
    expect(subscriptions.json().items).toContainEqual(
      expect.objectContaining({ id: subscriptionId, status: "suspended" }),
    );

    const resumed = await server.inject({
      method: "POST",
      url: `/v1/vendor/customers/${customerId}/resume`,
      payload: { periodStart: "2027-02-01", periodEnd: "2027-03-01" },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().customer).toMatchObject({ status: "active" });
    expect(await audit("vendor.customer.resumed")).toMatchObject({
      actor_id: admin.id,
      after: { status: "active", periodStart: "2027-02-01", periodEnd: "2027-03-01" },
    });
    const afterResume = await server.inject({
      method: "GET",
      url: `/v1/vendor/subscriptions?customerId=${customerId}`,
    });
    expect(afterResume.json().items).toContainEqual(
      expect.objectContaining({
        id: subscriptionId,
        status: "active",
        periodStart: "2027-02-01",
      }),
    );
  });
});
