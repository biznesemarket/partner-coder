import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  type Database,
  type VendorRole,
  type VendorUserStatus,
} from "@partner-coder/db";

import {
  createPoolForUrl,
  createTestDatabase,
  type TestDatabase,
} from "../../../../packages/db/test/helpers.js";
import { MemoryMailer } from "../auth/mailer.js";
import { ApiError } from "../errors.js";
import { registerVendorFinanceRoutes } from "../routes/vendor-finance.js";
import { registerVendorRoutes } from "../routes/vendor.js";
import { createVendorAuth, type VendorAuth } from "./config.js";
import type { VendorAuthRuntime, VendorIdentity } from "./runtime.js";

const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";
const password = "correct horse battery staple";

let database: TestDatabase;
let dataPool: ReturnType<typeof createPoolForUrl>;
let authPool: ReturnType<typeof createPoolForUrl>;
let dataDb: Database;
let authDb: Database;
let dataRole: string;
let authRole: string;
let mailer: MemoryMailer;
let auth: VendorAuth;
let currentSession: unknown = null;

const openApps: FastifyInstance[] = [];

function roleUrl(base: string, role: string, rolePassword: string): string {
  const url = new URL(base);
  url.username = role;
  url.password = rolePassword;
  return url.toString();
}

beforeAll(async () => {
  database = await createTestDatabase();
  const unique = randomBytes(6).toString("hex");
  dataRole = `test_vendor_data_${unique}`;
  authRole = `test_vendor_auth_${unique}`;
  const dataPassword = randomBytes(16).toString("hex");
  const authPassword = randomBytes(16).toString("hex");
  await database.pool.query(
    `create role "${dataRole}" login password '${dataPassword}' in role partner_coder_vendor`,
  );
  await database.pool.query(
    `create role "${authRole}" login password '${authPassword}' in role partner_coder_vendor_auth`,
  );
  dataPool = createPoolForUrl(roleUrl(database.url, dataRole, dataPassword));
  authPool = createPoolForUrl(roleUrl(database.url, authRole, authPassword));
  dataDb = createDatabase(dataPool);
  authDb = createDatabase(authPool);
  mailer = new MemoryMailer();
  auth = createVendorAuth({
    db: database.db,
    secret: "vendor-routes-test-secret-vendor-routes-test-secret",
    baseURL: apiBaseUrl,
    vendorBaseURL: vendorBaseUrl,
    sessionTtlHours: 8,
    passwordResetTtlMinutes: 30,
    passwordMinLength: 12,
    webauthnRpId: "localhost",
    mailer,
    rateLimitEnabled: false,
    getVendorStatus: async (vendorUserId) => {
      const row = await database.pool.query<{ status: VendorUserStatus }>(
        "select status from vendor_users where id = $1",
        [vendorUserId],
      );
      return row.rows[0]?.status ?? null;
    },
    getVendorStatusByEmail: async (email) => {
      const row = await database.pool.query<{ status: VendorUserStatus }>(
        "select status from vendor_users where email = $1",
        [email.trim().toLowerCase()],
      );
      return row.rows[0]?.status ?? null;
    },
    onSessionCreated: async (vendorUserId) => {
      await database.pool.query(
        `update vendor_users
            set last_login_at = now(),
                status = case when status = 'invited' then 'active'::vendor_user_status else status end
          where id = $1`,
        [vendorUserId],
      );
    },
    onPasswordReset: async (vendorUserId) => {
      await database.pool.query(`update vendor_users set email_verified = true where id = $1`, [
        vendorUserId,
      ]);
    },
  });
  (auth.api as unknown as { getSession: () => Promise<unknown> }).getSession = async () =>
    currentSession;
}, 120_000);

afterAll(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await dataPool?.end().catch(() => undefined);
  await authPool?.end().catch(() => undefined);
  if (database) {
    try {
      for (const role of [dataRole, authRole]) {
        await database.pool.query(`drop role if exists "${role}"`);
      }
    } finally {
      await database.drop();
    }
  }
}, 60_000);

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  currentSession = null;
});

