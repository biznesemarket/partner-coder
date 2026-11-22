import { createHash, createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activateAfterPasswordReset,
  getVendorUserByEmail,
  getVendorUserById,
  markVendorLogin,
  updateVendorUser,
  writeVendorAudit,
  type VendorUserStatus,
} from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { MemoryMailer } from "../auth/mailer.js";
import { createVendorAuth } from "./config.js";

const authSecret = "vendor-test-secret-vendor-test-secret-1234";
const vendorBaseUrl = "http://localhost:3001";
const baseUrl = "http://localhost:4000";
const resetRedirect = `${vendorBaseUrl}/reset-password`;
const password = "correct horse battery staple";

let database: TestDatabase;
let mailer: MemoryMailer;

beforeAll(async () => {
  database = await createTestDatabase();
  mailer = new MemoryMailer();
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

function buildAuth(options: { onSessionCreated?: (vendorUserId: string) => Promise<void> } = {}) {
  return createVendorAuth({
    db: database.db,
    secret: authSecret,
    baseURL: baseUrl,
    vendorBaseURL: vendorBaseUrl,
    sessionTtlHours: 8,
    passwordResetTtlMinutes: 30,
    passwordMinLength: 12,
    webauthnRpId: "vendor.example.test",
    mailer,
    rateLimitEnabled: false,
    getVendorStatus: async (vendorUserId) =>
      (await getVendorUserById(database.db, vendorUserId))?.status ?? null,
    getVendorStatusByEmail: async (email) =>
      (await getVendorUserByEmail(database.db, email))?.status ?? null,
    onSessionCreated:
      options.onSessionCreated ??
      (async (vendorUserId) => {
        await markVendorLogin(database.db, vendorUserId);
      }),
    onPasswordReset: async (vendorUserId) => {
      await activateAfterPasswordReset(database.db, vendorUserId);
      await writeVendorAudit(database.db, {
        actorId: vendorUserId,
        action: "vendor.auth.password_reset_completed",
        entity: "vendor_user",
      });
    },
  });
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

async function countSessions(pool: TestDatabase["pool"], userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "select count(*)::text as count from vendor_auth_sessions where user_id = $1",
    [userId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function hasAudit(pool: TestDatabase["pool"], action: string): Promise<boolean> {
  const result = await pool.query("select 1 from vendor_audit_events where action = $1 limit 1", [
    action,
  ]);
  return result.rowCount === 1;
}

async function signUp(auth: ReturnType<typeof buildAuth>, email: string): Promise<string> {
  const result = await auth.api.signUpEmail({
    body: { email, name: "Ops", password },
  });
  return result.user.id;
}

async function signInThroughHandler(
  auth: ReturnType<typeof buildAuth>,
  email: string,
  signInPassword = password,
): Promise<{ body: Record<string, unknown>; cookie: string; status: number }> {
  const response = await auth.handler(
    new Request(`${baseUrl}/api/vendor-auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: vendorBaseUrl,
      },
      body: JSON.stringify({ email, password: signInPassword }),
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter((value): value is string => Boolean(value))
    .join("; ");
  return { body, cookie, status: response.status };
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

function totpSecretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) {
    throw new Error("TOTP URI has no secret");
  }
  return secret;
}

async function enableTotp(
  auth: ReturnType<typeof buildAuth>,
  email: string,
): Promise<{ secret: string; backupCodes: string[]; totpURI: string }> {
  const signIn = await signInThroughHandler(auth, email);
  expect(signIn.status).toBe(200);
  expect(signIn.body.twoFactorRedirect).toBeUndefined();

  const enabled = await auth.api.enableTwoFactor({
    body: { password },
    headers: { cookie: signIn.cookie },
  });
  if (enabled.method !== "totp") {
    throw new Error(`unexpected 2FA method: ${enabled.method}`);
  }
  const secret = totpSecretFromUri(enabled.totpURI);

  const setupSignIn = await signInThroughHandler(auth, email);
  expect(setupSignIn.body.twoFactorRedirect).toBeUndefined();
  const verified = await auth.api.verifyTOTP({
    body: { code: totpCode(secret) },
    headers: { cookie: setupSignIn.cookie },
  });
  expect(verified.user.id).toBeTruthy();
  expect((await getVendorUserById(database.db, verified.user.id))?.twoFactorEnabled).toBe(true);

  return { secret, backupCodes: enabled.backupCodes, totpURI: enabled.totpURI };
}

function hashedResetIdentifier(token: string): string {
  return createHash("sha256").update(`reset-password:${token}`).digest("base64url");
}

async function resetTokenFromLastMail(): Promise<string> {
  const message = mailer.vendorPasswordResets.at(-1);
  expect(message).toBeDefined();
  const url = new URL(message!.url);
  expect(url.origin).toBe(vendorBaseUrl);
  expect(url.pathname).toBe("/reset-password");
  const token = url.searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

describe("Vendor Better Auth: password", () => {
  it("создаёт vendor_users и credential-account без открытого пароля", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("ops");

    const result = await auth.api.signUpEmail({
      body: { email, name: "Ops", password: "correct horse battery staple" },
    });
    expect(result.user.email).toBe(email);

    const user = await database.pool.query(
      "select role, status, mfa_enabled from vendor_users where email=$1",
      [email],
    );
    expect(user.rows[0]).toEqual({ role: "support", status: "invited", mfa_enabled: false });

    const account = await database.pool.query<{ password: string }>(
      "select password from vendor_auth_accounts where user_id=$1",
      [result.user.id],
    );
    expect(account.rows[0]?.password).not.toBe("correct horse battery staple");
    expect(account.rows[0]?.password.length).toBeGreaterThan(20);
  });

  it("reset-password активирует invited, отзывает сессии и пишет аудит", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("reset");
    const userId = await signUp(auth, email);

    const signIn = await auth.api.signInEmail({
      body: { email, password: "correct horse battery staple" },
    });
    expect(signIn.token).toBeTruthy();
    expect(await countSessions(database.pool, userId)).toBe(1);

    await updateVendorUser(database.db, userId, { status: "invited" });
    expect((await getVendorUserById(database.db, userId))?.status).toBe("invited");

    mailer.vendorPasswordResets.length = 0;
    const requested = await auth.api.requestPasswordReset({
      body: { email, redirectTo: resetRedirect },
    });
    expect(requested.status).toBe(true);
    expect(mailer.vendorPasswordResets).toHaveLength(1);
    expect(mailer.vendorPasswordResets[0]?.email).toBe(email);

    const token = await resetTokenFromLastMail();
    const reset = await auth.api.resetPassword({
      body: { token, newPassword: "new correct horse battery" },
    });
    expect(reset.status).toBe(true);

    const user = await getVendorUserById(database.db, userId);
    expect(user).toMatchObject({ status: "active", emailVerified: true });
    expect(await countSessions(database.pool, userId)).toBe(0);
    expect(await hasAudit(database.pool, "vendor.auth.password_reset_completed")).toBe(true);
  });

  it("хранит reset-токен только как SHA-256", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("hashed-token");
    await signUp(auth, email);

    mailer.vendorPasswordResets.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: resetRedirect } });
    const token = await resetTokenFromLastMail();

    const plaintext = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_auth_verifications where identifier = $1",
      [`reset-password:${token}`],
    );
    expect(plaintext.rows[0]?.count).toBe("0");

    const hashed = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from vendor_auth_verifications where identifier = $1",
      [hashedResetIdentifier(token)],
    );
    expect(hashed.rows[0]?.count).toBe("1");
  });
  it("reset-токен одноразовый и истекает", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("token");
    await signUp(auth, email);

    mailer.vendorPasswordResets.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: resetRedirect } });
    const token = await resetTokenFromLastMail();
    const ttl = await database.pool.query<{ minutes: number }>(
      "select round(extract(epoch from (expires_at - now())) / 60)::int as minutes from vendor_auth_verifications where identifier = $1",
      [hashedResetIdentifier(token)],
    );
    expect(ttl.rows[0]?.minutes).toBeGreaterThanOrEqual(29);
    expect(ttl.rows[0]?.minutes).toBeLessThanOrEqual(31);
    await auth.api.resetPassword({ body: { token, newPassword: "first correct horse battery" } });

    await expect(
      auth.api.resetPassword({ body: { token, newPassword: "second correct horse battery" } }),
    ).rejects.toThrow();

    mailer.vendorPasswordResets.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: resetRedirect } });
    const expiredToken = await resetTokenFromLastMail();

    const expired = await database.pool.query(
      "update vendor_auth_verifications set expires_at = now() - interval '1 minute' where identifier = $1",
      [hashedResetIdentifier(expiredToken)],
    );
    expect(expired.rowCount).toBe(1);

    await expect(
      auth.api.resetPassword({ body: { token: expiredToken, newPassword: "third horse battery" } }),
    ).rejects.toThrow();
  });

  it("не отправляет reset suspended/disabled и не реактивирует", async () => {
    const auth = buildAuth();

    for (const status of ["suspended", "disabled"] as const satisfies readonly VendorUserStatus[]) {
      const email = uniqueEmail(status);
      const userId = await signUp(auth, email);
      await updateVendorUser(database.db, userId, { status });

      mailer.vendorPasswordResets.length = 0;
      const requested = await auth.api.requestPasswordReset({
        body: { email, redirectTo: resetRedirect },
      });
      expect(requested.status).toBe(true);
      expect(mailer.vendorPasswordResets).toHaveLength(0);
      expect((await getVendorUserById(database.db, userId))?.status).toBe(status);
    }
  });

  it("не проваливает вход, если onSessionCreated падает", async () => {
    const auth = buildAuth({
      onSessionCreated: async () => {
        throw new Error("session hook unavailable");
      },
    });
    const email = uniqueEmail("session-hook");
    const userId = await signUp(auth, email);

    const signIn = await signInThroughHandler(auth, email);
    expect(signIn.status).toBe(200);
    expect(signIn.body.twoFactorRedirect).toBeUndefined();
    expect(await countSessions(database.pool, userId)).toBe(1);
  });

  it("успешный вход пишет last_login_at и активирует invited", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("login-mark");
    const userId = await signUp(auth, email);
    expect((await getVendorUserById(database.db, userId))?.status).toBe("invited");

    const signIn = await signInThroughHandler(auth, email);
    expect(signIn.status).toBe(200);

    const row = await database.pool.query<{ last_login_at: Date | null; status: string }>(
      "select last_login_at, status from vendor_users where id = $1",
      [userId],
    );
    expect(row.rows[0]?.last_login_at).not.toBeNull();
    expect(row.rows[0]?.status).toBe("active");
    expect(await countSessions(database.pool, userId)).toBe(1);
  });
});

describe("Vendor Better Auth: passkey", () => {
  it("passkey-плагин использует rpID, origin и обязательный resident key", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("passkey");
    const userId = await signUp(auth, email);
    await updateVendorUser(database.db, userId, { role: "superadmin", status: "active" });
    const signedIn = await signInThroughHandler(auth, email);
    const options = await auth.api.generatePasskeyRegistrationOptions({
      headers: new Headers({ cookie: signedIn.cookie }),
    });
    expect(options.rp.id).toBe("vendor.example.test");
    expect(options.rp.name).toBe("Партнёр кодер (вендор)");
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
  });
});

describe("Vendor Better Auth: TOTP и блокировка", () => {
  it("включает TOTP, шифрует секрет и требует второй фактор при входе", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("totp");
    const userId = await signUp(auth, email);

    const { secret: plainSecret, backupCodes, totpURI } = await enableTotp(auth, email);

    const totpUrl = new URL(totpURI);
    expect(totpUrl.searchParams.get("issuer")).toBe("Партнёр кодер (вендор)");
    expect(decodeURIComponent(totpUrl.pathname.replace(/^\//, "")).split(":")[0]).toBe(
      "Партнёр кодер (вендор)",
    );
    expect(backupCodes).toHaveLength(10);

    const stored = await database.pool.query<{ secret: string; backup_codes: string }>(
      "select secret, backup_codes from vendor_auth_two_factors where user_id = $1",
      [userId],
    );
    expect(stored.rowCount).toBe(1);
    const secret = stored.rows[0]?.secret ?? "";
    const storedBackupCodes = stored.rows[0]?.backup_codes ?? "";
    expect(secret).not.toBe(plainSecret);
    expect(secret).not.toMatch(/^[A-Z2-7]+=*$/);
    expect(storedBackupCodes).not.toBe(backupCodes.join(","));
    expect(storedBackupCodes).not.toBe(JSON.stringify(backupCodes));
    for (const code of backupCodes) {
      expect(storedBackupCodes).not.toContain(code);
    }

    expect((await getVendorUserById(database.db, userId))?.twoFactorEnabled).toBe(true);

    const sessionsBefore = await countSessions(database.pool, userId);
    const signIn = await signInThroughHandler(auth, email);
    expect(signIn.status).toBe(200);
    expect(signIn.body.twoFactorRedirect).toBe(true);
    expect(await countSessions(database.pool, userId)).toBe(sessionsBefore);

    const verified = await auth.api.verifyTOTP({
      body: { code: totpCode(plainSecret) },
      headers: { cookie: signIn.cookie },
    });
    expect(verified.user.twoFactorEnabled).toBe(true);
    expect(await countSessions(database.pool, userId)).toBe(sessionsBefore + 1);
  });

  it("неверный TOTP увеличивает счетчик и блокирует после лимита", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("lockout");
    const userId = await signUp(auth, email);
    const { secret } = await enableTotp(auth, email);

    const signIn = await signInThroughHandler(auth, email);
    expect(signIn.body.twoFactorRedirect).toBe(true);
    const wrongCode = totpCode(secret, Date.now() - 5 * 30_000);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        auth.api.verifyTOTP({
          body: { code: wrongCode },
          headers: { cookie: signIn.cookie },
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
    }

    const locked = await database.pool.query<{
      failed_verification_count: number;
      locked_until: Date | null;
    }>(
      "select failed_verification_count, locked_until from vendor_auth_two_factors where user_id = $1",
      [userId],
    );
    expect(locked.rows[0]?.failed_verification_count).toBe(5);
    expect(locked.rows[0]?.locked_until).not.toBeNull();

    await expect(
      auth.api.verifyTOTP({
        body: { code: wrongCode },
        headers: { cookie: signIn.cookie },
      }),
    ).rejects.toMatchObject({
      statusCode: 429,
      body: { code: "ACCOUNT_TEMPORARILY_LOCKED" },
    });
  });

  it("backup-код принимается и не повторяется", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("backup");
    const userId = await signUp(auth, email);
    const { backupCodes } = await enableTotp(auth, email);
    const code = backupCodes[0]!;

    const firstSignIn = await signInThroughHandler(auth, email);
    expect(firstSignIn.body.twoFactorRedirect).toBe(true);
    const verified = await auth.api.verifyBackupCode({
      body: { code },
      headers: { cookie: firstSignIn.cookie },
    });
    expect(verified.user.id).toBe(userId);

    const secondSignIn = await signInThroughHandler(auth, email);
    expect(secondSignIn.body.twoFactorRedirect).toBe(true);
    await expect(
      auth.api.verifyBackupCode({
        body: { code },
        headers: { cookie: secondSignIn.cookie },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("suspended не создаёт сессию и не проходит session hook", async () => {
    const auth = buildAuth();

    for (const status of ["suspended", "disabled"] as const satisfies readonly VendorUserStatus[]) {
      const email = uniqueEmail(`totp-${status}`);
      const userId = await signUp(auth, email);
      await updateVendorUser(database.db, userId, { status });

      await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject({
        statusCode: 403,
        body: { code: "VENDOR_INACTIVE" },
      });

      const context = await auth.$context;
      await expect(context.internalAdapter.createSession(userId, false)).resolves.toBeNull();
      expect(await countSessions(database.pool, userId)).toBe(0);
    }
  });
});
