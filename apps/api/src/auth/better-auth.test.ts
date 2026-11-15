import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { createAuth } from "./config.js";
import { MemoryMailer } from "./mailer.js";

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
  return createAuth({
    db: database.db,
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: "http://localhost:4000",
    webBaseURL: "http://localhost:3000",
    sessionTtlHours: 12,
    magicLinkTtlMinutes: 30,
    mailer,
  });
}

describe("Better Auth: email OTP", () => {
  it("создает пользователя, сессию и хеширует OTP в БД", async () => {
    const auth = buildAuth();
    const email = `otp-${randomUUID()}@example.com`;

    const sent = await auth.api.sendVerificationOTP({
      body: { email, type: "sign-in" },
    });
    expect(sent.success).toBe(true);

    const otpMessage = mailer.otps.at(-1);
    expect(otpMessage?.email).toBe(email);
    expect(otpMessage?.otp).toMatch(/^\d{6}$/);

    const verification = await database.pool.query<{ value: string }>(
      "select value from auth_verifications where identifier like $1 order by created_at desc limit 1",
      [`%${email}%`],
    );
    expect(verification.rows[0]?.value).not.toBe(otpMessage?.otp);
    expect(verification.rows[0]?.value.length).toBeGreaterThan(32);
    expect(verification.rows[0]?.value.startsWith(otpMessage!.otp)).toBe(false);

    const signedIn = await auth.api.signInEmailOTP({
      body: { email, otp: otpMessage!.otp },
    });
    expect(signedIn.user.email).toBe(email);
    expect(signedIn.user.emailVerified).toBe(true);
    expect(signedIn.token).toBeTruthy();

    const session = await database.pool.query<{ token: string; user_id: string }>(
      "select token, user_id from auth_sessions where user_id = $1",
      [signedIn.user.id],
    );
    expect(session.rows[0]?.token).toBeTruthy();
    expect(session.rows[0]?.user_id).toBe(signedIn.user.id);

    const user = await database.pool.query<{ status: string; email_verified: boolean }>(
      "select status, email_verified from users where id = $1",
      [signedIn.user.id],
    );
    expect(user.rows[0]).toEqual({ status: "active", email_verified: true });
  });
});

describe("Better Auth: magic link", () => {
  it("отправляет ссылку и создает сессию по одноразовому токену", async () => {
    const auth = buildAuth();
    const email = `magic-${randomUUID()}@example.com`;

    const sent = await auth.api.signInMagicLink({
      body: { email, callbackURL: "http://localhost:3000/auth/verify" },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    expect(sent.status).toBe(true);

    const message = mailer.magicLinks.at(-1);
    expect(message?.email).toBe(email);
    const token = new URL(message!.url).searchParams.get("token");
    expect(token).toBeTruthy();

    const verified = await auth.api.magicLinkVerify({
      query: { token: token! },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    expect(verified.user.email).toBe(email);
    expect(verified.session.token).toBeTruthy();
  });
});