function runtime(): VendorAuthRuntime {
  return {
    auth,
    db: dataDb,
    authDb,
    vendorBaseUrl,
    stepUpMinutes: 5,
  };
}

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    return reply.status(500).send({
      error: { code: "internal_error", message: "Внутренняя ошибка", requestId: request.id },
    });
  });
  registerVendorRoutes(app, runtime());
  registerVendorFinanceRoutes(app, runtime());
  openApps.push(app);
  return app;
}

function identity(
  overrides: Partial<VendorIdentity> & Pick<VendorIdentity, "userId">,
): VendorIdentity {
  return {
    email: "admin@example.com",
    name: "Админ",
    role: "superadmin",
    status: "active",
    twoFactorEnabled: true,
    sessionId: "11111111-1111-4111-8111-111111111111",
    sessionExpiresAt: new Date("2026-11-16T20:00:00Z"),
    stepUpUntil: null,
    ...overrides,
  };
}

function setSession(value: VendorIdentity): void {
  currentSession = {
    user: {
      id: value.userId,
      email: value.email,
      name: value.name,
      role: value.role,
      status: value.status,
      twoFactorEnabled: value.twoFactorEnabled,
    },
    session: {
      id: value.sessionId,
      expiresAt: value.sessionExpiresAt,
      stepUpUntil: value.stepUpUntil,
    },
  };
}

interface SeededUser {
  readonly id: string;
  readonly email: string;
}

async function seedUser(
  input: {
    readonly role?: VendorRole;
    readonly status?: VendorUserStatus;
    readonly twoFactorEnabled?: boolean;
    readonly email?: string;
    readonly name?: string;
  } = {},
): Promise<SeededUser> {
  const id = randomUUID();
  const email = input.email ?? `vendor-${id}@example.com`;
  await database.pool.query(
    `insert into vendor_users (id, email, name, role, status, mfa_enabled)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      email,
      input.name ?? "Вендор",
      input.role ?? "support",
      input.status ?? "active",
      input.twoFactorEnabled ?? false,
    ],
  );
  return { id, email };
}

async function seedSession(vendorUserId: string): Promise<string> {
  const result = await database.pool.query<{ id: string }>(
    `insert into vendor_auth_sessions (token, user_id, expires_at)
     values ($1, $2, now() + interval '1 hour')
     returning id`,
    [`session-${randomUUID()}`, vendorUserId],
  );
  return result.rows[0]!.id;
}

async function countSessions(vendorUserId: string): Promise<number> {
  const result = await database.pool.query<{ count: string }>(
    "select count(*)::text as count from vendor_auth_sessions where user_id = $1",
    [vendorUserId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function latestAudit(action: string): Promise<Record<string, unknown> | undefined> {
  const result = await database.pool.query<{
    actor_id: string | null;
    action: string;
    entity: string;
    after: Record<string, unknown> | null;
  }>(
    `select actor_id, action, entity, after
       from vendor_audit_events
      where action = $1
      order by created_at desc
      limit 1`,
    [action],
  );
  return result.rows[0];
}

async function countAudit(action: string): Promise<number> {
  const result = await database.pool.query<{ count: string }>(
    "select count(*)::text as count from vendor_audit_events where action = $1",
    [action],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function signInAndCookie(
  email: string,
  vendorUserId: string,
): Promise<{ cookie: string; sessionId: string }> {
  const response = await auth.handler(
    new Request(`${apiBaseUrl}/api/vendor-auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: vendorBaseUrl },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter((value): value is string => Boolean(value))
    .join("; ");
  const session = await database.pool.query<{ id: string }>(
    `select id
       from vendor_auth_sessions
      where user_id = $1
      order by created_at desc
      limit 1`,
    [vendorUserId],
  );
  return { cookie, sessionId: session.rows[0]!.id };
}

