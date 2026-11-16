import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  API_ROLE,
  VENDOR_ROLE,
  WORKER_ROLE,
  asRole,
  createTestDatabase,
  type TestDatabase,
} from "./helpers.js";
import { seedVendorBase, type VendorBase } from "./fixtures.js";

const VENDOR_AUTH_ROLE = "partner_coder_vendor_auth";

describe("роли и гранты vendor auth M3", () => {
  let database: TestDatabase;
  let base: VendorBase;
  let sessionId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    base = await seedVendorBase(database.pool);
    sessionId = randomUUID();
    await database.pool.query(
      `insert into vendor_auth_sessions (id, token, user_id, expires_at)
       values ($1, $2, $3, '2026-12-01T00:00:00Z')`,
      [sessionId, `token-${sessionId}`, base.vendorUserId],
    );
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  }, 60_000);

  it("partner_coder_vendor_auth читает пользователей, пишет лимиты и аудит", async () => {
    const result = await asRole(database.pool, VENDOR_AUTH_ROLE, async (client) => {
      const users = await client.query<{ count: string }>("select count(*) from vendor_users");
      const rateLimit = await client.query<{ id: string }>(
        `insert into vendor_auth_rate_limits (key, count, last_request)
         values ($1, 1, $2)
         returning id`,
        [randomUUID(), Date.now()],
      );
      const audit = await client.query<{ id: string }>(
        `select vendor_audit($1, null, 'vendor_auth.test', 'vendor_users', null, '{"ok": true}'::jsonb, null) as id`,
        [base.vendorUserId],
      );
      return {
        users: Number(users.rows[0]?.count),
        rateLimit: Boolean(rateLimit.rows[0]?.id),
        audit: Boolean(audit.rows[0]?.id),
      };
    });

    expect(result).toEqual({ users: 1, rateLimit: true, audit: true });
  });

  it("partner_coder_vendor_auth не видит tenant-данные и журнал аудита напрямую", async () => {
    for (const table of ["customers", "users", "vendor_audit_events"]) {
      const query = asRole(database.pool, VENDOR_AUTH_ROLE, (client) =>
        client.query(`select count(*) from ${table}`),
      );
      await expect(query, `${table}: чтение должно быть запрещено`).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("partner_coder_vendor не читает vendor_auth_accounts", async () => {
    const query = asRole(database.pool, VENDOR_ROLE, (client) =>
      client.query("select count(*) from vendor_auth_accounts"),
    );
    await expect(query).rejects.toMatchObject({ code: "42501" });
  });

  it("partner_coder_api не читает vendor_users и vendor_auth_sessions", async () => {
    for (const table of ["vendor_users", "vendor_auth_sessions"]) {
      const query = asRole(database.pool, API_ROLE, (client) =>
        client.query(`select count(*) from ${table}`),
      );
      await expect(query, `${table}: чтение должно быть запрещено`).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("цепочка vendor-аудита валидна после записи через vendor_audit", async () => {
    await database.pool.query(
      `select vendor_audit($1, null, 'vendor_auth.verify', 'vendor_users', null, '{"ok": true}'::jsonb, null)`,
      [base.vendorUserId],
    );
    const { rows } = await database.pool.query<{ verify: boolean }>(
      "select verify_vendor_audit_chain() as verify",
    );
    expect(rows[0]?.verify).toBe(true);
  });

  it("partner_coder_worker удаляет вендорские сессии", async () => {
    const deleted = await asRole(database.pool, WORKER_ROLE, async (client) => {
      const result = await client.query("delete from vendor_auth_sessions where id = $1", [
        sessionId,
      ]);
      return result.rowCount;
    });
    expect(deleted).toBe(1);
  });

  it("выдаёт гранты и оставляет владельцем функции worker", async () => {
    const { rows } = await database.pool.query<{
      owner: string;
      auth_select_audit: boolean;
      auth_execute: boolean;
      api_execute: boolean;
      auth_select_sessions: boolean;
      worker_delete_sessions: boolean;
    }>(
      `select pg_get_userbyid(p.proowner) as owner,
              has_table_privilege('partner_coder_vendor_auth', 'vendor_audit_events', 'SELECT') as auth_select_audit,
              has_function_privilege('partner_coder_vendor_auth', 'vendor_audit(uuid, uuid, text, text, jsonb, jsonb, inet)', 'EXECUTE') as auth_execute,
              has_function_privilege('partner_coder_api', 'vendor_audit(uuid, uuid, text, text, jsonb, jsonb, inet)', 'EXECUTE') as api_execute,
              has_table_privilege('partner_coder_vendor_auth', 'vendor_auth_sessions', 'SELECT') as auth_select_sessions,
              has_table_privilege('partner_coder_worker', 'vendor_auth_sessions', 'DELETE') as worker_delete_sessions
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'vendor_audit'`,
    );
    expect(rows[0]).toEqual({
      owner: "partner_coder_worker",
      auth_select_audit: false,
      auth_execute: true,
      api_execute: false,
      auth_select_sessions: true,
      worker_delete_sessions: true,
    });
  });
});
