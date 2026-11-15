import { sql } from "drizzle-orm";

import { setTenantContext, type Database, type DbTransaction } from "../client.js";

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

export interface DenialAuditInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly action: string;
  readonly entity: string;
  readonly reason: string;
  readonly role?: string | null;
  readonly requestId?: string | null;
}

/**
 * Отказ пишется отдельной транзакцией: ошибка после аудита не должна
 * откатывать запись (в отличие от аудита внутри падающей операции).
 */
export async function writeDenialAudit(db: Database, input: DenialAuditInput): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenantContext(tx, { tenantId: input.tenantId, userId: input.userId });
    await writeAudit(tx, input.action, input.entity, null, {
      reason: input.reason,
      role: input.role ?? null,
      requestId: input.requestId ?? null,
    });
  });
}
