import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPool(connectionString: string, max = 10, auditHmacKey?: string): Pool {
  return new Pool({
    connectionString,
    max,
    ...(auditHmacKey === undefined ? {} : { options: `-c app.audit_hmac_key=${auditHmacKey}` }),
  });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

export interface TenantContext {
  readonly tenantId: string;
  readonly userId?: string;
}

/** Выставляет контекст для RLS в текущей транзакции. */
export async function setTenantContext(tx: DbTransaction, context: TenantContext): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${context.tenantId}, true)`);
  if (context.userId) {
    await tx.execute(sql`select set_config('app.user_id', ${context.userId}, true)`);
  }
}

/**
 * Транзакция с tenant-контекстом. Роль БД выбирается логином, которому выдано
 * членство в partner_coder_api; helper не меняет роль, чтобы не повышать права.
 */
export async function withTenantContext<T>(
  db: Database,
  context: TenantContext,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, context);
    return fn(tx);
  });
}
