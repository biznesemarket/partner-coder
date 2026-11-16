import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import { vendorUsers } from "../src/schema/vendor.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let testDb: TestDatabase;

interface ForeignKeyRow {
  column: string;
  table: string;
}

async function tableNames(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  return rows.map((row) => row.tablename);
}

async function columnNames(pool: Pool, table: string): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function foreignKeys(pool: Pool, table: string): Promise<ForeignKeyRow[]> {
  const { rows } = await pool.query<ForeignKeyRow>(
    `select kcu.column_name as "column", ccu.table_name as "table"
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
        and kcu.constraint_schema = tc.constraint_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name
        and ccu.constraint_schema = tc.constraint_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and tc.table_name = $1`,
    [table],
  );
  return rows;
}

async function uniqueIndexes(pool: Pool, table: string): Promise<string[]> {
  const { rows } = await pool.query<{ column: string }>(
    `select a.attname as "column"
       from pg_index i
       join pg_class t on t.oid = i.indrelid
       join pg_namespace n on n.oid = t.relnamespace
       join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
      where n.nspname = 'public'
        and t.relname = $1
        and i.indisunique
        and i.indexprs is null
        and i.indnatts = 1`,
    [table],
  );
  return rows.map((row) => row.column);
}

beforeAll(async () => {
  testDb = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await testDb.drop();
}, 60_000);

describe("схема vendor auth M3", () => {
  it("создаёт таблицы vendor_auth_*", async () => {
    const names = await tableNames(testDb.pool);
    expect(names).toEqual(
      expect.arrayContaining([
        "vendor_auth_accounts",
        "vendor_auth_sessions",
        "vendor_auth_verifications",
        "vendor_auth_two_factors",
        "vendor_auth_passkeys",
        "vendor_auth_rate_limits",
        "vendor_auth_email_limits",
      ]),
    );
  });

  it("расширяет vendor_users под Better Auth", async () => {
    const columns = await columnNames(testDb.pool, "vendor_users");
    expect(columns).toEqual(expect.arrayContaining(["email_verified", "image", "mfa_enabled"]));
    expect(columns).not.toContain("two_factor_enabled");
    expect(vendorUsers.twoFactorEnabled).toBeDefined();
  });

  it("держит FK и уникальность вендорских auth-таблиц", async () => {
    expect(await foreignKeys(testDb.pool, "vendor_auth_passkeys")).toContainEqual(
      expect.objectContaining({ column: "user_id", table: "vendor_users" }),
    );
    expect(await uniqueIndexes(testDb.pool, "vendor_auth_passkeys")).toContain("credential_id");
    expect(await uniqueIndexes(testDb.pool, "vendor_auth_sessions")).toContain("token");
  });
});
