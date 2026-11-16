import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activateAfterPasswordReset,
  getVendorUserById,
  updateVendorUser,
  writeVendorAudit,
  type VendorUserStatus,
} from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { MemoryMailer } from "../auth/mailer.js";
import { createVendorAuth } from "./config.js";

const authSecret = "vendor-test-secret-vendor-test-secret-1234";
const vendorBaseUrl = "http://localhost:3001";
const resetRedirect = `${vendorBaseUrl}/reset-password`;

let database: TestDatabase;
let mailer: MemoryMailer;

beforeAll(async () => {
  database = await createTestDatabase();
  mailer = new MemoryMailer();
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

function buildAuth() {
  return createVendorAuth({
    db: database.db,
    secret: authSecret,
    baseURL: "http://localhost:4000",
    vendorBaseURL: vendorBaseUrl,
    sessionTtlHours: 8,
    passwordResetTtlMinutes: 30,
    passwordMinLength: 12,
    mailer,
    rateLimitEnabled: false,
    getVendorStatus: async (vendorUserId) =>
      (await getVendorUserById(database.db, vendorUserId))?.status ?? null,
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
    body: { email, name: "Ops", password: "correct horse battery staple" },
  });
  return result.user.id;
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

  it("reset-токен одноразовый и истекает", async () => {
    const auth = buildAuth();
    const email = uniqueEmail("token");
    await signUp(auth, email);

    mailer.vendorPasswordResets.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: resetRedirect } });
    const token = await resetTokenFromLastMail();
    const ttl = await database.pool.query<{ minutes: number }>(
      "select round(extract(epoch from (expires_at - now())) / 60)::int as minutes from vendor_auth_verifications where identifier = $1",
      [`reset-password:${token}`],
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
      [`reset-password:${expiredToken}`],
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
});
