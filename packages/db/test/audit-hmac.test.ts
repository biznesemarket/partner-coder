import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Pool } from "pg";

import { TEST_AUDIT_HMAC_KEY, createTestDatabase, type TestDatabase } from "./helpers.js";
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

function poolWithKey(key: string): Pool {
  return new Pool({
    connectionString: database.url,
    max: 1,
    options: `-c app.audit_hmac_key=${key}`,
  });
}

describe("HMAC-ключ цепочки аудита", () => {
  it("проверяет цепочку только с тем же ключом", async () => {
    const sameKey = poolWithKey(TEST_AUDIT_HMAC_KEY);
    const otherKey = poolWithKey("1".repeat(64));
    try {
      const valid = await sameKey.query<{ ok: boolean }>(
        "select verify_vendor_audit_chain() as ok",
      );
      expect(valid.rows[0]?.ok).toBe(true);

      const invalid = await otherKey.query<{ ok: boolean }>(
        "select verify_vendor_audit_chain() as ok",
      );
      expect(invalid.rows[0]?.ok).toBe(false);
    } finally {
      await sameKey.end();
      await otherKey.end();
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
