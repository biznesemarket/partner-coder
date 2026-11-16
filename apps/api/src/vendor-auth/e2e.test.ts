import { createHmac, randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activateAfterPasswordReset,
  getVendorUserByEmail,
  getVendorUserById,
  markVendorLogin,
  writeVendorAudit,
} from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { MemoryMailer } from "../auth/mailer.js";
import { provisionVendorAdmin } from "../cli/provision-vendor-admin.js";
import { buildServer } from "../server.js";
import { createVendorAuth, type VendorAuth } from "./config.js";
import type { VendorAuthRuntime } from "./runtime.js";

const host = "localhost:4000";
const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = `http://${host}`;
const authSecret = "vendor-e2e-secret-vendor-e2e-secret-1234";
const adminPassword = "correct horse battery staple";
const financePassword = "finance horse battery staple";

let database: TestDatabase;
let server: FastifyInstance;
let mailer: MemoryMailer;
let auth: VendorAuth;
let runtime: VendorAuthRuntime;

interface InjectResponse {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  json<T = Record<string, unknown>>(): T;
  body: string;
}

function extractCookies(response: InjectResponse): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : header ? [String(header)] : [];
  return values
    .map((value) => String(value).split(";")[0])
    .filter((value): value is string => Boolean(value))
    .join("; ");
}

async function post(
  url: string,
  payload: Record<string, unknown>,
  cookie?: string,
): Promise<InjectResponse> {
  return server.inject({
    method: "POST",
    url,
    headers: {
      host,
      origin: vendorBaseUrl,
      ...(cookie ? { cookie } : {}),
    },
    payload,
  }) as unknown as InjectResponse;
}

async function get(url: string, cookie?: string): Promise<InjectResponse> {
  return server.inject({
    method: "GET",
    url,
    headers: {
      host,
      ...(cookie ? { cookie } : {}),
    },
  }) as unknown as InjectResponse;
}

function resetTokenFor(email: string): string {
  const message = mailer.vendorPasswordResets.filter((item) => item.email === email).at(-1);
  expect(message).toBeDefined();
  const token = new URL(message!.url).searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const normalized = input.replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of normalized) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) {
      throw new Error("invalid base32 secret");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 1_000_000).toString().padStart(6, "0");
}

async function signIn(email: string, password: string): Promise<InjectResponse> {
  return post("/api/vendor-auth/sign-in/email", { email, password });
}

async function enableTotp(cookie: string, password: string): Promise<string> {
  const enabled = await post("/api/vendor-auth/two-factor/enable", { password }, cookie);
  expect(enabled.statusCode).toBe(200);
  const body = enabled.json<{ totpURI: string; backupCodes: string[] }>();
  expect(body.backupCodes).toHaveLength(10);
  const secret = new URL(body.totpURI).searchParams.get("secret");
  expect(secret).toBeTruthy();
  return secret!;
}

/** Завершает включение TOTP: вход по паролю, затем verify-totp этим же токеном. */
async function completeTotpSetup(email: string, password: string, secret: string): Promise<string> {
  const signInResponse = await signIn(email, password);
  expect(signInResponse.statusCode).toBe(200);
  expect(signInResponse.json().twoFactorRedirect).toBeUndefined();

  const verified = await post(
    "/api/vendor-auth/two-factor/verify-totp",
    { code: totpCode(secret) },
    extractCookies(signInResponse),
  );
  expect(verified.statusCode).toBe(200);
  const cookie = extractCookies(verified);
  expect(cookie).toContain("session_token");
  return cookie;
}

/** Вход уже настроенного TOTP-пользователя: twoFactorRedirect -> verify-totp. */
async function signInWithTotp(email: string, password: string, secret: string): Promise<string> {
  const signInResponse = await signIn(email, password);
  expect(signInResponse.statusCode).toBe(200);
  expect(signInResponse.json().twoFactorRedirect).toBe(true);

  const verified = await post(
    "/api/vendor-auth/two-factor/verify-totp",
    { code: totpCode(secret) },
    extractCookies(signInResponse),
  );
  expect(verified.statusCode).toBe(200);
  const cookie = extractCookies(verified);
  expect(cookie).toContain("session_token");
  return cookie;
}

async function auditCount(action: string): Promise<number> {
  const result = await database.pool.query<{ count: string }>(
    "select count(*)::text as count from vendor_audit_events where action = $1",
    [action],
  );
  return Number(result.rows[0]?.count ?? "0");
}

