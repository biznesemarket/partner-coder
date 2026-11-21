import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { seedVendorBase } from "../../../../packages/db/test/fixtures.js";
import {
  createContract,
  createSubscription,
  getCustomerById,
  getSubscriptionById,
} from "../../../../packages/db/src/vendor/index.js";
import { advanceBillingStatuses } from "./billing-status.js";

let testDb: TestDatabase;
let db: Database;
let planId: string;
let customerId: string;

async function newCustomer(name: string): Promise<string> {
  const result = await testDb.pool.query<{ id: string }>(
    `insert into customers (legal_name, status)
     values ($1, 'active')
     returning id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function newSubscription(
  customer: string,
  overrides: {
    readonly status: "trial" | "active" | "grace" | "expired";
    readonly periodEnd: string;
    readonly graceUntil?: Date | null;
    readonly statusChangedAt: Date;
  },
): Promise<string> {
  const contract = await createContract(db, {
    customerId: customer,
    planId,
    number: `C-${randomUUID().slice(0, 8)}`,
    startsOn: "2026-11-01",
    status: "active",
  });
  const subscription = await createSubscription(db, {
    customerId: customer,
    contractId: contract.id,
    status: overrides.status,
    periodStart: "2026-11-01",
    periodEnd: overrides.periodEnd,
    graceUntil: overrides.graceUntil ?? null,
    seats: 3,
    projectsLimit: 1,
  });
  await testDb.pool.query("update subscriptions set status_changed_at = $1 where id = $2", [
    overrides.statusChangedAt,
    subscription.id,
  ]);
  return subscription.id;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDatabase(testDb.pool);
  const base = await seedVendorBase(testDb.pool);
  planId = base.planId;
  customerId = await newCustomer("ООО Цикл");
}, 120_000);

afterAll(async () => {
  await testDb?.drop();
}, 60_000);

describe("автопереходы статусов подписки", () => {
  let activeId: string;
  let trialId: string;
  let graceId: string;
  let expiredId: string;

  beforeAll(async () => {
    activeId = await newSubscription(customerId, {
      status: "active",
      periodEnd: "2026-12-01",
      statusChangedAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    trialId = await newSubscription(customerId, {
      status: "trial",
      periodEnd: "2026-11-20",
      statusChangedAt: new Date("2026-11-06T00:00:00.000Z"),
    });
    graceId = await newSubscription(customerId, {
      status: "grace",
      periodEnd: "2026-12-01",
      graceUntil: new Date("2026-12-08T00:00:00.000Z"),
      statusChangedAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    expiredId = await newSubscription(customerId, {
      status: "expired",
      periodEnd: "2026-12-01",
      statusChangedAt: new Date("2026-12-08T00:00:00.000Z"),
    });
  });

  it("не трогает подписки до наступления границ", async () => {
    const result = await advanceBillingStatuses(db, {
      now: new Date("2026-11-19T23:59:59.999Z"),
    });

    expect(result.transitions).toBe(0);
    expect(await getSubscriptionById(db, activeId)).toMatchObject({ status: "active" });
  });

  it("trial переходит в expired в конце trial", async () => {
    const trialRun = await advanceBillingStatuses(db, {
      now: new Date("2026-11-20T00:00:00.000Z"),
    });
    expect(trialRun.transitions).toBe(1);
    expect(await getSubscriptionById(db, trialId)).toMatchObject({ status: "expired" });
    expect(await getCustomerById(db, customerId)).toMatchObject({ status: "expired" });
  });

  it("active переходит в grace в конце периода", async () => {
    const result = await advanceBillingStatuses(db, {
      now: new Date("2026-12-01T00:00:00.000Z"),
    });

    expect(result.transitions).toBe(1);
    expect(await getSubscriptionById(db, activeId)).toMatchObject({
      status: "grace",
      graceUntil: new Date("2026-12-08T00:00:00.000Z"),
    });
  });

  it("один запуск доводит active до expired через grace и пишет аудит", async () => {
    const result = await advanceBillingStatuses(db, {
      now: new Date("2026-12-08T00:00:00.000Z"),
    });

    expect(result.transitions).toBe(2);
    expect(await getSubscriptionById(db, activeId)).toMatchObject({ status: "expired" });
    expect(await getSubscriptionById(db, graceId)).toMatchObject({ status: "expired" });

    const audit = await testDb.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_audit_events where action = 'vendor.subscription.auto_transitioned'",
    );
    expect(Number(audit.rows[0]?.count)).toBe(4);
  });

  it("expired переходит в suspended после 30 дней и повторный запуск идемпотентен", async () => {
    const result = await advanceBillingStatuses(db, {
      now: new Date("2027-01-07T00:00:00.000Z"),
    });

    expect(result.transitions).toBe(4);
    for (const id of [activeId, trialId, graceId, expiredId]) {
      expect(await getSubscriptionById(db, id)).toMatchObject({ status: "suspended" });
    }
    expect(await getCustomerById(db, customerId)).toMatchObject({ status: "suspended" });

    const repeated = await advanceBillingStatuses(db, {
      now: new Date("2027-01-07T00:00:00.000Z"),
    });
    expect(repeated.transitions).toBe(0);
  });
});
