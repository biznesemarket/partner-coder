import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "@partner-coder/db";
import { localDateOf } from "@partner-coder/domain";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import {
  seedTenant,
  seedVendorBase,
  type TenantFixture,
  type VendorBase,
} from "../../../../packages/db/test/fixtures.js";
import { anchorAudits } from "./audit-anchor.js";

const DATE = localDateOf(Date.now(), "UTC");
const NOW = new Date(Date.now() + 86_400_000);

describe("якоря аудита", () => {
  let testDb: TestDatabase;
  let db: Database;
  let vendor: VendorBase;
  let fixture: TenantFixture;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = createDatabase(testDb.pool);
    vendor = await seedVendorBase(testDb.pool);
    fixture = await seedTenant(testDb.pool, vendor, "a");

    await testDb.pool.query(
      `insert into tenant_audit_events
         (id, tenant_id, actor, actor_type, action, entity, after)
       values
         ($1, $2, $3, 'user', 'test.first', 'tenant', '{"n": 1}'::jsonb),
         ($4, $2, $3, 'user', 'test.second', 'tenant', '{"n": 2}'::jsonb)`,
      [randomUUID(), fixture.tenantId, fixture.userId, randomUUID()],
    );
    await testDb.pool.query(
      `insert into vendor_audit_events
         (id, actor_id, action, entity, after)
       values ($1, $2, 'vendor.test', 'customer', '{"n": 3}'::jsonb)`,
      [randomUUID(), vendor.vendorUserId],
    );
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("проверяет цепочки и ставит дневной якорь tenant и vendor", async () => {
    const result = await anchorAudits(db, { date: DATE, now: NOW });
    expect(result).toMatchObject({ tenantEvents: 3, vendorEvents: 1, skipped: false });

    const anchor = await testDb.pool.query<{
      event_count: number;
      last_hash: string;
    }>(
      "select event_count, last_hash from tenant_audit_anchors where tenant_id = $1 and date = $2",
      [fixture.tenantId, DATE],
    );
    expect(anchor.rows[0]).toMatchObject({ event_count: 3 });
    expect(anchor.rows[0]?.last_hash).toMatch(/^[0-9a-f]{64}$/);

    const verified = await testDb.pool.query<{ ok: boolean }>(
      "select verify_tenant_audit_anchor($1, $2) as ok",
      [fixture.tenantId, DATE],
    );
    expect(verified.rows[0]?.ok).toBe(true);

    const vendorAnchor = await testDb.pool.query<{ event_count: number }>(
      "select event_count from vendor_audit_anchors where date = $1",
      [DATE],
    );
    expect(vendorAnchor.rows[0]?.event_count).toBe(1);
  });

  it("не ставит якорь на незакрытые UTC-сутки", async () => {
    await expect(anchorAudits(db, { date: DATE, now: new Date() })).rejects.toThrow(
      /audit_anchor_requires_closed_utc_day/,
    );
  });

  it("останавливается, если цепочка аудита повреждена", async () => {
    await testDb.pool.query(
      "alter table tenant_audit_events disable trigger tenant_audit_events_append_only",
    );
    await testDb.pool.query(
      "update tenant_audit_events set hash = repeat('0', 64) where tenant_id = $1 and action = 'test.first'",
      [fixture.tenantId],
    );
    await testDb.pool.query(
      "alter table tenant_audit_events enable trigger tenant_audit_events_append_only",
    );

    await expect(anchorAudits(db, { date: DATE, now: NOW })).rejects.toThrow(/audit_chain_invalid/);
  });
});