beforeAll(async () => {
  database = await createTestDatabase();
  mailer = new MemoryMailer();
  const db = database.db;

  auth = createVendorAuth({
    db,
    secret: authSecret,
    baseURL: apiBaseUrl,
    vendorBaseURL: vendorBaseUrl,
    sessionTtlHours: 8,
    passwordResetTtlMinutes: 30,
    passwordMinLength: 12,
    mailer,
    rateLimitEnabled: false,
    getVendorStatus: async (vendorUserId) =>
      (await getVendorUserById(db, vendorUserId))?.status ?? null,
    getVendorStatusByEmail: async (email) =>
      (await getVendorUserByEmail(db, email))?.status ?? null,
    onSessionCreated: async (vendorUserId) => {
      await markVendorLogin(db, vendorUserId);
    },
    onPasswordReset: async (vendorUserId) => {
      const user = await activateAfterPasswordReset(db, vendorUserId);
      await writeVendorAudit(db, {
        actorId: null,
        action: "vendor.auth.password_reset_completed",
        entity: "vendor_user",
        after: { userId: vendorUserId, status: user.status },
      });
    },
  });

  runtime = {
    auth,
    db,
    authDb: db,
    vendorBaseUrl,
    stepUpMinutes: 5,
  };

  server = buildServer({
    logger: false,
    apiBaseUrl,
    appEnv: "local",
    vendorRuntime: runtime,
  });
  await server.ready();
}, 120_000);

afterAll(async () => {
  await server?.close();
  await database?.drop();
}, 60_000);

