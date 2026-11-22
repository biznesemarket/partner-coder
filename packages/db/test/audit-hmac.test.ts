import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Pool } from "pg";

import { createTestDatabase, type TestDatabase } from "./helpers.js";
import { seedVendorBase } from "./fixtures.js";

let database: TestDatabase;
let vendorUserId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  const base = await seedVendorBase(database.pool);
  vendorUserId = base.vendorUserId;
  await database.pool.query(
    `select vendor_audit($1, null, 'audit.hmac.test', 'vendor_user', null, '{"ok": true}'::jsonb, null)`,
    [vendorUserId],
  );
}, 120_000);

afterAll(async () => {
  await database?.drop();
}, 60_000);

describe("HMAC-ключ цепочки аудита", () => {
  it("проверяет цепочку только с тем же ключом", async () => {
    const valid = await database.pool.query<{ ok: boolean }>(
      "select verify_vendor_audit_chain() as ok",
    );
    expect(valid.rows[0]?.ok).toBe(true);

    const client = await database.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.audit_hmac_key', $1, true)", ["1".repeat(64)]);
      const invalid = await client.query<{ ok: boolean }>(
        "select verify_vendor_audit_chain() as ok",
      );
      expect(invalid.rows[0]?.ok).toBe(false);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("без ключа не даёт записать событие аудита", async () => {
    const noKey = new Pool({ connectionString: database.url, max: 1 });
    try {
      await expect(
        noKey.query(
          `select vendor_audit($1, null, 'audit.hmac.no_key', 'vendor_user', null, '{}'::jsonb, null)`,
          [vendorUserId],
        ),
      ).rejects.toMatchObject({
        code: "42501",
        message: expect.stringContaining("audit_hmac_key_missing"),
      });
    } finally {
      await noKey.end();
    }
  });
});
