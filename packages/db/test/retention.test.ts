import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_ROLE, WORKER_ROLE, asRole, createTestDatabase, type TestDatabase } from "./helpers.js";
import { seedTenant, seedVendorBase, type TenantFixture } from "./fixtures.js";

describe("retention сырых heartbeat", () => {
  let testDb: TestDatabase;
  let fixture: TenantFixture;
  let oldHeartbeat: string;
  let recentHeartbeat: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const vendor = await seedVendorBase(testDb.pool);
    fixture = await seedTenant(testDb.pool, vendor, "a");
    oldHeartbeat = randomUUID();
    recentHeartbeat = randomUUID();
    await testDb.pool.query(
      `insert into heartbeats
         (event_id, tenant_id, session_id, seq, class, start_utc, end_utc, received_at)
       values
         ($1, $2, $3, 10, 'active_human', now() - interval '101 days', now() - interval '101 days' + interval '1 minute', now() - interval '101 days'),
         ($4, $2, $3, 11, 'active_human', now() - interval '2 days', now() - interval '2 days' + interval '1 minute', now() - interval '2 days')`,
      [oldHeartbeat, fixture.tenantId, fixture.sessionId, recentHeartbeat],
    );
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("удаляет только старые heartbeat через функцию и считает строки", async () => {
    const client = await testDb.pool.connect();
    let deleted = 0;
    try {
      await client.query("begin");
      await client.query(`set local role ${WORKER_ROLE}`);
      const result = await client.query<{ deleted: string }>(
        "select retention_delete_heartbeats(now() - interval '90 days') as deleted",
      );
      deleted = Number(result.rows[0]?.deleted ?? 0);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    expect(deleted).toBe(1);

    const remaining = await testDb.pool.query<{ event_id: string }>(
      "select event_id from heartbeats where event_id in ($1, $2) order by event_id",
      [oldHeartbeat, recentHeartbeat],
    );
    expect(remaining.rows.map((row) => row.event_id)).toEqual([recentHeartbeat]);
  });

  it("не разрешает прямой DELETE даже роли retention", async () => {
    await expect(
      asRole(testDb.pool, "partner_coder_retention", async (client) =>
        client.query("delete from heartbeats where event_id = $1", [recentHeartbeat]),
      ),
    ).rejects.toThrow(/append_only_violation/);
  });

  it("не дает API-роли вызывать retention-функцию", async () => {
    await expect(
      asRole(testDb.pool, API_ROLE, async (client) =>
        client.query("select retention_delete_heartbeats(now())"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