describe("E2E: вендорская аутентификация на реальном Fastify и Better Auth", () => {
  it("проходит bootstrap, TOTP, роли, блокировку, сброс MFA и проверку аудита", async () => {
    const adminEmail = `ops-${randomUUID()}@example.com`;
    const financeEmail = `finance-${randomUUID()}@example.com`;

    // 1. Bootstrap первого суперадминистратора и ссылка установки пароля.
    const provisioned = await provisionVendorAdmin(
      { db: database.db, authDb: database.db, auth, mailer, vendorBaseUrl },
      { email: adminEmail, name: "Ops", force: false },
    );
    expect(provisioned.invited).toBe(true);
    expect(mailer.vendorPasswordResets.map((item) => item.email)).toContain(adminEmail);
    expect(
      await database.pool.query(
        "select 1 from vendor_users where email = $1 and status = 'invited'",
        [adminEmail],
      ),
    ).toMatchObject({ rowCount: 1 });

    // 2. Установка пароля по токену из письма -> invited становится active.
    const reset = await post("/api/vendor-auth/reset-password", {
      token: resetTokenFor(adminEmail),
      newPassword: adminPassword,
    });
    expect(reset.statusCode).toBe(200);
    expect((await getVendorUserById(database.db, provisioned.userId))?.status).toBe("active");

    // 3. Вход по паролю, включение TOTP и вход со вторым фактором.
    const firstSignIn = await signIn(adminEmail, adminPassword);
    expect(firstSignIn.statusCode).toBe(200);
    expect(firstSignIn.json().twoFactorRedirect).toBeUndefined();
    const adminCookie = extractCookies(firstSignIn);
    expect(adminCookie).toContain("session_token");

    const adminSecret = await enableTotp(adminCookie, adminPassword);
    await completeTotpSetup(adminEmail, adminPassword, adminSecret);
    const adminMfaCookie = await signInWithTotp(adminEmail, adminPassword, adminSecret);
    expect((await getVendorUserById(database.db, provisioned.userId))?.twoFactorEnabled).toBe(true);

    // 4. Реальная сессия Better Auth содержит роль, статус, MFA и stepUpUntil.
    const sessionPayload = await get("/api/vendor-auth/get-session", adminMfaCookie);
    expect(sessionPayload.statusCode).toBe(200);
    expect(sessionPayload.json()).toMatchObject({
      user: {
        id: provisioned.userId,
        email: adminEmail,
        role: "superadmin",
        status: "active",
        twoFactorEnabled: true,
      },
    });
    expect(
      sessionPayload.json<{ session: { stepUpUntil?: string | null } }>().session.stepUpUntil ??
        null,
    ).toBeNull();

    const adminMe = await get("/v1/vendor/auth/me", adminMfaCookie);
    expect(adminMe.statusCode).toBe(200);
    expect(adminMe.json()).toMatchObject({
      user: {
        id: provisioned.userId,
        role: "superadmin",
        status: "active",
        twoFactorEnabled: true,
      },
      mfaEnrollmentRequired: false,
      stepUpUntil: null,
    });

    // 5. Step-up обновляет stepUpUntil в реальной сессии.
    const stepUp = await post(
      "/v1/vendor/auth/step-up",
      { password: adminPassword },
      adminMfaCookie,
    );
    expect(stepUp.statusCode).toBe(200);
    expect(stepUp.json<{ stepUpUntil: string }>().stepUpUntil).toBeTruthy();
    const meAfterStepUp = await get("/v1/vendor/auth/me", adminMfaCookie);
    expect(meAfterStepUp.statusCode).toBe(200);
    expect(meAfterStepUp.json<{ stepUpUntil: string | null }>().stepUpUntil).toBeTruthy();
    const rawAfterStepUp = await get("/api/vendor-auth/get-session", adminMfaCookie);
    expect(
      rawAfterStepUp.json<{ session: { stepUpUntil?: string | null } }>().session.stepUpUntil ??
        null,
    ).toBeTruthy();

    // 6. Создание finance-пользователя -> письмо -> установка пароля -> вход.
    const created = await post(
      "/v1/vendor/users",
      {
        email: financeEmail,
        name: "Finance",
        role: "finance",
      },
      adminMfaCookie,
    );
    expect(created.statusCode).toBe(201);
    const finance = created.json<{ user: { id: string; role: string; status: string } }>().user;
    expect(finance).toMatchObject({ role: "finance", status: "invited" });

    const financeReset = await post("/api/vendor-auth/reset-password", {
      token: resetTokenFor(financeEmail),
      newPassword: financePassword,
    });
    expect(financeReset.statusCode).toBe(200);

    const financeFirstSignIn = await signIn(financeEmail, financePassword);
    expect(financeFirstSignIn.statusCode).toBe(200);
    const financeCookie = extractCookies(financeFirstSignIn);
    expect(financeCookie).toContain("session_token");

    // 7. Без TOTP данные закрыты.
    const deniedWithoutMfa = await post(
      "/v1/vendor/users",
      { email: `blocked-${randomUUID()}@example.com`, name: "Blocked", role: "support" },
      financeCookie,
    );
    expect(deniedWithoutMfa.statusCode).toBe(403);
    expect(deniedWithoutMfa.json()).toMatchObject({ error: { code: "vendor_mfa_required" } });

    // 8. Включение TOTP снимает MFA-ограничение, но роль finance не пускает в users.
    const financeSecret = await enableTotp(financeCookie, financePassword);
    const financeMfaCookie = await completeTotpSetup(financeEmail, financePassword, financeSecret);
    const financeMe = await get("/v1/vendor/auth/me", financeMfaCookie);
    expect(financeMe.statusCode).toBe(200);
    expect(financeMe.json()).toMatchObject({
      user: { role: "finance", status: "active", twoFactorEnabled: true },
      mfaEnrollmentRequired: false,
    });

    const deniedByRole = await post(
      "/v1/vendor/users",
      { email: `blocked-${randomUUID()}@example.com`, name: "Blocked", role: "support" },
      financeMfaCookie,
    );
    expect(deniedByRole.statusCode).toBe(403);
    expect(deniedByRole.json()).toMatchObject({ error: { code: "vendor_role_denied" } });

    // 9. Приостановка отзывает сессии; вход возвращает VENDOR_INACTIVE.
    const suspended = await server.inject({
      method: "PATCH",
      url: `/v1/vendor/users/${finance.id}`,
      headers: { host, origin: vendorBaseUrl, cookie: adminMfaCookie },
      payload: { status: "suspended" },
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toMatchObject({ user: { id: finance.id, status: "suspended" } });

    const revokedMe = await get("/v1/vendor/auth/me", financeMfaCookie);
    expect(revokedMe.statusCode).toBe(401);
    expect(revokedMe.json()).toMatchObject({ error: { code: "vendor_unauthenticated" } });

    const blockedSignIn = await signIn(financeEmail, financePassword);
    expect(blockedSignIn.statusCode).toBe(403);
    expect(blockedSignIn.json()).toMatchObject({ code: "VENDOR_INACTIVE" });

    // 10. Сброс пароля для suspended запрещён, сброс MFA удаляет TOTP/passkeys.
    const resetSuspended = await post(
      `/v1/vendor/users/${finance.id}/reset-password`,
      {},
      adminMfaCookie,
    );
    expect(resetSuspended.statusCode).toBe(409);
    expect(resetSuspended.json()).toMatchObject({ error: { code: "vendor_user_inactive" } });

    const resetMfa = await post(`/v1/vendor/users/${finance.id}/reset-mfa`, {}, adminMfaCookie);
    expect(resetMfa.statusCode).toBe(200);
    expect(resetMfa.json()).toMatchObject({ twoFactors: 1, passkeys: 0, sessions: 0 });

    const mfaRows = await database.pool.query(
      "select 1 from vendor_auth_two_factors where user_id = $1",
      [finance.id],
    );
    expect(mfaRows.rowCount).toBe(0);
    const passkeyRows = await database.pool.query(
      "select 1 from vendor_auth_passkeys where user_id = $1",
      [finance.id],
    );
    expect(passkeyRows.rowCount).toBe(0);
    expect((await getVendorUserById(database.db, finance.id))?.twoFactorEnabled).toBe(false);

    // 11. Аудит: нужные действия записаны, хеш-цепочка цела.
    expect(await auditCount("vendor.user.bootstrap_admin")).toBe(1);
    expect(await auditCount("vendor.user.invited")).toBe(1);
    expect(await auditCount("vendor.auth.password_reset_completed")).toBe(2);
    expect(await auditCount("vendor.user.suspended")).toBe(1);
    expect(await auditCount("vendor.session.revoked")).toBe(2);
    expect(await auditCount("vendor.auth.role_denied")).toBe(1);
    expect(await auditCount("vendor.auth.step_up_succeeded")).toBe(1);

    const chain = await database.pool.query<{ ok: boolean }>(
      "select verify_vendor_audit_chain() as ok",
    );
    expect(chain.rows[0]?.ok).toBe(true);
  });
});
