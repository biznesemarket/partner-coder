import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import {
  seedTenant,
  seedVendorBase,
  type TenantFixture,
} from "../../../../packages/db/test/fixtures.js";
import { buildServer } from "../server.js";
import { createAuth } from "./config.js";
import { MemoryMailer } from "./mailer.js";
import { createAuthRuntime } from "./runtime.js";

let database: TestDatabase;
let tenant: TenantFixture;
let tenantB: TenantFixture;
let server: FastifyInstance;
let mailer: MemoryMailer;

const host = "localhost:4000";
const origin = "http://localhost:3000";

function extractCookies(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : header ? [String(header)] : [];
  return values
    .map((value) => String(value).split(";")[0])
    .filter((value): value is string => Boolean(value))
    .join("; ");
}

async function requestOtp(email: string): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/auth/email-otp/send-verification-otp",
    headers: { host, origin },
    payload: { email, type: "sign-in" },
  });
  expect(response.statusCode).toBe(200);
  const message = mailer.otps.filter((item) => item.email === email).at(-1);
  expect(message).toBeTruthy();
  return message!.otp;
}

async function signIn(email: string): Promise<string> {
  const otp = await requestOtp(email);
  const response = await server.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    headers: { host, origin },
    payload: { email, otp },
  });
  expect(response.statusCode).toBe(200);
  const cookies = extractCookies(response);
  expect(cookies).toContain("session_token");
  return cookies;
}

beforeAll(async () => {
  database = await createTestDatabase();
  const base = await seedVendorBase(database.pool);
  tenant = await seedTenant(database.pool, base, "a");
  tenantB = await seedTenant(database.pool, base, "b");

  mailer = new MemoryMailer();
  const auth = createAuth({
    db: database.db,
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: `http://${host}`,
    webBaseURL: origin,
    sessionTtlHours: 12,
    magicLinkTtlMinutes: 30,
    mailer,
    rateLimitEnabled: false,
  });
  const runtime = createAuthRuntime({
    auth,
    db: database.db,
    webBaseUrl: origin,
  });
  server = buildServer({ authRuntime: runtime });
  await server.ready();
}, 120_000);

afterAll(async () => {
  await server?.close();
  await database?.drop();
}, 60_000);

describe("E2E: выбор tenant", () => {
  it("требует выбрать tenant при нескольких членствах и сохраняет выбор в сессии", async () => {
    const userId = randomUUID();
    const email = `multi-${randomUUID()}@example.com`;
    await database.pool.query(
      `insert into users (id, email, name, status, email_verified)
       values ($1, $2, 'Мульти', 'active', true)`,
      [userId, email],
    );
    await database.pool.query(
      `insert into memberships (tenant_id, user_id, role, status, joined_at)
       values ($1, $2, 'developer', 'active', now()), ($3, $2, 'developer', 'active', now())`,
      [tenant.tenantId, userId, tenantB.tenantId],
    );

    const cookies = await signIn(email);
    const me = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, cookie: cookies },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ activeTenantId: null, memberships: [{}, {}] });

    const overviewWithoutTenant = await server.inject({
      method: "GET",
      url: "/v1/tenant/overview",
      headers: { host, cookie: cookies },
    });
    expect(overviewWithoutTenant.statusCode).toBe(403);
    expect(overviewWithoutTenant.json()).toMatchObject({ error: { code: "tenant_required" } });

    const selected = await server.inject({
      method: "POST",
      url: "/v1/auth/tenant",
      headers: { host, cookie: cookies },
      payload: { tenantId: tenantB.tenantId },
    });
    expect(selected.statusCode).toBe(200);

    const after = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, cookie: cookies },
    });
    expect(after.json()).toMatchObject({ activeTenantId: tenantB.tenantId });
  });
});

