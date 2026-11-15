import { sql } from "drizzle-orm";

import type { Database } from "@partner-coder/db";
import { localDateOf } from "@partner-coder/domain";

export interface AuditAnchorOptions {
  readonly date?: string;
  readonly now?: Date;
}

export interface AuditAnchorResult {
  readonly date: string;
  readonly tenantEvents: number;
  readonly vendorEvents: number;
  readonly tenantsAnchored: number;
  readonly vendorAnchored: boolean;
  readonly skipped: boolean;
}

function countOf(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * Ставит дневной якорь только после закрытия UTC-суток.
 *
 * Перед якорем проверяются обе хеш-цепочки; повреждение останавливает задание
 * и уходит в retry/dead-letter. Якоря производные: повторный запуск
 * пересчитывает снимок, не меняя журнал.
 */
export async function anchorAudits(
  db: Database,
  options: AuditAnchorOptions = {},
): Promise<AuditAnchorResult> {
  const now = options.now ?? new Date();
  const todayUtc = localDateOf(now.getTime(), "UTC");
  const date = options.date ?? localDateOf(now.getTime() - 86_400_000, "UTC");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Некорректная дата якоря: ${date}`);
  }
  if (date >= todayUtc) {
    throw new Error(
      `audit_anchor_requires_closed_utc_day: ${date} не закрыт (сегодня ${todayUtc})`,
    );
  }

  const tenantChains = await db.execute(sql`
    select id, verify_tenant_audit_chain(id) as ok from tenants order by id
  `);
  const brokenTenants = (tenantChains.rows as { id: string; ok: boolean }[])
    .filter((row) => row.ok !== true)
    .map((row) => row.id);
  if (brokenTenants.length > 0) {
    throw new Error(`audit_chain_invalid: tenant ${brokenTenants.join(", ")}`);
  }

  const vendorChain = await db.execute(sql`select verify_vendor_audit_chain() as ok`);
  if ((vendorChain.rows[0] as { ok?: boolean } | undefined)?.ok !== true) {
    throw new Error("audit_chain_invalid: vendor");
  }

  const tenantCounts = await db.execute(sql`
    select count(*)::integer as total
      from tenant_audit_events
     where created_at >= (${date}::timestamp at time zone 'UTC')
       and created_at < ((${date}::date + 1)::timestamp at time zone 'UTC')
  `);
  const vendorCounts = await db.execute(sql`
    select count(*)::integer as total
      from vendor_audit_events
     where created_at >= (${date}::timestamp at time zone 'UTC')
       and created_at < ((${date}::date + 1)::timestamp at time zone 'UTC')
  `);

  const anchored = await db.execute(sql`
    select id, anchor_tenant_audit(id, ${date}) as last_hash
      from tenants
     order by id
  `);
  const anchoredTenants = (anchored.rows as { id: string; last_hash: string | null }[]).filter(
    (row) => row.last_hash !== null,
  );

  if (anchoredTenants.length > 0) {
    const anchoredIds = new Set(anchoredTenants.map((row) => row.id));
    const verification = await db.execute(sql`
      select id, verify_tenant_audit_anchor(id, ${date}) as ok
        from tenants
       order by id
    `);
    const broken = (verification.rows as { id: string; ok: boolean }[]).filter(
      (row) => anchoredIds.has(row.id) && row.ok !== true,
    );
    if (broken.length > 0) {
      throw new Error(`audit_anchor_invalid: tenant ${broken.map((row) => row.id).join(", ")}`);
    }
  }

  const vendorAnchored = await db.execute(sql`
    select anchor_vendor_audit(${date}) as last_hash
  `);

  const vendorAnchor = vendorAnchored.rows[0] as { last_hash?: string | null } | undefined;

  return {
    date,
    tenantEvents: countOf((tenantCounts.rows[0] as { total?: number } | undefined)?.total),
    vendorEvents: countOf((vendorCounts.rows[0] as { total?: number } | undefined)?.total),
    tenantsAnchored: anchoredTenants.length,
    vendorAnchored: Boolean(vendorAnchor?.last_hash),
    skipped: false,
  };
}