describe("vendor auth routes", () => {
  it("держит vendor-данные и vendor-auth в разных ролях", async () => {
    await expect(dataPool.query("select count(*) from vendor_auth_sessions")).rejects.toMatchObject(
      { code: "42501" },
    );
    await expect(authPool.query("select count(*) from customers")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("GET /v1/vendor/auth/me возвращает mfaEnrollmentRequired", async () => {
    const user = await seedUser({ role: "superadmin", twoFactorEnabled: false });
    const sessionId = await seedSession(user.id);
    setSession(
      identity({ userId: user.id, email: user.email, twoFactorEnabled: false, sessionId }),
    );

    const response = await buildApp().inject({ method: "GET", url: "/v1/vendor/auth/me" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: {
        id: user.id,
        email: user.email,
        role: "superadmin",
        status: "active",
        twoFactorEnabled: false,
      },
      mfaEnrollmentRequired: true,
      sessionExpiresAt: "2026-11-16T20:00:00.000Z",
      stepUpUntil: null,
    });
  });

  it("закрывает vendor data routes без TOTP", async () => {
    const user = await seedUser({ role: "superadmin", twoFactorEnabled: false });
    setSession(identity({ userId: user.id, email: user.email, twoFactorEnabled: false }));

    const response = await buildApp().inject({ method: "GET", url: "/v1/vendor/users" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "vendor_mfa_required" } });
  });

  it("создаёт пользователя, отправляет ссылку и идемпотентен для invited", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const email = `new-${randomUUID()}@Example.com`;
    const normalized = email.toLowerCase();
    const payload = { email, name: "Новый вендор", role: "finance" };

    mailer.vendorPasswordResets.length = 0;
    const created = await app.inject({ method: "POST", url: "/v1/vendor/users", payload });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      user: {
        email: normalized,
        name: "Новый вендор",
        role: "finance",
        status: "invited",
        twoFactorEnabled: false,
      },
    });
    expect(mailer.vendorPasswordResets).toHaveLength(1);
    expect(mailer.vendorPasswordResets[0]?.email).toBe(normalized);
    expect(await latestAudit("vendor.user.invited")).toMatchObject({
      actor_id: admin.id,
      entity: "vendor_user",
      after: { role: "finance", status: "invited" },
    });

    const repeated = await app.inject({ method: "POST", url: "/v1/vendor/users", payload });

    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({
      user: { id: created.json<{ user: { id: string } }>().user.id },
    });
    expect(mailer.vendorPasswordResets).toHaveLength(2);
    const rows = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_users where lower(email) = $1",
      [normalized],
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("отклоняет повторное приглашение invited с другой ролью", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const email = `role-${randomUUID()}@example.com`;

    const created = await app.inject({
      method: "POST",
      url: "/v1/vendor/users",
      payload: { email, name: "Роль", role: "finance" },
    });
    expect(created.statusCode).toBe(201);

    const mismatched = await app.inject({
      method: "POST",
      url: "/v1/vendor/users",
      payload: { email, name: "Роль", role: "support" },
    });
    expect(mismatched.statusCode).toBe(409);
    expect(mismatched.json()).toMatchObject({ error: { code: "vendor_user_exists" } });
    expect(mismatched.json().error.message).toMatch(/finance.*PATCH \/v1\/vendor\/users\/:id/);

    mailer.vendorPasswordResets.length = 0;
    const matched = await app.inject({
      method: "POST",
      url: "/v1/vendor/users",
      payload: { email, name: "Роль", role: "finance" },
    });
    expect(matched.statusCode).toBe(200);
    expect(mailer.vendorPasswordResets).toHaveLength(1);
  });

  it("не даёт создать второго superadmin без confirmSuperadmin", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const email = `super-${randomUUID()}@example.com`;

    const denied = await app.inject({
      method: "POST",
      url: "/v1/vendor/users",
      payload: { email, name: "Super", role: "superadmin" },
    });

    expect(denied.statusCode).toBe(400);
    expect(denied.json()).toMatchObject({ error: { code: "superadmin_confirmation_required" } });

    const target = await seedUser({ role: "support" });
    const invitedDenied = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/users/${target.id}`,
      payload: { status: "invited" },
    });
    expect(invitedDenied.statusCode).toBe(400);
    expect(invitedDenied.json()).toMatchObject({ error: { code: "validation_error" } });

    const promotedDenied = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/users/${target.id}`,
      payload: { role: "superadmin" },
    });
    expect(promotedDenied.statusCode).toBe(400);

    const promoted = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/users/${target.id}`,
      payload: { role: "superadmin", confirmSuperadmin: true },
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toMatchObject({ user: { role: "superadmin" } });
    expect(await latestAudit("vendor.user.role_changed")).toMatchObject({
      actor_id: admin.id,
      after: { role: "superadmin", userId: target.id },
    });
  });

  it("PATCH suspended отзывает сессии и не даёт менять себя", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    const other = await seedUser({ role: "support", status: "active" });
    await seedSession(other.id);
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();

    const self = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/users/${admin.id}`,
      payload: { status: "suspended" },
    });
    expect(self.statusCode).toBe(409);
    expect(self.json()).toMatchObject({ error: { code: "vendor_self_change_denied" } });

    const suspended = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/users/${other.id}`,
      payload: { status: "suspended" },
    });

    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toMatchObject({ user: { id: other.id, status: "suspended" } });
    expect(await countSessions(other.id)).toBe(0);
    expect(await latestAudit("vendor.user.suspended")).toMatchObject({
      actor_id: admin.id,
      after: { userId: other.id, status: "suspended" },
    });
    expect(await latestAudit("vendor.session.revoked")).toMatchObject({
      actor_id: admin.id,
      after: { userId: other.id, count: 1, reason: "suspended" },
    });
  });

  it("не даёт снять последнего активного суперадминистратора", async () => {
    const actor = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    const target = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: actor.id, email: actor.email }));
    const app = buildApp();

    await database.pool.query(
      "update vendor_users set status = 'disabled' where role = 'superadmin' and status = 'active' and id <> $1",
      [target.id],
    );
    await database.pool.query("update vendor_users set role = 'finance' where id = $1", [actor.id]);
    const auditBefore = await countAudit("vendor.user.role_changed");

    const denied = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/users/${target.id}`,
      payload: { role: "finance" },
    });

    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toMatchObject({ error: { code: "vendor_last_superadmin" } });
    const targetRow = await database.pool.query<{ role: string }>(
      "select role from vendor_users where id = $1",
      [target.id],
    );
    expect(targetRow.rows[0]?.role).toBe("superadmin");
    expect(await countAudit("vendor.user.role_changed")).toBe(auditBefore);
  });
  it("reset-mfa удаляет TOTP/passkeys и аудирует", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    const target = await seedUser({ role: "support", twoFactorEnabled: true });
    await database.pool.query(
      `insert into vendor_auth_two_factors (id, secret, backup_codes, user_id)
       values ($1, 'secret', 'codes', $2)`,
      [`totp-${randomUUID()}`, target.id],
    );
    await database.pool.query(
      `insert into vendor_auth_passkeys (id, public_key, user_id, credential_id, device_type)
       values ($1, 'public-key', $2, $3, 'singleDevice')`,
      [`passkey-${randomUUID()}`, target.id, `credential-${randomUUID()}`],
    );
    await seedSession(target.id);
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: `/v1/vendor/users/${target.id}/reset-mfa`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ twoFactors: 1, passkeys: 1, sessions: 1 });
    const factors = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_auth_two_factors where user_id = $1",
      [target.id],
    );
    const passkeys = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_auth_passkeys where user_id = $1",
      [target.id],
    );
    expect(factors.rows[0]?.count).toBe("0");
    expect(passkeys.rows[0]?.count).toBe("0");
    expect((await latestAudit("vendor.user.mfa_reset"))?.after).toMatchObject({
      userId: target.id,
    });
    expect(await latestAudit("vendor.session.revoked")).toMatchObject({
      actor_id: admin.id,
      after: { userId: target.id, count: 1, reason: "mfa_reset" },
    });

    const auditBefore = await countAudit("vendor.user.mfa_reset");
    const missing = await app.inject({
      method: "POST",
      url: `/v1/vendor/users/${randomUUID()}/reset-mfa`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "vendor_user_not_found" } });
    expect(await countAudit("vendor.user.mfa_reset")).toBe(auditBefore);
  });

  it("reset-password не отправляет ссылку неактивному пользователю", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    const suspended = await seedUser({ role: "support", status: "suspended" });
    const active = await seedUser({ role: "support", status: "active" });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();

    mailer.vendorPasswordResets.length = 0;
    const denied = await app.inject({
      method: "POST",
      url: `/v1/vendor/users/${suspended.id}/reset-password`,
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toMatchObject({ error: { code: "vendor_user_inactive" } });
    expect(mailer.vendorPasswordResets).toHaveLength(0);

    const sent = await app.inject({
      method: "POST",
      url: `/v1/vendor/users/${active.id}/reset-password`,
    });
    expect(sent.statusCode).toBe(200);
    expect(mailer.vendorPasswordResets).toHaveLength(1);
    expect(await latestAudit("vendor.user.password_reset_requested")).toMatchObject({
      actor_id: admin.id,
      after: { userId: active.id },
    });

    const missing = await app.inject({
      method: "POST",
      url: `/v1/vendor/users/${randomUUID()}/reset-password`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("step-up проверяет пароль и выставляет stepUpUntil", async () => {
    const email = `stepup-${randomUUID()}@example.com`;
    const signedUp = await auth.api.signUpEmail({
      body: { email, name: "Step Up", password },
    });
    const { cookie, sessionId } = await signInAndCookie(email, signedUp.user.id);
    setSession(
      identity({
        userId: signedUp.user.id,
        email,
        twoFactorEnabled: true,
        sessionId,
      }),
    );
    const app = buildApp();

    const success = await app.inject({
      method: "POST",
      url: "/v1/vendor/auth/step-up",
      headers: { cookie },
      payload: { password },
    });

    expect(success.statusCode).toBe(200);
    const body = success.json<{ stepUpUntil: string }>();
    expect(new Date(body.stepUpUntil).getTime()).toBeGreaterThan(Date.now());
    const session = await database.pool.query<{ step_up_until: Date | null }>(
      "select step_up_until from vendor_auth_sessions where id = $1",
      [sessionId],
    );
    expect(session.rows[0]?.step_up_until).not.toBeNull();
    expect(await latestAudit("vendor.auth.step_up_succeeded")).toMatchObject({
      actor_id: signedUp.user.id,
    });

    const failed = await app.inject({
      method: "POST",
      url: "/v1/vendor/auth/step-up",
      headers: { cookie },
      payload: { password: "wrong password value" },
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json()).toMatchObject({ error: { code: "invalid_password" } });
    expect(await latestAudit("vendor.auth.step_up_failed")).toMatchObject({
      actor_id: signedUp.user.id,
    });
  });

  it("step-up не маскирует внутренние ошибки под invalid_password", async () => {
    const user = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    const sessionId = await seedSession(user.id);
    setSession(identity({ userId: user.id, email: user.email, sessionId }));
    const app = buildApp();
    const auditBefore = await countAudit("vendor.auth.step_up_failed");
    const api = auth.api as unknown as {
      verifyPassword: (input: unknown) => Promise<unknown>;
    };
    const original = api.verifyPassword.bind(auth.api);
    api.verifyPassword = async () => {
      throw new Error("database unavailable");
    };
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/vendor/auth/step-up",
        payload: { password },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: { code: "internal_error" } });
      expect(await countAudit("vendor.auth.step_up_failed")).toBe(auditBefore);
    } finally {
      api.verifyPassword = original;
    }
  });

  it("step-up ограничивает попытки пятью за пять минут", async () => {
    const email = `stepup-limit-${randomBytes(8).toString("hex")}@example.com`;
    const signedUp = await auth.api.signUpEmail({
      body: { email, name: "Limit", password },
    });
    const { cookie, sessionId } = await signInAndCookie(email, signedUp.user.id);
    setSession(
      identity({
        userId: signedUp.user.id,
        email,
        twoFactorEnabled: true,
        sessionId,
      }),
    );
    const app = buildApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/vendor/auth/step-up",
        headers: { cookie },
        payload: { password: "wrong password value" },
      });
      expect(response.statusCode).toBe(400);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/vendor/auth/step-up",
      headers: { cookie },
      payload: { password: "wrong password value" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "email_rate_limited" } });
  });
});

