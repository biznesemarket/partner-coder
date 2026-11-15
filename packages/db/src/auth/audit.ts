import { sql } from "drizzle-orm";

import type { DbTransaction } from "../client.js";

/**
 * Пишет событие аудита через SECURITY DEFINER-функцию. Прямой INSERT в
 * tenant_audit_events у API-роли отсутствует, actor берется из app.user_id.
 */
export async function writeAudit(
  tx: DbTransaction,
  action: string,
  entity: string,
  before: unknown = null,
  after: unknown = null,
): Promise<void> {
  const beforeJson = before === null ? null : JSON.stringify(before);
  const afterJson = after === null ? null : JSON.stringify(after);
  await tx.execute(
    sql`select app_audit(${action}, ${entity}, ${beforeJson}::jsonb, ${afterJson}::jsonb)`,
  );
}
