import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../../packages/db/test/helpers.js";
import { buildServer } from "../server.js";
import type { VendorAuth } from "./config.js";
import type { VendorAuthRuntime } from "./runtime.js";

const vendorBaseUrl = "http://localhost:3001";
const apiBaseUrl = "http://localhost:4000";

let database: TestDatabase;
let server: FastifyInstance;
let vendorUserId: string;
let vendorSessionId: string;
let handlerCalls: string[];

beforeAll(async () => {
  database = await createTestDatabase();
  vendorUserId = randomUUID();
  vendorSessionId = randomUUID();
  const email = `audit-${vendorUserId}@example.com`;

  await database.pool.query(
    `insert into vendor_users (id, email, name, role, status, mfa_enabled)
     values ($1, $2, 'Ops', 'superadmin', 'active', true)`,
    [vendorUserId, email],
  );

  const auth = {
    api: {
      async getSession() {
        return {
          user: {
            id: vendorUserId,
            email,
            name: "Ops",
            role: "superadmin",
            status: "active",
            twoFactorEnabled: true,
          },
          session: {
            id: vendorSessionId,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            stepUpUntil: null,
          },
        };
      },
    },
    async handler(request: Request): Promise<Response> {
      handlerCalls.push(new URL(request.url).pathname);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  } as unknown as VendorAuth;

  const runtime: VendorAuthRuntime = {
    auth,
    db: database.db,
    authDb: database.db,
    vendorBaseUrl,
    stepUpMinutes: 5,
  };

  server = buildServer({ logger: false, apiBaseUrl, vendorRuntime: runtime });
  await server.ready();
}, 120_000);

afterAll(async () => {
  await server?.close();
  await database?.drop();
}, 60_000);

beforeEach(() => {
  handlerCalls = [];
});

async function auditRows(action: string) {
  return database.pool.query<{
    actor_id: string | null;
    entity: string;
    after: Record<string, unknown> | null;
  }>(
    `select actor_id, entity, after
       from vendor_audit_events
      where action = $1`,
    [action],
  );
}

async function expectChainValid(): Promise<void> {
  const chain = await database.pool.query<{ ok: boolean }>(
    "select verify_vendor_audit_chain() as ok",
  );
  expect(chain.rows[0]?.ok).toBe(true);
}

describe("аудит passkey в вендорском прокси", () => {
  it("аудирует добавление passkey", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/vendor-auth/passkey/verify-registration",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(handlerCalls).toEqual(["/api/vendor-auth/passkey/verify-registration"]);

    const rows = await auditRows("vendor.passkey.added");
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      actor_id: vendorUserId,
      entity: "vendor_passkey",
      after: { userId: vendorUserId, sessionId: vendorSessionId },
    });
    await expectChainValid();
  });

  it("аудирует удаление passkey", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/vendor-auth/passkey/delete-passkey",
      payload: { id: randomUUID() },
    });

    expect(response.statusCode).toBe(200);
    expect(handlerCalls).toEqual(["/api/vendor-auth/passkey/delete-passkey"]);

    const rows = await auditRows("vendor.passkey.removed");
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      actor_id: vendorUserId,
      entity: "vendor_passkey",
      after: { userId: vendorUserId, sessionId: vendorSessionId },
    });
    await expectChainValid();
  });

  it("аудирует переименование passkey без секретов", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/vendor-auth/passkey/update-passkey",
      payload: { id: randomUUID(), name: "Ноутбук" },
    });

    expect(response.statusCode).toBe(200);

    const rows = await auditRows("vendor.passkey.renamed");
    expect(rows.rowCount).toBe(1);
    const serialized = JSON.stringify(rows.rows[0]?.after);
    expect(serialized).not.toMatch(/Ноутбук|credential|publicKey/i);
    await expectChainValid();
  });
});
