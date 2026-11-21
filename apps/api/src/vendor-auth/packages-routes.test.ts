import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database, type VendorRole } from "@partner-coder/db";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { buildServer } from "../server.js";
import type { VendorAuth } from "./config.js";
import type { VendorAuthRuntime, VendorIdentity } from "./runtime.js";

const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";

let database: TestDatabase;
let db: Database;
let currentSession: unknown = null;
const openApps: FastifyInstance[] = [];

interface SeededUser {
  readonly id: string;
  readonly email: string;
}

async function seedUser(role: VendorRole): Promise<SeededUser> {
  const id = randomUUID();
  const email = `${role}-${id}@example.com`;
  await database.pool.query(
    `insert into vendor_users (id, email, name, role, status, mfa_enabled)
     values ($1, $2, $3, $4, 'active', true)`,
    [id, email, role, role],
  );
  return { id, email };
}

function identity(user: SeededUser, role: VendorRole): VendorIdentity {
  return {
    userId: user.id,
    email: user.email,
    name: user.email,
    role,
    status: "active",
    twoFactorEnabled: true,
    sessionId: randomUUID(),
    sessionExpiresAt: new Date(Date.now() + 60 * 60_000),
    stepUpUntil: null,
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

async function app(): Promise<FastifyInstance> {
  const auth = {
    api: { getSession: async () => currentSession },
  } as unknown as VendorAuth;
  const runtime: VendorAuthRuntime = {
    auth,
    db,
    authDb: db,
    vendorBaseUrl,
    stepUpMinutes: 5,
    packageTtlDays: 7,
    packageVersion: "0.1.0",
  };
  const server = buildServer({ apiBaseUrl, appEnv: "local", vendorRuntime: runtime });
  await server.ready();
  openApps.push(server);
  return server;
}

async function audit(action: string): Promise<Record<string, unknown> | undefined> {
  const result = await database.pool.query<{
    actor_id: string | null;
    after: Record<string, unknown> | null;
  }>(
    `select actor_id, after
       from vendor_audit_events
      where action = $1
      order by created_at desc
      limit 1`,
    [action],
  );
  return result.rows[0];
}

let admin: SeededUser;
let support: SeededUser;
let finance: SeededUser;
let readonly: SeededUser;
let customerId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDatabase(database.pool);
  admin = await seedUser("superadmin");
  support = await seedUser("support");
  finance = await seedUser("finance");
  readonly = await seedUser("readonly");
  const customer = await database.pool.query<{ id: string }>(
    `insert into customers (legal_name, status)
     values ('ООО Пакетный', 'active')
     returning id`,
  );
  customerId = customer.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((server) => server.close()));
  currentSession = null;
});

describe("пакеты и дашборд", () => {
  it("суперадмин выдаёт пакет, токен показывается один раз", async () => {
    const server = await app();
    setSession(identity(admin, "superadmin"));

    const response = await server.inject({
      method: "POST",
      url: `/v1/vendor/customers/${customerId}/packages`,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.package).toMatchObject({
      customerId,
      customerLegalName: "ООО Пакетный",
      status: "issued",
      version: "0.1.0",
    });
    expect(body.token).toMatch(/^pcp_/);
    expect(body.package.tokenPrefix).toBe(body.token.slice(0, 12));

    const listed = await server.inject({
      method: "GET",
      url: `/v1/vendor/packages?customerId=${customerId}`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toContainEqual(
      expect.objectContaining({ id: body.package.id, tokenPrefix: body.package.tokenPrefix }),
    );

    const event = await audit("vendor.package.issued");
    expect(event).toMatchObject({
      actor_id: admin.id,
      after: { packageId: body.package.id, tokenPrefix: body.package.tokenPrefix },
    });
    expect(JSON.stringify(event?.after)).not.toContain(body.token);
  });

  it("support перевыпускает пакет, finance и readonly не могут", async () => {
    const server = await app();
    setSession(identity(support, "support"));

    const list = await server.inject({
      method: "GET",
      url: `/v1/vendor/packages?customerId=${customerId}`,
    });
    const original = list.json().items[0] as { id: string; tokenPrefix: string };

    const reissued = await server.inject({
      method: "POST",
      url: `/v1/vendor/packages/${original.id}/reissue`,
      payload: { reason: "потерян токен" },
    });
    expect(reissued.statusCode).toBe(201);
    const body = reissued.json();
    expect(body.package.id).not.toBe(original.id);
    expect(body.package.status).toBe("issued");
    expect(body.token).toMatch(/^pcp_/);
    expect(body.package.tokenPrefix).not.toBe(original.tokenPrefix);
    expect(await audit("vendor.package.reissued")).toMatchObject({
      actor_id: support.id,
      after: { reason: "потерян токен", packageId: body.package.id },
    });

    const old = await server.inject({
      method: "GET",
      url: `/v1/vendor/packages?customerId=${customerId}`,
    });
    expect(old.json().items).toContainEqual(
      expect.objectContaining({ id: original.id, status: "revoked" }),
    );

    setSession(identity(finance, "finance"));
    const financeIssue = await server.inject({
      method: "POST",
      url: `/v1/vendor/customers/${customerId}/packages`,
    });
    expect(financeIssue.statusCode).toBe(403);
    expect(financeIssue.json()).toMatchObject({ error: { code: "vendor_role_denied" } });

    setSession(identity(readonly, "readonly"));
    const readonlyReissue = await server.inject({
      method: "POST",
      url: `/v1/vendor/packages/${body.package.id}/reissue`,
      payload: {},
    });
    expect(readonlyReissue.statusCode).toBe(403);
    expect(readonlyReissue.json()).toMatchObject({ error: { code: "vendor_role_denied" } });
  });

  it("дашборд отдаёт воронку по статусам", async () => {
    const server = await app();
    setSession(identity(readonly, "readonly"));
    const response = await server.inject({ method: "GET", url: "/v1/vendor/dashboard" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      customers: { total: 1, byStatus: { active: 1 } },
      packages: { byStatus: { issued: 1, revoked: 1 } },
      onboarding: { total: 1, byState: { issued: 1 } },
    });
  });
});
