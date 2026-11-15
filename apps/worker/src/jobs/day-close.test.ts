import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@partner-coder/db";
import { defaultPolicyDocument } from "@partner-coder/domain";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import {
  seedTenant,
  seedVendorBase,
  type TenantFixture,
} from "../../../../packages/db/test/fixtures.js";
import { closeProjectDay, dayCloseLockKey } from "./day-close.js";

const DATE = "2026-11-02";
const SESSION_ID = randomUUID();

describe("закрытие дня", () => {
  let testDb: TestDatabase;
  let db: Database;
  let fixture: TenantFixture;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = createDatabase(testDb.pool);
    const vendor = await seedVendorBase(testDb.pool);
    fixture = await seedTenant(testDb.pool, vendor, "a");

    const document = defaultPolicyDocument({
      meta: {
        tenant_id: fixture.tenantId,
        project_id: fixture.projectId,
        approved_by: fixture.userId,
        effective_from: "2026-10-01T00:00:00+03:00",
      },
      project: {
        name: "Проект закрытия дня",
        repo: "demo/day-close",
        timezone: "Europe/Moscow",
        default_branch: "main",
      },
      economics: {
        valuation_rub: 1_000_000,
        rate_rub_per_hour: 500,
        pool_pct: 30,
        founder_floor_pct: 70,
        cash_share_pct: 0,
      },
    });
    await testDb.pool.query(
      `update policies
          set params = $1::jsonb, effective_from = '2026-10-01T00:00:00Z'
        where id = $2`,
      [JSON.stringify(document), fixture.policyId],
    );
    await testDb.pool.query(
      "update rate_versions set effective_from = '2026-10-01T00:00:00Z' where policy_id = $1",
      [fixture.policyId],
    );
    await testDb.pool.query(
      "update valuation_versions set effective_from = '2026-10-01T00:00:00Z' where policy_id = $1",
      [fixture.policyId],
    );

    await testDb.pool.query(
      `insert into work_sessions
         (id, tenant_id, project_id, membership_id, task_ref, branch, status, started_at, ended_at)
       values ($1, $2, $3, $4, 'TASK-DAY', 'main', 'ended',
               '2026-11-02T09:00:00Z', '2026-11-02T10:01:00Z')`,
      [SESSION_ID, fixture.tenantId, fixture.projectId, fixture.membershipId],
    );
    await addInterval("2026-11-02T09:00:00Z", "2026-11-02T09:01:00Z", 60);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  async function addInterval(startUtc: string, endUtc: string, seconds: number): Promise<void> {
    await testDb.pool.query(
      `insert into intervals
         (id, tenant_id, session_id, class, start_utc, end_utc, seconds, source, created_at)
       values ($1, $2, $3, 'active_human', $4, $5, $6, 'agent', $5::timestamptz)`,
      [randomUUID(), fixture.tenantId, SESSION_ID, startUtc, endUtc, seconds],
    );
  }

  it("создает неизменяемый день и повторный запуск не дублирует запись", async () => {
    const first = await closeProjectDay(db, {
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      date: DATE,
    });
    expect(first).toMatchObject({ created: 1, duplicate: 0, adjusted: 0, skipped: false });

    const rows = await testDb.pool.query<{
      id: string;
      paid_seconds: number;
      amount_kopecks: string;
      input_hash: string;
      pool_used_bp: number;
    }>(
      `select id, paid_seconds, amount_kopecks, input_hash, pool_used_bp
         from day_records
        where tenant_id = $1 and project_id = $2 and membership_id = $3 and date_local = $4`,
      [fixture.tenantId, fixture.projectId, fixture.membershipId, DATE],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      paid_seconds: 60,
      amount_kopecks: "833",
      pool_used_bp: 0,
    });

    const second = await closeProjectDay(db, {
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      date: DATE,
    });
    expect(second).toMatchObject({ created: 0, duplicate: 1, adjusted: 0, skipped: false });

    const after = await testDb.pool.query<{ count: string }>(
      "select count(*) from day_records where tenant_id = $1 and date_local = $2",
      [fixture.tenantId, DATE],
    );
    expect(after.rows[0]?.count).toBe("1");
  });

  it("изменившиеся данные создают компенсацию, а не перезапись дня", async () => {
    await addInterval("2026-11-02T09:01:00Z", "2026-11-02T10:01:00Z", 3600);

    const result = await closeProjectDay(db, {
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      date: DATE,
    });
    expect(result).toMatchObject({ created: 0, duplicate: 0, adjusted: 1, skipped: false });

    const day = await testDb.pool.query<{ amount_kopecks: string; input_hash: string }>(
      "select amount_kopecks, input_hash from day_records where tenant_id = $1 and date_local = $2",
      [fixture.tenantId, DATE],
    );
    expect(day.rows[0]?.amount_kopecks).toBe("833");

    const adjustments = await testDb.pool.query<{
      delta_kopecks: string;
      reason: string;
      input_hash: string;
    }>(
      `select a.delta_kopecks, a.reason, a.input_hash
         from day_adjustments a
         join day_records d on d.tenant_id = a.tenant_id and d.id = a.day_record_id
        where a.tenant_id = $1 and d.project_id = $2 and d.date_local = $3`,
      [fixture.tenantId, fixture.projectId, DATE],
    );
    expect(adjustments.rows).toHaveLength(1);
    expect(adjustments.rows[0]).toMatchObject({
      delta_kopecks: "50000",
      reason: "Пересчет закрытого дня",
    });
    expect(adjustments.rows[0]?.input_hash).toMatch(/^[0-9a-f]{64}$/);

    const repeated = await closeProjectDay(db, {
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      date: DATE,
    });
    expect(repeated).toMatchObject({ created: 0, duplicate: 1, adjusted: 0, skipped: false });

    const adjustmentsAfter = await testDb.pool.query<{ count: string }>(
      `select count(*)
         from day_adjustments a
         join day_records d on d.tenant_id = a.tenant_id and d.id = a.day_record_id
        where a.tenant_id = $1 and d.project_id = $2 and d.date_local = $3`,
      [fixture.tenantId, fixture.projectId, DATE],
    );
    expect(adjustmentsAfter.rows[0]?.count).toBe("1");
  });

  it("не запускается параллельно для того же проекта и дня", async () => {
    const client = await testDb.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        dayCloseLockKey(fixture.tenantId, fixture.projectId, "2026-11-03"),
      ]);
      const result = await closeProjectDay(db, {
        tenantId: fixture.tenantId,
        projectId: fixture.projectId,
        date: "2026-11-03",
      });
      expect(result.skipped).toBe(true);
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });
});