describe("vendor finance routes", () => {
  it("superadmin создаёт клиента и аудирует", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const legalName = `Клиент ${randomUUID()}`;

    const created = await app.inject({
      method: "POST",
      url: "/v1/vendor/customers",
      payload: { legalName, status: "lead" },
    });

    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.customer).toMatchObject({ legalName, status: "lead" });
    expect(body.customer.id).toBeTypeOf("string");
    expect(await latestAudit("vendor.customer.created")).toMatchObject({
      actor_id: admin.id,
      after: { customerId: body.customer.id, status: "lead" },
    });
  });

  it("support читает клиентов, finance не создаёт", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const legalName = `Клиент ${randomUUID()}`;
    const created = await app.inject({
      method: "POST",
      url: "/v1/vendor/customers",
      payload: { legalName },
    });
    expect(created.statusCode).toBe(201);

    const support = await seedUser({ role: "support", twoFactorEnabled: true });
    setSession(identity({ userId: support.id, email: support.email, role: "support" }));
    const list = await app.inject({ method: "GET", url: "/v1/vendor/customers" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.json().customer.id })]),
    );

    const finance = await seedUser({ role: "finance", twoFactorEnabled: true });
    setSession(identity({ userId: finance.id, email: finance.email, role: "finance" }));
    const denied = await app.inject({
      method: "POST",
      url: "/v1/vendor/customers",
      payload: { legalName: `Запрет ${randomUUID()}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "vendor_role_denied" } });
  });

  it("superadmin создаёт и обновляет тариф", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const code = `plan-${randomUUID().slice(0, 8)}`;

    const created = await app.inject({
      method: "POST",
      url: "/v1/vendor/plans",
      payload: {
        code,
        name: "Базовый",
        priceKopecks: "1500000",
        seatsLimit: 5,
        projectsLimit: 3,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().plan).toMatchObject({
      code,
      priceKopecks: "1500000",
      seatsLimit: 5,
      projectsLimit: 3,
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/plans/${created.json().plan.id}`,
      payload: { priceKopecks: "1600000" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().plan.priceKopecks).toBe("1600000");
    expect(await latestAudit("vendor.plan.updated")).toMatchObject({ actor_id: admin.id });
  });

  it("не даёт создать тариф с занятым кодом", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const code = `plan-${randomUUID().slice(0, 8)}`;
    const payload = {
      code,
      name: "Пилот",
      priceKopecks: "1000000",
      seatsLimit: 3,
      projectsLimit: 1,
    };

    expect(
      (await app.inject({ method: "POST", url: "/v1/vendor/plans", payload })).statusCode,
    ).toBe(201);
    const duplicate = await app.inject({ method: "POST", url: "/v1/vendor/plans", payload });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "vendor_plan_code_exists" } });
  });

  it("superadmin обновляет клиента и не даёт продублировать ИНН", async () => {
    const admin = await seedUser({ role: "superadmin", twoFactorEnabled: true });
    setSession(identity({ userId: admin.id, email: admin.email }));
    const app = buildApp();
    const inn = randomUUID().replace(/\D/g, "").slice(0, 10).padEnd(10, "0");
    const legalName = `Клиент ${randomUUID()}`;

    const created = await app.inject({
      method: "POST",
      url: "/v1/vendor/customers",
      payload: { legalName, inn },
    });
    expect(created.statusCode).toBe(201);

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/vendor/customers/${created.json().customer.id}`,
      payload: { status: "active" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().customer.status).toBe("active");
    expect(await latestAudit("vendor.customer.updated")).toMatchObject({
      actor_id: admin.id,
      after: { customerId: created.json().customer.id, status: "active" },
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/vendor/customers",
      payload: { legalName: `Другой ${randomUUID()}`, inn },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "vendor_customer_inn_exists" } });
  });
});
