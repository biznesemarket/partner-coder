import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";

import type { Database, VendorRole, VendorUserStatus } from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import type { VendorAuth } from "./config.js";
import { createVendorGuards } from "./guard.js";
import type { VendorAuthRuntime, VendorIdentity } from "./runtime.js";

const userId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const sessionExpiresAt = new Date("2026-11-16T18:00:00Z");
const headers: IncomingHttpHeaders = { cookie: "pc-vendor.session_token=token" };

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

function identity(overrides: Partial<VendorIdentity> = {}): VendorIdentity {
  return {
    userId,
    email: "ops@example.com",
    name: "Опс",
    role: "superadmin",
    status: "active",
    twoFactorEnabled: true,
    sessionId,
    sessionExpiresAt,
    stepUpUntil: new Date("2026-11-16T10:25:00Z"),
    ...overrides,
  };
}

function fakeAuth(result: unknown): VendorAuth {
  return { api: { getSession: async () => result } } as unknown as VendorAuth;
}

function createRuntime(
  result: unknown,
  overrides: Partial<Pick<VendorAuthRuntime, "db" | "authDb">> = {},
): VendorAuthRuntime {
  return {
    auth: fakeAuth(result),
    db: database?.db ?? ({} as Database),
    authDb: database?.db ?? ({} as Database),
    vendorBaseUrl: "http://localhost:3001",
    stepUpMinutes: 5,
    ...overrides,
  };
}

function makeRequest(
  options: { vendorAuth?: VendorIdentity; url?: string; routeUrl?: string } = {},
): FastifyRequest {
  return {
    headers,
    vendorAuth: options.vendorAuth,
    id: "req-test",
    url: options.url ?? "/v1/vendor/users",
    method: "GET",
    ip: "127.0.0.1",
    routeOptions: { url: options.routeUrl },
    log: { error: () => undefined },
  } as unknown as FastifyRequest;
}

