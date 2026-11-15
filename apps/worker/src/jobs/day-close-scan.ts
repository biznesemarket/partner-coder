import { sql } from "drizzle-orm";

import type { Database } from "@partner-coder/db";
import { addLocalDays, dayWindowUtc, localDateOf } from "@partner-coder/domain";

import { dateRange, dueCloseDate } from "../schedule.js";

export interface DayCloseScanOptions {
  readonly now?: Date;
  readonly catchupDays?: number;
}

export interface DayCloseScanItem {
  readonly tenantId: string;
  readonly projectId: string;
  readonly policyId: string;
  readonly timezone: string;
  readonly closeAt: string;
  readonly dueDate: string;
  readonly dates: readonly string[];
}

interface ProjectPolicyRow {
  readonly tenant_id: string;
  readonly project_id: string;
  readonly timezone: string;
  readonly policy_id: string;
  readonly params: unknown;
  readonly effective_from: Date | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function closeAtOf(params: unknown): string {
  if (isRecord(params) && isRecord(params.day) && typeof params.day.close_at === "string") {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(params.day.close_at) ? params.day.close_at : "00:00";
  }
  return "00:00";
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function firstClosableDate(effectiveFrom: Date | string, timeZone: string): string {
  const effectiveMs = Date.parse(iso(effectiveFrom));
  const localDate = localDateOf(effectiveMs, timeZone);
  return dayWindowUtc(localDate, timeZone).startMs >= effectiveMs
    ? localDate
    : addLocalDays(localDate, 1);
}

/**
 * Находит проекты, у которых есть незакрытые локальные дни.
 *
 * Сканирование не привязано к часовому поясу процесса: для каждого проекта
 * берется его timezone и close_at текущей политики. Catch-up ограничен
 * `catchupDays`, чтобы новый проект не породил thousands заданий.
 */
export async function scanDueDays(
  db: Database,
  options: DayCloseScanOptions = {},
): Promise<DayCloseScanItem[]> {
  const now = options.now ?? new Date();
  const catchupDays = options.catchupDays ?? 31;

  const policies = await db.execute(sql`
    select p.tenant_id, p.id as project_id, p.timezone,
           pol.id as policy_id, pol.params, pol.effective_from
      from projects p
      join tenants t on t.id = p.tenant_id
      join lateral (
        select id, params, effective_from
          from policies
         where tenant_id = p.tenant_id
           and project_id = p.id
           and effective_from <= ${now}
         order by effective_from desc, version desc
         limit 1
      ) pol on true
     where p.status = 'active'
       and t.status = 'active'
     order by p.tenant_id, p.id
  `);

  const items: DayCloseScanItem[] = [];
  for (const row of policies.rows as unknown as ProjectPolicyRow[]) {
    const closeAt = closeAtOf(row.params);
    const dueDate = dueCloseDate(now, row.timezone, closeAt);

    const lastClosed = await db.execute(sql`
      select max(date_local)::text as last_date
        from day_records
       where tenant_id = ${row.tenant_id}
         and project_id = ${row.project_id}
    `);
    const lastDate = (lastClosed.rows[0] as { last_date?: string | null } | undefined)?.last_date;
    const policyStartDate = firstClosableDate(row.effective_from, row.timezone);
    const afterLastDate = lastDate ? addLocalDays(lastDate, 1) : policyStartDate;
    const startDate = afterLastDate > policyStartDate ? afterLastDate : policyStartDate;

    const dates = dateRange(startDate, dueDate, catchupDays);
    if (dates.length === 0) {
      continue;
    }
    items.push({
      tenantId: row.tenant_id,
      projectId: row.project_id,
      policyId: row.policy_id,
      timezone: row.timezone,
      closeAt,
      dueDate,
      dates,
    });
  }
  return items;
}
