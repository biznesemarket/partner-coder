import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@partner-coder/db";
import { defaultPolicyDocument } from "@partner-coder/domain";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import {
  seedTenant,
  seedVendorBase,
  type TenantFixture,
} from "../../../../packages/db/test/fixtures.js";
import { firstClosableDate, scanDueDays } from "./day-close-scan.js";

const NOW = new Date("2026-11-15T12:00:00Z");

describe("поиск дней для закрытия", () => {
  let testDb: TestDatabase;
  let db: Database;
  let fixture: TenantFixture;
  let suspendedTenant: TenantFixture;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = createDatabase(testDb.pool);
    const vendor = await seedVendorBase(testDb.pool);
    fixture = await seedTenant(testDb.pool, vendor, "a");
    suspendedTenant = await seedTenant(testDb.pool, vendor, "b");

    const document = defaultPolicyDocument({
      meta: {
        tenant_id: fixture.tenantId,
        project_id: fixture.projectId,
        approved_by: fixture.userId,
        effective_from: "2026-10-01T00:00:00+03:00",
      },
      project: {
        name: "Проект сканера",
        repo: "demo/scanner",
        timezone: "Europe/Moscow",
        default_branch: "main",
      },
      economics: {
        valuation_rub: 1_000_000,
        rate_rub_per_hour: 500,
      },
    });
    await testDb.pool.query(
      "update policies set params = $1::jsonb, effective_from = '2026-10-01T00:00:00Z' where id = $2",
      [JSON.stringify(document), fixture.policyId],
    );
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("возвращает пропущенные даты от последнего закрытого дня до due", async () => {
    const result = await scanDueDays(db, { now: NOW, catchupDays: 3 });
    const item = result.find((candidate) => candidate.projectId === fixture.projectId);
    expect(item).toMatchObject({
      tenantId: fixture.tenantId,
      dueDate: "2026-11-14",
      closeAt: "00:00",
    });
    expect(item?.dates).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });

  it("не возвращает проект, если все дни до due уже закрыты", async () => {
    await testDb.pool.query(
      `insert into day_records
         (tenant_id, project_id, membership_id, date_local, timezone, paid_seconds, tracked_seconds,
          classes, amount_kopecks, cash_kopecks, equity_kopecks, share_bp, pool_used_bp, pool_pending,
          pending_equity_kopecks, versions, input_hash, explanation, closed_at)
       values ($1, $2, $3, '2026-11-14', 'Europe/Moscow', 0, 0,
               '{"activeSeconds":0,"supervisedSeconds":0,"autonomousSeconds":0,"idleSeconds":0}'::jsonb,
               0, 0, 0, 0, 0, false, 0,
               '{"policyVersionId":"p","rateVersionIds":[],"valuationVersionId":"v"}'::jsonb,
               $4, '{}'::jsonb, now())`,
      [fixture.tenantId, fixture.projectId, fixture.membershipId, "a".repeat(64)],
    );

    const result = await scanDueDays(db, { now: NOW, catchupDays: 3 });
    expect(result.find((candidate) => candidate.projectId === fixture.projectId)).toBeUndefined();
  });

  it("не возвращает проект suspended tenant", async () => {
    await testDb.pool.query("update tenants set status = 'suspended' where id = $1", [
      suspendedTenant.tenantId,
    ]);
    const result = await scanDueDays(db, { now: NOW, catchupDays: 3 });
    expect(
      result.find((candidate) => candidate.projectId === suspendedTenant.projectId),
    ).toBeUndefined();
  });

  it("начинает с локального дня, который полностью покрыт политикой", () => {
    expect(firstClosableDate("2026-11-02T12:00:00Z", "Europe/Moscow")).toBe("2026-11-03");
    expect(firstClosableDate("2026-10-31T21:00:00Z", "Europe/Moscow")).toBe("2026-11-01");
  });
});