async function seedUser(input: {
  readonly role: VendorRole;
  readonly status: VendorUserStatus;
  readonly twoFactorEnabled?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await database.pool.query(
    `insert into vendor_users (id, email, name, role, status, mfa_enabled)
     values ($1, $2, 'Вендор', $3, $4, $5)`,
    [id, `vendor-${id}@example.com`, input.role, input.status, input.twoFactorEnabled ?? true],
  );
  return id;
}

async function seedSession(vendorUserId: string): Promise<void> {
  await database.pool.query(
    `insert into vendor_auth_sessions (token, user_id, expires_at)
     values ($1, $2, now() + interval '1 hour')`,
    [`session-${randomUUID()}`, vendorUserId],
  );
}

async function countSessions(vendorUserId: string): Promise<number> {
  const result = await database.pool.query<{ count: string }>(
    "select count(*)::text as count from vendor_auth_sessions where user_id = $1",
    [vendorUserId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

function sessionResult(status: VendorUserStatus, id = userId) {
  return {
    user: {
      id,
      email: "ops@example.com",
      name: "Опс",
      role: "support",
      status,
      twoFactorEnabled: false,
    },
    session: {
      id: sessionId,
      expiresAt: sessionExpiresAt,
      stepUpUntil: null,
    },
  };
}

describe("vendor guards", () => {
  it("без сессии — 401 vendor_unauthenticated", async () => {
    const guards = createVendorGuards(createRuntime(null));

    await expect(guards.authenticateVendor(makeRequest())).rejects.toMatchObject({
      statusCode: 401,
      code: "vendor_unauthenticated",
    });
  });

  it.each(["suspended", "disabled"] as const)(
    "%s — 403 vendor_inactive и отзыв сессий",
    async (status) => {
      const vendorUserId = await seedUser({ role: "support", status });
      await seedSession(vendorUserId);
      const guards = createVendorGuards(createRuntime(sessionResult(status, vendorUserId)));

      await expect(guards.authenticateVendor(makeRequest())).rejects.toMatchObject({
        statusCode: 403,
        code: "vendor_inactive",
      });

      expect(await countSessions(vendorUserId)).toBe(0);
    },
  );

  it.each(["invited", "active"] as const)("%s проходит authenticateVendor", async (status) => {
    const vendorUserId = await seedUser({ role: "support", status });
    const guards = createVendorGuards(createRuntime(sessionResult(status, vendorUserId)));
    const request = makeRequest();

    await guards.authenticateVendor(request);

    expect(request.vendorAuth).toMatchObject({ userId: vendorUserId, status });
  });

  it("без TOTP — 403 vendor_mfa_required", async () => {
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorMfa(makeRequest({ vendorAuth: identity({ twoFactorEnabled: false }) })),
    ).rejects.toMatchObject({ statusCode: 403, code: "vendor_mfa_required" });
  });

  it("с TOTP проходит requireVendorMfa", async () => {
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorMfa(makeRequest({ vendorAuth: identity({ twoFactorEnabled: true }) })),
    ).resolves.toBeUndefined();
  });

  it("чужая роль — 403 vendor_role_denied и аудит", async () => {
    const vendorUserId = await seedUser({ role: "support", status: "active" });
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorRole(["superadmin", "finance"])(
        makeRequest({ vendorAuth: identity({ userId: vendorUserId, role: "support" }) }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "vendor_role_denied" });

    const audit = await database.pool.query<{ action: string; actor_id: string }>(
      `select action, actor_id
         from vendor_audit_events
        where actor_id = $1
        order by created_at desc
        limit 1`,
      [vendorUserId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "vendor.auth.role_denied",
      actor_id: vendorUserId,
    });
  });

  it("своя роль проходит requireVendorRole", async () => {
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorRole(["support"])(
        makeRequest({ vendorAuth: identity({ role: "support" }) }),
      ),
    ).resolves.toBeUndefined();
  });

  it("аудит отказа по роли не содержит query string", async () => {
    const vendorUserId = await seedUser({ role: "support", status: "active" });
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorRole(["superadmin"])(
        makeRequest({
          vendorAuth: identity({ userId: vendorUserId, role: "support" }),
          url: "/v1/vendor/users/abc?token=secret&page=2",
          routeUrl: "/v1/vendor/users/:id",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "vendor_role_denied" });

    const audit = await database.pool.query<{ path: string }>(
      `select after->>'path' as path
         from vendor_audit_events
        where actor_id = $1
        order by created_at desc
        limit 1`,
      [vendorUserId],
    );
    expect(audit.rows[0]?.path).toBe("/v1/vendor/users/:id");
    expect(audit.rows[0]?.path).not.toContain("?");
  });

  it("step-up истек — 403 vendor_step_up_required", async () => {
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorStepUp(
        makeRequest({ vendorAuth: identity({ stepUpUntil: new Date(Date.now() - 1_000) }) }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "vendor_step_up_required" });
  });

  it("отсутствующий step-up — 403 vendor_step_up_required", async () => {
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorStepUp(makeRequest({ vendorAuth: identity({ stepUpUntil: null }) })),
    ).rejects.toMatchObject({ statusCode: 403, code: "vendor_step_up_required" });
  });

  it("активный step-up проходит requireVendorStepUp", async () => {
    const guards = createVendorGuards(createRuntime(null));

    await expect(
      guards.requireVendorStepUp(
        makeRequest({ vendorAuth: identity({ stepUpUntil: new Date(Date.now() + 60_000) }) }),
      ),
    ).resolves.toBeUndefined();
  });

  it("ошибка отзыва сессий не отменяет 403 vendor_inactive", async () => {
    const guards = createVendorGuards(
      createRuntime(sessionResult("suspended"), {
        authDb: {
          execute: async () => Promise.reject(new Error("db down")),
        } as unknown as Database,
      }),
    );

    await expect(guards.authenticateVendor(makeRequest())).rejects.toMatchObject({
      statusCode: 403,
      code: "vendor_inactive",
    });
  });

  it("ошибка аудита не отменяет 403 vendor_role_denied", async () => {
    const guards = createVendorGuards(
      createRuntime(null, {
        db: { execute: async () => Promise.reject(new Error("audit down")) } as unknown as Database,
      }),
    );

    await expect(
      guards.requireVendorRole(["superadmin"])(
        makeRequest({ vendorAuth: identity({ role: "support" }) }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "vendor_role_denied" });
  });
});
