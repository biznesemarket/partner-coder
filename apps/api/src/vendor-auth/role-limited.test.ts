import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activateAfterPasswordReset,
  createDatabase,
  getVendorUserByEmail,
  getVendorUserById,
  markVendorLogin,
  type Database,
} from "@partner-coder/db";

import {
  createPoolForUrl,
  createTestDatabase,
  type TestDatabase,
} from "../../../../packages/db/test/helpers.js";
import { MemoryMailer } from "../auth/mailer.js";
import { createVendorAuth, type VendorAuth } from "./config.js";

const authSecret = "vendor-role-secret-vendor-role-secret-1234";
const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";
const password = "correct horse battery staple";

let database: TestDatabase;
let authPool: ReturnType<typeof createPoolForUrl>;
let authDb: Database;
let authRole: string;
let mailer: MemoryMailer;
let auth: VendorAuth;

function roleUrl(base: string, role: string, rolePassword: string): string {
  const url = new URL(base);
  url.username = role;
  url.password = rolePassword;
  return url.toString();
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

async function postThroughHandler(
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<{ body: Record<string, unknown>; cookie: string; status: number }> {
  const response = await auth.handler(
    new Request(`${apiBaseUrl}/api/vendor-auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: vendorBaseUrl,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  const responseCookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter((value): value is string => Boolean(value))
    .join("; ");
  return {
    body: (await response.json()) as Record<string, unknown>,
    cookie: responseCookie,
    status: response.status,
  };
}

async function countRows(table: string, userId: string): Promise<number> {
  const result = await authPool.query<{ count: string }>(
    `select count(*)::text as count from ${table} where user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

beforeAll(async () => {
  database = await createTestDatabase();
  const unique = randomBytes(6).toString("hex");
  authRole = `test_vendor_auth_${unique}`;
  const rolePassword = randomBytes(16).toString("hex");
  await database.pool.query(
    `create role "${authRole}" login password '${rolePassword}' in role partner_coder_vendor_auth`,
  );
  authPool = createPoolForUrl(roleUrl(database.url, authRole, rolePassword));
  authDb = createDatabase(authPool);
  mailer = new MemoryMailer();

  auth = createVendorAuth({
    db: authDb,
    secret: authSecret,
    baseURL: apiBaseUrl,
    vendorBaseURL: vendorBaseUrl,
    sessionTtlHours: 8,
    passwordResetTtlMinutes: 30,
    passwordMinLength: 12,
    mailer,
    rateLimitEnabled: false,
    getVendorStatus: async (vendorUserId) =>
      (await getVendorUserById(authDb, vendorUserId))?.status ?? null,
    getVendorStatusByEmail: async (email) =>
      (await getVendorUserByEmail(authDb, email))?.status ?? null,
    onSessionCreated: async (vendorUserId) => {
      await markVendorLogin(authDb, vendorUserId);
    },
    onPasswordReset: async (vendorUserId) => {
      await activateAfterPasswordReset(authDb, vendorUserId);
    },
  });
}, 120_000);

afterAll(async () => {
  await authPool?.end().catch(() => undefined);
  if (database) {
    try {
      await database.pool.query(`drop role if exists "${authRole}"`);
    } finally {
      await database.drop();
    }
  }
}, 60_000);

describe("Vendor Better Auth под ролью partner_coder_vendor_auth", () => {
  it("проходит sign-up, reset, TOTP, вход и выход без 42501", async () => {
    const email = `role-${randomUUID()}@example.com`;

    const signedUp = await auth.api.signUpEmail({
      body: { email, name: "Ops", password },
    });
    const userId = signedUp.user.id;

    const user = await getVendorUserByEmail(authDb, email);
    expect(user).toMatchObject({ id: userId, role: "support", status: "invited" });
    expect(await countRows("vendor_auth_accounts", userId)).toBe(1);

    mailer.vendorPasswordResets.length = 0;
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${vendorBaseUrl}/reset-password` },
    });
    const message = mailer.vendorPasswordResets.at(-1);
    expect(message).toBeDefined();
    const token = new URL(message!.url).searchParams.get("token");
    expect(token).toBeTruthy();

    const verification = await authPool.query<{ count: string }>(
      "select count(*)::text as count from vendor_auth_verifications where identifier = $1",
      [`reset-password:${token}`],
    );
    expect(verification.rows[0]?.count).toBe("1");

    await auth.api.resetPassword({ body: { token: token!, newPassword: password } });
    expect(await getVendorUserById(authDb, userId)).toMatchObject({
      status: "active",
      emailVerified: true,
    });

    const signIn = await postThroughHandler("/sign-in/email", { email, password });
    expect(signIn.status).toBe(200);
    expect(signIn.body.twoFactorRedirect).toBeUndefined();
    expect(signIn.cookie).toContain("session_token");
    expect(await countRows("vendor_auth_sessions", userId)).toBe(1);

    const enabled = await auth.api.enableTwoFactor({
      body: { password },
      headers: { cookie: signIn.cookie },
    });
    expect(enabled.method).toBe("totp");
    if (enabled.method !== "totp") {
      throw new Error(`unexpected 2FA method: ${enabled.method}`);
    }
    const secret = new URL(enabled.totpURI).searchParams.get("secret");
    expect(secret).toBeTruthy();

    const setupSignIn = await postThroughHandler("/sign-in/email", { email, password });
    expect(setupSignIn.status).toBe(200);
    expect(setupSignIn.body.twoFactorRedirect).toBeUndefined();
    const verified = await auth.api.verifyTOTP({
      body: { code: totpCode(secret!) },
      headers: { cookie: setupSignIn.cookie },
    });
    expect(verified.user.id).toBe(userId);
    expect(await getVendorUserById(authDb, userId)).toMatchObject({ twoFactorEnabled: true });
    expect(await countRows("vendor_auth_two_factors", userId)).toBe(1);

    const totpSignIn = await postThroughHandler("/sign-in/email", { email, password });
    expect(totpSignIn.status).toBe(200);
    expect(totpSignIn.body.twoFactorRedirect).toBe(true);
    const totpVerified = await postThroughHandler(
      "/two-factor/verify-totp",
      { code: totpCode(secret!) },
      totpSignIn.cookie,
    );
    expect(totpVerified.status).toBe(200);
    expect(totpVerified.cookie).toContain("session_token");
    expect(await countRows("vendor_auth_sessions", userId)).toBe(3);

    await auth.api.signOut({ headers: { cookie: totpVerified.cookie } });
    expect(await countRows("vendor_auth_sessions", userId)).toBe(2);
  });
});
