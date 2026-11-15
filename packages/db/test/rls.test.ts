import { randomUUID } from "node:crypto";

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
  "device_tokens",
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
        if (table === "tenants") {
          const denied = await client
            .query(`delete from "${table}" where ctid = $1::tid`, [ctid])
            .then(() => null)
            .catch((error: { code?: string }) => error.code ?? "unknown");
          return { updated: updated.rowCount, deleted: 0, deleteError: denied };
        }
        const deleted = await client.query(`delete from "${table}" where ctid = $1::tid`, [ctid]);
        return { updated: updated.rowCount, deleted: deleted.rowCount, deleteError: null };
      });
      expect(result.updated, `${table}: UPDATE чужой строки`).toBe(0);
      expect(result.deleted, `${table}: DELETE чужой строки`).toBe(0);
      if (table === "tenants") {
        expect(result.deleteError).toBe("42501");
      }
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

  it("включает RLS и политики на всех тенантских таблицах", async () => {
    const { rows } = await database.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*) from pg_policies p
                where p.schemaname = 'public' and p.tablename = c.relname)::text as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const byTable = new Map(rows.map((row) => [row.relname, row]));
    for (const table of [...tenantTables, "tenants", "users", "auth_sessions"]) {
      const row = byTable.get(table);
      expect(row?.relrowsecurity, `${table}: RLS выключен`).toBe(true);
      expect(row?.relforcerowsecurity, `${table}: FORCE RLS выключен`).toBe(true);
      expect(Number(row?.policies), `${table}: нет политик`).toBeGreaterThan(0);
    }

    const grants = await database.pool.query<{
      ledger_insert: boolean;
      audit_insert: boolean;
      session_insert: boolean;
      user_insert: boolean;
    }>(
      `select
         has_table_privilege('partner_coder_api', 'day_records', 'INSERT') as ledger_insert,
         has_table_privilege('partner_coder_api', 'tenant_audit_events', 'INSERT') as audit_insert,
         has_table_privilege('partner_coder_api', 'auth_sessions', 'INSERT') as session_insert,
         has_table_privilege('partner_coder_api', 'users', 'INSERT') as user_insert`,
    );
    expect(grants.rows[0]).toEqual({
      ledger_insert: false,
      audit_insert: false,
      session_insert: true,
      user_insert: true,
    });
  });

  it("API-роль может создать пользователя и разрешить сессию через функции", async () => {
    const userId = randomUUID();
    const email = `new-${userId}@example.com`;
    const tokenHash = `token-${userId}`;

    const result = await asTenant(
      database.pool,
      tenantA.tenantId,
      async (client) => {
        const user = await client.query<{ id: string }>(
          `insert into users (id, email, name, status)
           values ($1, $2, 'Новый пользователь', 'active') returning id`,
          [userId, email],
        );
        await client.query(
          `insert into auth_sessions (user_id, token, token_hash, expires_at)
           values ($1, $2, $2, '2026-12-01T00:00:00Z')`,
          [userId, tokenHash],
        );
        const byEmail = await client.query<{ id: string; email: string }>(
          "select id, email from auth_user_by_email($1)",
          [email],
        );
        const byToken = await client.query<{ session_id: string; user_id: string }>(
          "select session_id, user_id from auth_session_by_token($1)",
          [tokenHash],
        );
        return {
          created: user.rows[0]?.id,
          emailUser: byEmail.rows[0],
          tokenSession: byToken.rows[0],
        };
      },
      userId,
    );

    expect(result.created).toBe(userId);
    expect(result.emailUser).toEqual({ id: userId, email });
    expect(result.tokenSession).toMatchObject({ user_id: userId });
  });

  it("API-роль пишет аудит через app_audit с actor из контекста", async () => {
    const audit = await asTenant(
      database.pool,
      tenantA.tenantId,
      async (client) => {
        const inserted = await client.query<{ id: string }>(
          `select app_audit('test.api', 'test.entity', null, '{"x": 1}'::jsonb) as id`,
        );
        const event = await client.query<{ actor: string; actor_type: string }>(
          `select actor, actor_type from tenant_audit_events where id = $1`,
          [inserted.rows[0]?.id],
        );
        return event.rows[0];
      },
      tenantA.userId,
    );
    expect(audit).toEqual({ actor: tenantA.userId, actor_type: "user" });
  });

  it("не позволяет сослаться на родителя другого tenant", async () => {
    const inserts: { name: string; sql: string; values: unknown[] }[] = [
      {
        name: "devices",
        sql: `insert into devices (tenant_id, membership_id, public_key, name, os)
              values ($1, $2, $3, 'Чужой', 'Windows')`,
        values: [tenantA.tenantId, tenantB.membershipId, randomUUID()],
      },
      {
        name: "project_members",
        sql: `insert into project_members (tenant_id, project_id, membership_id, role)
              values ($1, $2, $3, 'developer')`,
        values: [tenantA.tenantId, tenantB.projectId, tenantA.membershipId],
      },
      {
        name: "policies",
        sql: `insert into policies (tenant_id, project_id, version, params, effective_from, sha256)
              values ($1, $2, 99, '{}'::jsonb, '2026-12-01T00:00:00Z', $3)`,
        values: [tenantA.tenantId, tenantB.projectId, "9".repeat(64)],
      },
      {
        name: "work_sessions",
        sql: `insert into work_sessions (tenant_id, project_id, membership_id, started_at)
              values ($1, $2, $3, '2026-12-01T00:00:00Z')`,
        values: [tenantA.tenantId, tenantB.projectId, tenantA.membershipId],
      },
      {
        name: "day_records",
        sql: `insert into day_records
                (tenant_id, project_id, membership_id, date_local, timezone, paid_seconds,
                 classes, amount_kopecks, cash_kopecks, equity_kopecks, share_bp,
                 pending_equity_kopecks, versions, input_hash, explanation, closed_at)
              values ($1, $2, $3, '2026-12-31', 'Europe/Moscow', 0,
                      '{}'::jsonb, 0, 0, 0, 0, 0, '{}'::jsonb, $4, '{}'::jsonb,
                      '2026-12-31T00:00:00Z')`,
        values: [tenantA.tenantId, tenantB.projectId, tenantA.membershipId, "8".repeat(64)],
      },
      {
        name: "rate_versions",
        sql: `insert into rate_versions
                (tenant_id, policy_id, effective_from, value_kopecks, reason)
              values ($1, $2, '2026-12-01T00:00:00Z', 100, 'Проверка')`,
        values: [tenantA.tenantId, tenantB.policyId],
      },
      {
        name: "payout_items",
        sql: `insert into payout_items (tenant_id, batch_id, membership_id, amount_kopecks)
              values ($1, $2, $3, 1)`,
        values: [tenantA.tenantId, tenantB.payoutBatchId, tenantA.membershipId],
      },
    ];

    for (const insert of inserts) {
      const query = database.pool.query(insert.sql, insert.values);
      await expect(query, `${insert.name}: ссылка на чужого родителя прошла`).rejects.toMatchObject(
        {
          code: "23503",
        },
      );
    }
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
