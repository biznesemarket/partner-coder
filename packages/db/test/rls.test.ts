import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  API_ROLE,
  VENDOR_ROLE,
  WORKER_ROLE,
  asRole,
  asTenant,
  createTestDatabase,
  type TestDatabase,
} from "./helpers.js";
import { seedTenant, seedVendorBase, type TenantFixture, type VendorBase } from "./fixtures.js";

const tenantTables = [
  "memberships",
  "projects",
  "project_members",
  "policies",
  "rate_versions",
  "valuation_versions",
  "work_sessions",
  "heartbeats",
  "intervals",
  "day_records",
  "day_adjustments",
  "day_flags",
  "disputes",
  "payout_batches",
  "payout_items",
  "devices",
  "invitations",
  "git_integrations",
  "connector_events",
  "repo_facts",
  "notifications",
  "digest_runs",
  "monthly_snapshots",
  "tenant_audit_events",
  "tenant_audit_anchors",
  "idempotency_keys",
] as const;

const appendOnlyTables = new Set([
  "heartbeats",
  "intervals",
  "day_records",
  "day_adjustments",
  "day_flags",
  "connector_events",
  "repo_facts",
  "monthly_snapshots",
  "tenant_audit_events",
  "tenant_audit_anchors",
]);

describe("RLS и роли БД", () => {
  let database: TestDatabase;
  let base: VendorBase;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    database = await createTestDatabase();
    base = await seedVendorBase(database.pool);
    tenantA = await seedTenant(database.pool, base, "a");
    tenantB = await seedTenant(database.pool, base, "b");
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it("tenant A видит только свои строки во всех тенантских таблицах", async () => {
    for (const table of tenantTables) {
      const result = await asTenant(database.pool, tenantA.tenantId, async (client) => {
        const visible = await client.query<{ count: string }>(`select count(*) from "${table}"`);
        const foreign = await client.query<{ count: string }>(
          `select count(*) from "${table}" where tenant_id = $1`,
          [tenantB.tenantId],
        );
        return { visible: Number(visible.rows[0]?.count), foreign: Number(foreign.rows[0]?.count) };
      });
      expect(result.visible, `${table}: своя строка не видна`).toBe(1);
      expect(result.foreign, `${table}: чужая строка видна`).toBe(0);
    }
  });

  it("tenant A видит только свою строку tenant и своих пользователей", async () => {
    const result = await asTenant(
      database.pool,
      tenantA.tenantId,
      async (client) => {
        const tenants = await client.query<{ count: string }>("select count(*) from tenants");
        const users = await client.query<{ count: string }>("select count(*) from users");
        const sessions = await client.query<{ count: string }>(
          "select count(*) from auth_sessions",
        );
        const foreignUsers = await client.query<{ count: string }>(
          "select count(*) from users where id = $1",
          [tenantB.userId],
        );
        return {
          tenants: Number(tenants.rows[0]?.count),
          users: Number(users.rows[0]?.count),
          sessions: Number(sessions.rows[0]?.count),
          foreignUsers: Number(foreignUsers.rows[0]?.count),
        };
      },
      tenantA.userId,
    );
    expect(result).toEqual({ tenants: 1, users: 1, sessions: 1, foreignUsers: 0 });
  });

  it("tenant A не может изменить или удалить строки tenant B", async () => {
    for (const table of [...tenantTables, "tenants"]) {
      const key = table === "tenants" ? "id" : "tenant_id";
      const { rows } = await database.pool.query<{ ctid: string }>(
        `select ctid::text as ctid from "${table}" where ${key} = $1 limit 1`,
        [tenantB.tenantId],
      );
      const ctid = rows[0]?.ctid;
      expect(ctid, `${table}: нет строки tenant B`).toBeTruthy();

      if (appendOnlyTables.has(table)) {
        const mutation = asTenant(database.pool, tenantA.tenantId, (client) =>
          client.query(`update "${table}" set tenant_id = tenant_id where ctid = $1::tid`, [ctid]),
        );
        await expect(mutation).rejects.toMatchObject({ code: "42501" });
        continue;
      }

      const result = await asTenant(database.pool, tenantA.tenantId, async (client) => {
        const assignment = table === "tenants" ? "name = name" : "tenant_id = tenant_id";
        const updated = await client.query(
          `update "${table}" set ${assignment} where ctid = $1::tid`,
          [ctid],
        );
        const deleted = await client.query(`delete from "${table}" where ctid = $1::tid`, [ctid]);
        return { updated: updated.rowCount, deleted: deleted.rowCount };
      });
      expect(result.updated, `${table}: UPDATE чужой строки`).toBe(0);
      expect(result.deleted, `${table}: DELETE чужой строки`).toBe(0);
    }
  });

  it("tenant A не может вставить строку с tenant_id B", async () => {
    const insertProject = asTenant(database.pool, tenantA.tenantId, (client) =>
      client.query(
        `insert into projects (tenant_id, name, repo) values ($1, 'Чужой', 'other/repo')`,
        [tenantB.tenantId],
      ),
    );
    await expect(insertProject).rejects.toMatchObject({ code: "42501" });

    const insertHeartbeat = asTenant(database.pool, tenantA.tenantId, (client) =>
      client.query(
        `insert into heartbeats
           (event_id, tenant_id, session_id, seq, class, start_utc, end_utc, signals, signature_valid)
         values (gen_random_uuid(), $1, $2, 99, 'active_human', '2026-11-20T09:00:00Z', '2026-11-20T09:01:00Z', '{}'::jsonb, true)`,
        [tenantB.tenantId, tenantB.sessionId],
      ),
    );
    await expect(insertHeartbeat).rejects.toMatchObject({ code: "42501" });

    const insertAudit = asTenant(database.pool, tenantA.tenantId, (client) =>
      client.query(
        `insert into tenant_audit_events (tenant_id, actor_type, action, entity)
         values ($1, 'system', 'test.cross', 'test')`,
        [tenantB.tenantId],
      ),
    );
    await expect(insertAudit).rejects.toMatchObject({ code: "42501" });

    const insertIdempotency = asTenant(database.pool, tenantA.tenantId, (client) =>
      client.query(
        `insert into idempotency_keys (tenant_id, scope, key, request_hash, expires_at)
         values ($1, 'POST /v1/test', 'cross', $2, '2026-12-01T00:00:00Z')`,
        [tenantB.tenantId, "1".repeat(64)],
      ),
    );
    await expect(insertIdempotency).rejects.toMatchObject({ code: "42501" });
  });

  it("без app.tenant_id API-роль не видит ни одной строки", async () => {
    const counts = await asRole(database.pool, API_ROLE, async (client) => {
      const projects = await client.query<{ count: string }>("select count(*) from projects");
      const tenants = await client.query<{ count: string }>("select count(*) from tenants");
      return { projects: Number(projects.rows[0]?.count), tenants: Number(tenants.rows[0]?.count) };
    });
    expect(counts).toEqual({ projects: 0, tenants: 0 });
  });

  it("worker обходит RLS, вендор не читает тенантские таблицы", async () => {
    const workerCount = await asRole(database.pool, WORKER_ROLE, async (client) => {
      const result = await client.query<{ count: string }>("select count(*) from projects");
      return Number(result.rows[0]?.count);
    });
    expect(workerCount).toBe(2);

    const vendorCustomers = await asRole(database.pool, VENDOR_ROLE, async (client) => {
      const result = await client.query<{ count: string }>("select count(*) from customers");
      return Number(result.rows[0]?.count);
    });
    expect(vendorCustomers).toBe(2);

    const vendorProjects = asRole(database.pool, VENDOR_ROLE, (client) =>
      client.query("select count(*) from projects"),
    );
    await expect(vendorProjects).rejects.toMatchObject({ code: "42501" });
  });
});
