import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool, type PoolClient } from "pg";

import * as schema from "../src/schema/index.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export const API_ROLE = "partner_coder_api";
export const VENDOR_ROLE = "partner_coder_vendor";
export const WORKER_ROLE = "partner_coder_worker";
export const AUTH_ROLE = "partner_coder_auth";

export function databaseUrl(): string {
  try {
    process.loadEnvFile();
  } catch {
    // В CI `.env` нет — URL приходит из окружения.
  }
  return process.env.DATABASE_URL ?? "postgres://partner:partner@localhost:5432/partner_coder";
}

export interface TestDatabase {
  readonly url: string;
  readonly name: string;
  readonly pool: Pool;
  readonly db: ReturnType<typeof drizzle>;
  drop(): Promise<void>;
}

function urlWithDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const base = databaseUrl();
  const name = `pc_test_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const url = urlWithDatabase(base, name);
  const pool = new Pool({ connectionString: url, max: 5 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });

  return {
    url,
    name,
    pool,
    db,
    async drop() {
      await pool.end();
      const cleaner = new Client({ connectionString: base });
      await cleaner.connect();
      try {
        await cleaner.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

/** Дополнительный пул к тестовой БД: имитация второго API-инстанса. */
export function createPoolForDatabase(database: TestDatabase, max = 2): Pool {
  return new Pool({ connectionString: database.url, max });
}

/** Пул с отдельными учётными данными (роль-ограниченный логин). */
export function createPoolForUrl(url: string, max = 2): Pool {
  return new Pool({ connectionString: url, max });
}

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export async function asTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
  userId?: string,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${API_ROLE}`);
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    if (userId) {
      await client.query("select set_config('app.user_id', $1, true)", [userId]);
    }
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function asRole<T>(
  pool: Pool,
  role: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
