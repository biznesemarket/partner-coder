import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import { createTestDatabase, type TestDatabase } from "./helpers.js";
import {
  activateAfterPasswordReset,
  getVendorUserByEmail,
  getVendorUserById,
  listVendorUsers,
  markVendorLogin,
  resetVendorMfa,
  revokeVendorSessions,
  updateVendorUser,
  writeVendorAudit,
} from "../src/vendor-auth/index.js";

const vendorEmail = "vendor@demo.partnercoder.local";

let database: TestDatabase;
let vendorUserId: string;

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyVendorChain(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ verify: boolean }>(
    "select verify_vendor_audit_chain() as verify",
  );
  return rows[0]?.verify === true;
}

async function deleteAuthRows(userId: string): Promise<void> {
  await database.pool.query("delete from vendor_auth_two_factors where user_id = $1", [userId]);
  await database.pool.query("delete from vendor_auth_passkeys where user_id = $1", [userId]);
  await database.pool.query("delete from vendor_auth_sessions where user_id = $1", [userId]);
}

beforeAll(async () => {
  database = await createTestDatabase();
  vendorUserId = randomUUID();
  await database.pool.query(
    `insert into vendor_users (id, email, name, role, status)
     values ($1, $2, 'Вендор', 'support', 'invited')`,
    [vendorUserId, vendorEmail],
  );
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

beforeEach(async () => {
  await deleteAuthRows(vendorUserId);
  await database.pool.query(
    `update vendor_users
        set status = 'invited', email_verified = false, mfa_enabled = false,
            last_login_at = null
      where id = $1`,
    [vendorUserId],
  );
});

describe("vendor auth: аудит", () => {
  it("пишет событие в vendor_audit_events и цепочка валидна", async () => {
    const id = await writeVendorAudit(database.db, {
      actorId: vendorUserId,
      action: "vendor.test.event",
      entity: "vendor_user",
      after: { ok: true },
    });

    expect(id).toMatch(uuidRe);
    expect(await verifyVendorChain(database.pool)).toBe(true);

    const { rows } = await database.pool.query<{
      before: unknown;
      after: unknown;
      actor_id: string;
    }>("select actor_id, before, after from vendor_audit_events where id = $1", [id]);
    expect(rows[0]).toMatchObject({ actor_id: vendorUserId, before: null, after: { ok: true } });
  });

  it("передаёт null для отсутствующих JSON и IP", async () => {
    const id = await writeVendorAudit(database.db, {
      action: "vendor.test.empty",
      entity: "vendor_user",
    });

    const { rows } = await database.pool.query<{
      before: unknown;
      after: unknown;
      actor_id: string | null;
      ip: string | null;
    }>("select actor_id, before, after, ip from vendor_audit_events where id = $1", [id]);
    expect(rows[0]).toEqual({ actor_id: null, before: null, after: null, ip: null });
  });
});

describe("vendor auth: пользователи", () => {
  it("markVendorLogin переводит invited в active, но не реактивирует suspended", async () => {
    await markVendorLogin(database.db, vendorUserId);
    const activated = await getVendorUserById(database.db, vendorUserId);
    expect(activated?.status).toBe("active");
    expect(activated?.lastLoginAt).toBeInstanceOf(Date);

    await updateVendorUser(database.db, vendorUserId, { status: "suspended" });
    await markVendorLogin(database.db, vendorUserId);
    expect((await getVendorUserById(database.db, vendorUserId))?.status).toBe("suspended");
  });

  it("activateAfterPasswordReset не реактивирует suspended", async () => {
    await updateVendorUser(database.db, vendorUserId, { status: "suspended" });

    const user = await activateAfterPasswordReset(database.db, vendorUserId);

    expect(user.status).toBe("suspended");
    expect(user.emailVerified).toBe(true);
  });

  it("activateAfterPasswordReset переводит invited в active", async () => {
    const user = await activateAfterPasswordReset(database.db, vendorUserId);

    expect(user.status).toBe("active");
    expect(user.emailVerified).toBe(true);
  });

  it("updateVendorUser меняет только роль и статус", async () => {
    const before = await getVendorUserById(database.db, vendorUserId);

    const updated = await updateVendorUser(database.db, vendorUserId, {
      role: "finance",
      status: "active",
    });

    expect(updated).toMatchObject({ role: "finance", status: "active", email: before?.email });
  });

  it("getVendorUserByEmail ищет без учёта регистра", async () => {
    expect((await getVendorUserByEmail(database.db, vendorEmail.toUpperCase()))?.id).toBe(
      vendorUserId,
    );
  });

  it("getVendorUserByEmail возвращает null для неизвестного адреса", async () => {
    expect(await getVendorUserByEmail(database.db, "missing@example.com")).toBeNull();
  });

  it("listVendorUsers возвращает пользователей", async () => {
    const users = await listVendorUsers(database.db);
    expect(users.map((user) => user.id)).toContain(vendorUserId);
  });
});

describe("vendor auth: сессии и MFA", () => {
  it("resetVendorMfa удаляет TOTP, passkeys и сессии и пишет аудит", async () => {
    await database.pool.query(
      `insert into vendor_auth_two_factors (id, secret, backup_codes, user_id)
       values ($1, $2, $3, $4)`,
      [randomUUID(), "synthetic-secret", "synthetic-backup-codes", vendorUserId],
    );
    await database.pool.query(
      `insert into vendor_auth_passkeys (id, public_key, user_id, credential_id, device_type)
       values ($1, $2, $3, $4, 'singleDevice')`,
      [randomUUID(), "synthetic-public-key", vendorUserId, randomUUID()],
    );
    await database.pool.query(
      `insert into vendor_auth_sessions (id, token, user_id, expires_at)
       values ($1, $2, $3, '2026-12-01T00:00:00Z')`,
      [randomUUID(), `token-${randomUUID()}`, vendorUserId],
    );
    await database.pool.query("update vendor_users set mfa_enabled = true where id = $1", [
      vendorUserId,
    ]);

    const result = await resetVendorMfa(database.db, vendorUserId, {
      actorId: vendorUserId,
      ip: "127.0.0.1",
    });

    expect(result).toEqual({ twoFactors: 1, passkeys: 1, sessions: 1 });
    expect((await getVendorUserById(database.db, vendorUserId))?.twoFactorEnabled).toBe(false);
    expect(await verifyVendorChain(database.pool)).toBe(true);

    const { rows } = await database.pool.query<{
      actor_id: string;
      action: string;
      entity: string;
      ip: string;
    }>(
      `select actor_id, action, entity, ip
         from vendor_audit_events
        where action = 'vendor.user.mfa_reset'
        order by chain_seq desc
        limit 1`,
    );
    expect(rows[0]).toMatchObject({
      actor_id: vendorUserId,
      action: "vendor.user.mfa_reset",
      entity: "vendor_user",
      ip: "127.0.0.1",
    });
  });

  it("revokeVendorSessions удаляет только сессии пользователя", async () => {
    for (const token of ["first", "second"]) {
      await database.pool.query(
        `insert into vendor_auth_sessions (id, token, user_id, expires_at)
         values ($1, $2, $3, '2026-12-01T00:00:00Z')`,
        [randomUUID(), `token-${token}-${randomUUID()}`, vendorUserId],
      );
    }

    expect(await revokeVendorSessions(database.db, vendorUserId)).toBe(2);
    expect(await revokeVendorSessions(database.db, vendorUserId)).toBe(0);
  });

  it("resetVendorMfa не падает без MFA-строк и возвращает нули", async () => {
    const result = await resetVendorMfa(database.db, vendorUserId, { actorId: vendorUserId });

    expect(result).toEqual({ twoFactors: 0, passkeys: 0, sessions: 0 });
  });
});
