import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Database, VendorRole, VendorUserStatus } from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { MemoryMailer } from "../auth/mailer.js";
import { ApiError } from "../errors.js";
import { registerVendorRoutes } from "../routes/vendor.js";
import { createVendorAuth, type VendorAuth } from "./config.js";
import type { VendorAuthRuntime, VendorIdentity } from "./runtime.js";

const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";
const password = "correct horse battery staple";

let database: TestDatabase;
let mailer: MemoryMailer;
let auth: VendorAuth;
let currentSession: unknown = null;

const openApps: FastifyInstance[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  mailer = new MemoryMailer();
  auth = createVendorAuth({
    db: database.db,
    secret: "vendor-routes-test-secret-vendor-routes-test-secret",
    baseURL: apiBaseUrl,
    vendorBaseURL: vendorBaseUrl,
    sessionTtlHours: 8,
    passwordResetTtlMinutes: 30,
    passwordMinLength: 12,
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
  await database?.drop();
}, 60_000);

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  currentSession = null;
});

function runtime(): VendorAuthRuntime {
  return {
    auth,
    db: database.db as unknown as Database,
    authDb: database.db as unknown as Database,
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
