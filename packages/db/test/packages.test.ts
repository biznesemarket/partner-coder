import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../src/index.js";
import {
  getProvisioningPackageById,
  getVendorDashboard,
  issueProvisioningPackage,
  listProvisioningPackages,
  revokeProvisioningPackage,
  upsertOnboardingSession,
} from "../src/vendor/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";
import { seedVendorBase } from "./fixtures.js";

let database: TestDatabase;
let db: Database;
let customerId: string;
let vendorUserId: string;
let planId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDatabase(database.pool);
  const base = await seedVendorBase(database.pool);
  vendorUserId = base.vendorUserId;
  planId = base.planId;
  const customer = await database.pool.query<{ id: string }>(
    `insert into customers (legal_name, status)
     values ('ООО Пакеты', 'active')
     returning id`,
  );
  customerId = customer.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

describe("пакеты подключения", () => {
  it("выдаёт пакет с одноразовым токеном и создаёт onboarding", async () => {
    const issued = await issueProvisioningPackage(db, {
      customerId,
      version: "0.1.0",
      ttlDays: 7,
      createdBy: vendorUserId,
      now: new Date("2026-11-21T10:00:00.000Z"),
    });

    expect(issued.token.startsWith("pcp_")).toBe(true);
    expect(issued.package).toMatchObject({
      customerId,
      version: "0.1.0",
      status: "issued",
      tokenPrefix: issued.token.slice(0, 12),
      createdBy: vendorUserId,
    });
    expect(issued.package).not.toHaveProperty("token");
    expect(issued.package.tokenHash).toBe(createHash("sha256").update(issued.token).digest("hex"));
    expect(issued.package.expiresAt.toISOString()).toBe("2026-11-28T10:00:00.000Z");

    const stored = await getProvisioningPackageById(db, issued.package.id);
    expect(stored).toMatchObject({ id: issued.package.id, tokenHash: issued.package.tokenHash });

    await upsertOnboardingSession(db, {
      customerId,
      packageId: issued.package.id,
      now: new Date("2026-11-21T10:00:00.000Z"),
    });
    const onboarding = await database.pool.query<{ state: string; package_id: string }>(
      "select state, package_id from onboarding_sessions where customer_id = $1",
      [customerId],
    );
    expect(onboarding.rows).toEqual([{ state: "issued", package_id: issued.package.id }]);
  });

  it("перевыпускает пакет: старый revoked, onboarding сбрасывается", async () => {
    const [current] = await listProvisioningPackages(db, { customerId });
    expect(current).toBeDefined();

    const revoked = await revokeProvisioningPackage(db, current!.id, new Date());
    expect(revoked).toMatchObject({ status: "revoked" });

    const reissued = await issueProvisioningPackage(db, {
      customerId,
      version: "0.1.1",
      ttlDays: 7,
      createdBy: vendorUserId,
    });
    const onboarding = await upsertOnboardingSession(db, {
      customerId,
      packageId: reissued.package.id,
      now: new Date(),
    });

    expect(reissued.package.id).not.toBe(current!.id);
    expect(onboarding).toMatchObject({
      customerId,
      packageId: reissued.package.id,
      state: "issued",
      progressBp: 0,
    });
    const all = await listProvisioningPackages(db, { customerId });
    expect(all).toHaveLength(2);
    expect(all).toContainEqual(
      expect.objectContaining({
        id: reissued.package.id,
        customerLegalName: "ООО Пакеты",
        status: "issued",
      }),
    );
  });

  it("собирает счетчики дашборда по статусам", async () => {
    await database.pool.query(
      `insert into customers (legal_name, status) values
         ('ООО Лид', 'lead'),
         ('ООО Пробный', 'trial')`,
    );
    const contract = await database.pool.query<{ id: string }>(
      `insert into contracts (customer_id, plan_id, number, starts_on, status)
       values ($1, $2, $3, '2026-11-01', 'active')
       returning id`,
      [customerId, planId, `C-${randomUUID().slice(0, 8)}`],
    );
    await database.pool.query(
      `insert into subscriptions (customer_id, contract_id, status, period_start, period_end, seats, projects_limit)
       values ($1, $2, 'active', '2026-11-01', '2026-12-01', 3, 1)`,
      [customerId, contract.rows[0]!.id],
    );
    await database.pool.query(
      `insert into invoices (customer_id, contract_id, number, issued_on, due_on, amount_kopecks, status)
       values ($1, $2, $3, '2026-11-01', '2026-11-10', 100000, 'issued')`,
      [customerId, contract.rows[0]!.id, `INV-${randomUUID().slice(0, 8)}`],
    );

    const dashboard = await getVendorDashboard(db);
    expect(dashboard.customers.byStatus).toMatchObject({
      lead: 1,
      trial: 1,
      active: 1,
    });
    expect(dashboard.subscriptions.byStatus.active).toBe(1);
    expect(dashboard.invoices.byStatus.issued).toBe(1);
    expect(dashboard.packages.byStatus.issued).toBe(1);
    expect(dashboard.packages.byStatus.revoked).toBe(1);
    expect(dashboard.onboarding.byState.issued).toBe(1);
  });
});