describe("E2E: статус пользователя", () => {
  it("не пускает приостановленного пользователя", async () => {
    const userId = randomUUID();
    const email = `suspended-${randomUUID()}@example.com`;
    await database.pool.query(
      `insert into users (id, email, name, status, email_verified)
       values ($1, $2, 'Приостановленный', 'active', true)`,
      [userId, email],
    );
    await database.pool.query(
      `insert into memberships (tenant_id, user_id, role, status, joined_at)
       values ($1, $2, 'developer', 'active', now())`,
      [tenant.tenantId, userId],
    );

    const cookies = await signIn(email);
    const before = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, cookie: cookies },
    });
    expect(before.statusCode).toBe(200);

    await database.pool.query("update users set status = 'suspended' where id = $1", [userId]);
    const after = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, cookie: cookies },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe("E2E: приглашение и device token через API", () => {
  it("директор приглашает разработчика, тот принимает приглашение", async () => {
    const director = await database.pool.query<{ email: string }>(
      "select email from users where id = $1",
      [tenant.userId],
    );
    const directorEmail = director.rows[0]!.email;
    const directorCookies = await signIn(directorEmail);

    const me = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, cookie: directorCookies },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      activeTenantId: tenant.tenantId,
      memberships: [{ role: "director", tenantId: tenant.tenantId }],
    });

    const inviteeEmail = `e2e-invitee-${randomUUID()}@example.com`;
    const invitation = await server.inject({
      method: "POST",
      url: "/v1/tenant/invitations",
      headers: { host, cookie: directorCookies },
      payload: { email: inviteeEmail, role: "developer", ttlMinutes: 60 },
    });
    expect(invitation.statusCode).toBe(201);
    const invitationBody = invitation.json<{ token: string; inviteUrl: string }>();
    expect(invitationBody.inviteUrl).toContain("/invite?token=");

    const publicInfo = await server.inject({
      method: "GET",
      url: `/v1/public/invitations/${encodeURIComponent(invitationBody.token)}`,
      headers: { host },
    });
    expect(publicInfo.statusCode).toBe(200);
    expect(publicInfo.json()).toMatchObject({ role: "developer", status: "pending" });

    const inviteeCookies = await signIn(inviteeEmail);
    const accepted = await server.inject({
      method: "POST",
      url: `/v1/auth/invitations/${encodeURIComponent(invitationBody.token)}/accept`,
      headers: { host, cookie: inviteeCookies },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ tenantId: tenant.tenantId, role: "developer" });

    const inviteeMe = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, cookie: inviteeCookies },
    });
    expect(inviteeMe.statusCode).toBe(200);
    expect(inviteeMe.json()).toMatchObject({
      activeTenantId: tenant.tenantId,
      memberships: [{ role: "developer", tenantId: tenant.tenantId, status: "active" }],
    });

    const repeat = await server.inject({
      method: "POST",
      url: `/v1/auth/invitations/${encodeURIComponent(invitationBody.token)}/accept`,
      headers: { host, cookie: inviteeCookies },
    });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json()).toMatchObject({ error: { code: "invitation_used" } });
  });

  it("выпускает, аутентифицирует и отзывает device token", async () => {
    const director = await database.pool.query<{ email: string }>(
      "select email from users where id = $1",
      [tenant.userId],
    );
    const directorCookies = await signIn(director.rows[0]!.email);

    const issued = await server.inject({
      method: "POST",
      url: "/v1/me/devices",
      headers: { host, cookie: directorCookies },
      payload: { label: "E2E", scope: "agent" },
    });
    expect(issued.statusCode).toBe(201);
    const issuedBody = issued.json<{ id: string; token: string }>();
    expect(issuedBody.token).toMatch(/^pcd_/);

    const deviceMe = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, authorization: `Bearer ${issuedBody.token}` },
    });
    expect(deviceMe.statusCode).toBe(200);
    expect(deviceMe.json()).toMatchObject({
      user: { kind: "device" },
      activeTenantId: tenant.tenantId,
    });

    const revoked = await server.inject({
      method: "DELETE",
      url: `/v1/me/devices/${issuedBody.id}`,
      headers: { host, cookie: directorCookies },
    });
    expect(revoked.statusCode).toBe(204);

    const afterRevoke = await server.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { host, authorization: `Bearer ${issuedBody.token}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });
});
