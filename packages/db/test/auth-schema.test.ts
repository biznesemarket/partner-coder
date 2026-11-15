import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import {
  API_ROLE,
  AUTH_ROLE,
  asRole,
  asTenant,
  createTestDatabase,
  type TestDatabase,
} from "./helpers.js";
import { seedTenant as seedFixtureTenant, seedVendorBase } from "./fixtures.js";

let testDb: TestDatabase;

interface PgError {
  code?: string;
}

function isPgError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as PgError).code === code;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
});

describe("схема аутентификации M2.2", () => {
  it("добавляет Better Auth-таблицы, поля сессии и device tokens", async () => {
    const tables = await testDb.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('auth_accounts','auth_verifications','auth_two_factors','auth_passkeys','auth_rate_limits','device_tokens')
        order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "auth_accounts",
      "auth_passkeys",
      "auth_rate_limits",
      "auth_two_factors",
      "auth_verifications",
      "device_tokens",
    ]);

    const columns = await testDb.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'users' and column_name in ('email_verified','image'))
            or (table_name = 'auth_sessions' and column_name in ('token','updated_at','active_tenant_id')))
        order by table_name, column_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: "auth_sessions", column_name: "active_tenant_id" },
      { table_name: "auth_sessions", column_name: "token" },
      { table_name: "auth_sessions", column_name: "updated_at" },
      { table_name: "users", column_name: "email_verified" },
      { table_name: "users", column_name: "image" },
    ]);
  });

  it("создает роль partner_coder_auth с доступом к auth-таблицам", async () => {
    const role = await testDb.pool.query<{ rolname: string }>(
      "select rolname from pg_roles where rolname = $1",
      [AUTH_ROLE],
    );
    expect(role.rows).toHaveLength(1);

    const userId = randomUUID();
    const sessionId = randomUUID();
    const accountId = randomUUID();

    await asRole(testDb.pool, AUTH_ROLE, async (client) => {
      await client.query(
        `insert into users (id, email, name, status, email_verified)
         values ($1, 'auth-role@example.com', 'Auth Role', 'active', true)`,
        [userId],
      );
      await client.query(
        `insert into auth_sessions (id, user_id, token, expires_at)
         values ($1, $2, 'raw-better-auth-token', '2026-12-01T00:00:00Z')`,
        [sessionId, userId],
      );
      await client.query(
        `insert into auth_accounts (id, account_id, provider_id, user_id)
         values ($1, $2, 'email-otp', $3)`,
        [accountId, userId, userId],
      );
      const found = await client.query<{ id: string }>(
        "select id from users where lower(email) = 'auth-role@example.com'",
      );
      expect(found.rows[0]?.id).toBe(userId);
    });
  });

  it("не дает API-роли читать Better Auth-секреты", async () => {
    for (const table of [
      "auth_accounts",
      "auth_verifications",
      "auth_two_factors",
      "auth_passkeys",
    ]) {
      await expect(
        asRole(testDb.pool, API_ROLE, async (client) => {
          await client.query(`select * from ${table}`);
        }),
        table,
      ).rejects.toSatisfy((error: unknown) => isPgError(error, "42501"));
    }
  });

  it("изолирует таблицы rate limit по ролям", async () => {
    await expect(
      asRole(testDb.pool, API_ROLE, async (client) => {
        await client.query("select * from auth_rate_limits");
      }),
    ).rejects.toSatisfy((error: unknown) => isPgError(error, "42501"));

    await expect(
      asRole(testDb.pool, AUTH_ROLE, async (client) => {
        await client.query("select * from email_rate_limits");
      }),
    ).rejects.toSatisfy((error: unknown) => isPgError(error, "42501"));

    await asRole(testDb.pool, AUTH_ROLE, async (client) => {
      await client.query(
        "insert into auth_rate_limits (key, count, last_request) values ('203.0.113.1|/sign-in', 1, 1)",
      );
      const row = await client.query<{ count: number }>(
        "select count from auth_rate_limits where key = '203.0.113.1|/sign-in'",
      );
      expect(row.rows[0]?.count).toBe(1);
    });

    await asRole(testDb.pool, API_ROLE, async (client) => {
      await client.query(
        `insert into email_rate_limits (key, count, window_started_at)
         values ('rate@example.com', 2, now())`,
      );
      const row = await client.query<{ count: number }>(
        "select count from email_rate_limits where key = 'rate@example.com'",
      );
      expect(row.rows[0]?.count).toBe(2);
    });

    const grants = await testDb.pool.query<{
      auth_delete: boolean;
      email_delete: boolean;
    }>(
      `select
         has_table_privilege('partner_coder_worker', 'auth_rate_limits', 'DELETE') as auth_delete,
         has_table_privilege('partner_coder_worker', 'email_rate_limits', 'DELETE') as email_delete`,
    );
    expect(grants.rows[0]).toEqual({ auth_delete: true, email_delete: true });
  });

  it("изолирует device_tokens по tenant и запрещает ссылку на чужое membership", async () => {
    const base = await seedVendorBase(testDb.pool);
    const tenantA = await seedFixtureTenant(testDb.pool, base, "a");
    const tenantB = await seedFixtureTenant(testDb.pool, base, "b");
    const tokenA = randomUUID();
    const tokenB = randomUUID();
    const hashA = "1".repeat(64);
    const hashB = "2".repeat(64);

    await asTenant(testDb.pool, tenantA.tenantId, async (client) => {
      await client.query(
        `insert into device_tokens (id, tenant_id, membership_id, token_hash, token_prefix, scope, label, expires_at)
         values ($1, $2, $3, $4, 'pcd_a', 'agent', 'CI', '2026-12-01T00:00:00Z')`,
        [tokenA, tenantA.tenantId, tenantA.membershipId, hashA],
      );
      const visible = await client.query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from device_tokens",
      );
      expect(visible.rows.every((row) => row.tenant_id === tenantA.tenantId)).toBe(true);
      expect(visible.rows.map((row) => row.id)).toContain(tokenA);
    });

    await expect(
      asTenant(testDb.pool, tenantB.tenantId, async (client) => {
        await client.query(
          `insert into device_tokens (id, tenant_id, membership_id, token_hash, token_prefix, scope)
           values ($1, $2, $3, $4, 'pcd_b', 'agent')`,
          [tokenB, tenantB.tenantId, tenantA.membershipId, hashB],
        );
      }),
    ).rejects.toSatisfy((error: unknown) => isPgError(error, "23503"));
  });

  it("проверяет членство получателя уведомления", async () => {
    const base = await seedVendorBase(testDb.pool);
    const tenant = await seedFixtureTenant(testDb.pool, base, "a");
    const outsider = randomUUID();

    await testDb.pool.query(
      `insert into users (id, email, name, status)
       values ($1, 'outsider@example.com', 'Outsider', 'active')`,
      [outsider],
    );

    await expect(
      testDb.pool.query(
        `insert into notifications (tenant_id, recipient_user_id, recipient, channel, kind, status, payload)
         values ($1, $2, 'outsider@example.com', 'email', 'digest', 'pending', '{}'::jsonb)`,
        [tenant.tenantId, outsider],
      ),
    ).rejects.toSatisfy((error: unknown) => isPgError(error, "23503"));
  });

  it("возвращает членства и device-токен через SECURITY DEFINER функции", async () => {
    const base = await seedVendorBase(testDb.pool);
    const tenant = await seedFixtureTenant(testDb.pool, base, "a");
    const hash = "3".repeat(64);

    await testDb.pool.query(
      `insert into device_tokens (tenant_id, membership_id, token_hash, token_prefix, scope)
       values ($1, $2, $3, 'pcd_x', 'agent')`,
      [tenant.tenantId, tenant.membershipId, hash],
    );

    const memberships = await asRole(testDb.pool, API_ROLE, async (client) => {
      const result = await client.query<{ tenant_id: string; role: string }>(
        "select tenant_id, role from auth_user_memberships($1)",
        [tenant.userId],
      );
      return result.rows;
    });
    expect(memberships).toEqual([{ tenant_id: tenant.tenantId, role: "director" }]);

    const device = await asRole(testDb.pool, API_ROLE, async (client) => {
      const result = await client.query<{ tenant_id: string; user_id: string; scope: string }>(
        "select tenant_id, user_id, scope from auth_device_by_token_hash($1)",
        [hash],
      );
      return result.rows;
    });
    expect(device).toEqual([
      { tenant_id: tenant.tenantId, user_id: tenant.userId, scope: "agent" },
    ]);
  });
});
