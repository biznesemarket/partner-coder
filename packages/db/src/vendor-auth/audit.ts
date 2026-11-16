import { sql } from "drizzle-orm";

import type { Database, DbTransaction } from "../client.js";

export interface VendorAuditEvent {
  readonly actorId?: string | null;
  readonly customerId?: string | null;
  readonly action: string;
  readonly entity: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
}

/**
 * Пишет событие вендорского аудита через SECURITY DEFINER-функцию: прямого
 * INSERT в vendor_audit_events у вендорских ролей нет.
 */
export async function writeVendorAudit(
  db: Database | DbTransaction,
  event: VendorAuditEvent,
): Promise<string> {
  const before = event.before === undefined || event.before === null ? null : event.before;
  const after = event.after === undefined || event.after === null ? null : event.after;
  const beforeJson = before === null ? null : JSON.stringify(before);
  const afterJson = after === null ? null : JSON.stringify(after);

  const result = await db.execute(
    sql`select vendor_audit(
          ${event.actorId ?? null},
          ${event.customerId ?? null},
          ${event.action},
          ${event.entity},
          ${beforeJson}::jsonb,
          ${afterJson}::jsonb,
          ${event.ip ?? null}
        ) as id`,
  );
  const row = result.rows[0] as { id: string } | undefined;
  if (!row) {
    throw new Error("vendor_audit did not return an event id");
  }
  return row.id;
}
