import { sql } from "drizzle-orm";

import type { Database } from "@partner-coder/db";
import {
  calculateDay,
  dayWindowUtc,
  loadPolicy,
  type InputInterval,
  type IntervalClass,
  type IntervalSource,
  type ProjectPolicy,
  type SessionInput,
} from "@partner-coder/domain";

export interface DayCloseJobData {
  readonly tenantId: string;
  readonly projectId: string;
  readonly date: string;
}

export interface DayCloseResult {
  readonly created: number;
  readonly duplicate: number;
  readonly adjusted: number;
  readonly members: number;
  readonly skipped: boolean;
}

interface ProjectRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly timezone: string;
  readonly status: string;
  readonly tenant_status: string;
}

interface PolicyRow {
  readonly id: string;
  readonly version: number;
  readonly params: unknown;
  readonly approved_by: string | null;
  readonly effective_from: Date | string;
}

interface VersionRow {
  readonly id: string;
  readonly effective_from: Date | string;
  readonly value_kopecks: string;
  readonly reason: string;
  readonly approved_by: string | null;
  readonly adr_ref?: string | null;
}

interface SessionRow {
  readonly id: string;
  readonly membership_id: string;
  readonly task_ref: string | null;
  readonly branch: string | null;
  readonly class: IntervalClass;
  readonly start_utc: Date | string;
  readonly end_utc: Date | string;
  readonly source: IntervalSource;
  readonly created_at: Date | string;
}

interface ExistingDayRow {
  readonly id: string;
  readonly membership_id: string;
  readonly input_hash: string;
  readonly amount_kopecks: string;
  readonly paid_seconds: number;
}

interface AdjustmentRow {
  readonly day_record_id: string;
  readonly delta_kopecks: string;
}

interface AdjustmentHashRow {
  readonly day_record_id: string;
  readonly input_hash: string;
}

interface MutableSession {
  readonly id: string;
  readonly membershipId: string;
  readonly taskRef: string | null;
  readonly branch: string | null;
  readonly intervals: InputInterval[];
}

function firstRow<T>(rows: unknown[]): T | undefined {
  return rows[0] as T | undefined;
}

/** Ключ advisory-блокировки: один закрывающий процесс на проект и дату. */
export function dayCloseLockKey(tenantId: string, projectId: string, date: string): string {
  return `day-close:${tenantId}:${projectId}:${date}`;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function rublesFromKopecks(valueKopecks: string, what: string): number {
  const kopecks = BigInt(valueKopecks);
  if (kopecks % 100n !== 0n) {
    throw new Error(`${what}: ${valueKopecks} копеек не представимы в целых рублях политики`);
  }
  return Number(kopecks / 100n);
}

function versionDocument(
  rows: readonly VersionRow[],
  kind: "rate" | "valuation",
): Record<string, unknown>[] {
  if (rows.length === 0) {
    throw new Error(`В политике нет версий ${kind === "rate" ? "ставки" : "оценки"}`);
  }
  return rows.map((row) => ({
    id: row.id,
    effective_from: iso(row.effective_from),
    value: rublesFromKopecks(row.value_kopecks, `Версия ${kind}`),
    reason: row.reason,
    approved_by: row.approved_by ?? "system",
    ...(kind === "valuation" ? { adr_ref: row.adr_ref ?? "ADR-0007" } : {}),
  }));
}

function buildPolicy(
  row: PolicyRow,
  project: ProjectRow,
  rateRows: readonly VersionRow[],
  valuationRows: readonly VersionRow[],
): ProjectPolicy {
  if (row.params === null || typeof row.params !== "object" || Array.isArray(row.params)) {
    throw new Error("Параметры политики не являются JSON-объектом");
  }
  const source = structuredClone(row.params) as Record<string, unknown>;
  const meta = (source.meta ?? {}) as Record<string, unknown>;
  const projectSection = (source.project ?? {}) as Record<string, unknown>;
  const economics = (source.economics ?? {}) as Record<string, unknown>;
  const rateVersions = versionDocument(rateRows, "rate");
  const valuationVersions = versionDocument(valuationRows, "valuation");
  const effectiveMs = ms(row.effective_from);
  const activeRate =
    [...rateRows].reverse().find((version) => ms(version.effective_from) <= effectiveMs) ??
    rateRows[0]!;
  const activeValuation =
    [...valuationRows].reverse().find((version) => ms(version.effective_from) <= effectiveMs) ??
    valuationRows[0]!;
  const rateRub = rublesFromKopecks(activeRate.value_kopecks, "Текущая ставка");
  const valuationRub = rublesFromKopecks(activeValuation.value_kopecks, "Текущая оценка");

  const document = {
    ...source,
    meta: {
      ...meta,
      policy_version: row.version,
      tenant_id: project.tenant_id,
      project_id: project.id,
      approved_by: row.approved_by ?? meta.approved_by ?? "system",
      effective_from: iso(row.effective_from),
    },
    project: {
      ...projectSection,
      timezone: project.timezone,
    },
    economics: {
      ...economics,
      rate_rub_per_hour: rateRub,
      valuation_rub: valuationRub,
    },
    versions: {
      rate: rateVersions,
      valuation: valuationVersions,
    },
  };
  return loadPolicy(document);
}

function toSessions(rows: readonly SessionRow[]): Map<string, MutableSession[]> {
  const byMembership = new Map<string, Map<string, MutableSession>>();
  for (const row of rows) {
    let sessions = byMembership.get(row.membership_id);
    if (!sessions) {
      sessions = new Map();
      byMembership.set(row.membership_id, sessions);
    }
    let session = sessions.get(row.id);
    if (!session) {
      session = {
        id: row.id,
        membershipId: row.membership_id,
        taskRef: row.task_ref,
        branch: row.branch,
        intervals: [],
      };
      sessions.set(row.id, session);
    }
    session.intervals.push({
      class: row.class,
      start: iso(row.start_utc),
      end: iso(row.end_utc),
      source: row.source,
      receivedAt: iso(row.created_at),
    });
  }
  return new Map(
    [...byMembership.entries()].map(([membershipId, sessions]) => [
      membershipId,
      [...sessions.values()],
    ]),
  );
}

async function insertDayRecord(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: DayCloseJobData,
  membershipId: string,
  policyId: string,
  calculation: ReturnType<typeof calculateDay>,
  policy: ProjectPolicy,
  closedAt: Date,
): Promise<string> {
  const versions = JSON.stringify({
    policyVersionId: policyId,
    rateVersionIds: calculation.versions.rateVersionIds,
    valuationVersionId: calculation.versions.valuationVersionId,
  });
  const inserted = await tx.execute(sql`
    insert into day_records (
      tenant_id, project_id, membership_id, date_local, timezone,
      paid_seconds, tracked_seconds, classes,
      amount_kopecks, cash_kopecks, equity_kopecks, share_bp,
      pool_used_bp, pool_pending, pending_equity_kopecks,
      versions, input_hash, explanation, closed_at
    ) values (
      ${input.tenantId}, ${input.projectId}, ${membershipId}, ${input.date}, ${policy.project.timezone},
      ${calculation.paidSeconds}, ${calculation.trackedSeconds}, ${JSON.stringify(calculation.classes)}::jsonb,
      ${calculation.amountKopecks.toString()}::bigint,
      ${calculation.cashKopecks.toString()}::bigint,
      ${calculation.equityKopecks.toString()}::bigint,
      ${calculation.shareBp.toString()}::bigint,
      ${Number(calculation.poolUsedBp)}, ${calculation.poolPending}, ${calculation.pendingEquityKopecks.toString()}::bigint,
      ${versions}::jsonb, ${calculation.inputHash}, ${JSON.stringify(calculation.explanation)}::jsonb, ${closedAt}
    )
    returning id
  `);
  const row = firstRow<{ id: string }>(inserted.rows);
  if (!row) {
    throw new Error("Не удалось создать дневную запись");
  }

  for (const flag of calculation.flags) {
    await tx.execute(sql`
      insert into day_flags (tenant_id, day_record_id, code, detail)
      values (${input.tenantId}, ${row.id}, ${flag.code}, ${flag.detail})
      on conflict (day_record_id, code) do nothing
    `);
  }

  await auditDayEvent(tx, input.tenantId, "day.closed", {
    date: input.date,
    membershipId,
    inputHash: calculation.inputHash,
    amountKopecks: calculation.amountKopecks.toString(),
    paidSeconds: calculation.paidSeconds,
  });
  return row.id;
}

async function auditDayEvent(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  tenantId: string,
  action: string,
  after: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    insert into tenant_audit_events (tenant_id, actor_type, action, entity, after)
    values (${tenantId}, 'system', ${action}, 'day_record', ${JSON.stringify(after)}::jsonb)
  `);
}

/**
 * Закрывает один день проекта.
 *
 * Идемпотентность: одинаковый input_hash не создает новую запись и не пишет
 * корректировку. Изменившийся расчет пишет append-only `day_adjustments`
 * (delta = новый расчет − эффективная сумма), исходный `day_records` не
 * меняется. Параллельные запуски сериализуются advisory-блокировкой.
 */
export async function closeProjectDay(
  db: Database,
  input: DayCloseJobData,
  options: { readonly now?: Date } = {},
): Promise<DayCloseResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error(`Некорректная дата закрытия: ${input.date}`);
  }
  const closedAt = options.now ?? new Date();

  return db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${dayCloseLockKey(
        input.tenantId,
        input.projectId,
        input.date,
      )}, 0)) as locked`,
    );
    if (!firstRow<{ locked: boolean }>(locked.rows)?.locked) {
      return { created: 0, duplicate: 0, adjusted: 0, members: 0, skipped: true };
    }

    const projectRows = await tx.execute(sql`
      select p.id, p.tenant_id, p.timezone, p.status, t.status as tenant_status
        from projects p
        join tenants t on t.id = p.tenant_id
       where p.tenant_id = ${input.tenantId}
         and p.id = ${input.projectId}
       limit 1
    `);
    const project = firstRow<ProjectRow>(projectRows.rows);
    if (!project || project.status !== "active" || project.tenant_status !== "active") {
      return { created: 0, duplicate: 0, adjusted: 0, members: 0, skipped: true };
    }

    const window = dayWindowUtc(input.date, project.timezone);
    const windowEnd = new Date(window.endMs);

    const policyRows = await tx.execute(sql`
      select id, version, params, approved_by, effective_from
        from policies
       where tenant_id = ${input.tenantId}
         and project_id = ${input.projectId}
         and effective_from <= ${windowEnd}
       order by effective_from desc, version desc
       limit 1
    `);
    const policyRow = firstRow<PolicyRow>(policyRows.rows);
    if (!policyRow) {
      throw new Error(`Нет политики для проекта ${input.projectId} на ${input.date}`);
    }

    const rateRows = await tx.execute(sql`
      select id, effective_from, value_kopecks, reason, approved_by
        from rate_versions
       where tenant_id = ${input.tenantId} and policy_id = ${policyRow.id}
       order by effective_from
    `);
    const valuationRows = await tx.execute(sql`
      select id, effective_from, value_kopecks, reason, approved_by, adr_ref
        from valuation_versions
       where tenant_id = ${input.tenantId} and policy_id = ${policyRow.id}
       order by effective_from
    `);
    const policy = buildPolicy(
      policyRow,
      project,
      rateRows.rows as unknown as VersionRow[],
      valuationRows.rows as unknown as VersionRow[],
    );

    const sessionRows = await tx.execute(sql`
      select s.id, s.membership_id, s.task_ref, s.branch,
             i.class, i.start_utc, i.end_utc, i.source, i.created_at
        from work_sessions s
        join intervals i on i.tenant_id = s.tenant_id and i.session_id = s.id
       where s.tenant_id = ${input.tenantId}
         and s.project_id = ${input.projectId}
         and i.start_utc < ${windowEnd}
         and i.end_utc > ${new Date(window.startMs)}
       order by s.membership_id, s.id, i.start_utc, i.end_utc
    `);
    const sessionsByMembership = toSessions(sessionRows.rows as unknown as SessionRow[]);

    const existingRows = await tx.execute(sql`
      select id, membership_id, input_hash, amount_kopecks, paid_seconds
        from day_records
       where tenant_id = ${input.tenantId}
         and project_id = ${input.projectId}
         and date_local = ${input.date}
    `);
    const existing = new Map(
      (existingRows.rows as unknown as ExistingDayRow[]).map((row) => [row.membership_id, row]),
    );

    const adjustmentRows = await tx.execute(sql`
      select a.day_record_id, coalesce(sum(a.delta_kopecks), 0)::text as delta_kopecks
        from day_adjustments a
        join day_records d on d.tenant_id = a.tenant_id and d.id = a.day_record_id
       where a.tenant_id = ${input.tenantId}
         and d.project_id = ${input.projectId}
         and d.date_local = ${input.date}
       group by a.day_record_id
    `);
    const adjustmentDelta = new Map(
      (adjustmentRows.rows as unknown as AdjustmentRow[]).map((row) => [
        row.day_record_id,
        BigInt(row.delta_kopecks),
      ]),
    );

    const adjustmentHashRows = await tx.execute(sql`
      select a.day_record_id, a.input_hash
        from day_adjustments a
        join day_records d on d.tenant_id = a.tenant_id and d.id = a.day_record_id
       where a.tenant_id = ${input.tenantId}
         and d.project_id = ${input.projectId}
         and d.date_local = ${input.date}
    `);
    const adjustmentHashes = new Set(
      (adjustmentHashRows.rows as unknown as AdjustmentHashRow[]).map(
        (row) => `${row.day_record_id}:${row.input_hash}`,
      ),
    );

    const priorRows = await tx.execute(sql`
      select coalesce(sum(equity_kopecks), 0)::text as total
        from day_records
       where tenant_id = ${input.tenantId}
         and project_id = ${input.projectId}
         and date_local < ${input.date}
    `);
    let poolAccruedKopecks = BigInt(firstRow<{ total: string }>(priorRows.rows)?.total ?? "0");

    const membershipIds = [...new Set([...sessionsByMembership.keys(), ...existing.keys()])].sort();

    let created = 0;
    let duplicate = 0;
    let adjusted = 0;

    for (const membershipId of membershipIds) {
      const sessions = sessionsByMembership.get(membershipId) ?? [];
      const previous = existing.get(membershipId);
      const previousDelta = previous ? (adjustmentDelta.get(previous.id) ?? 0n) : 0n;
      const calculation = calculateDay({
        policy,
        date: input.date,
        sessions: sessions as SessionInput[],
        pool: { accruedEquityKopecks: poolAccruedKopecks },
        previous: previous
          ? {
              amountKopecks: BigInt(previous.amount_kopecks),
              paidSeconds: previous.paid_seconds,
              inputHash: previous.input_hash,
              effectiveAmountKopecks: BigInt(previous.amount_kopecks) + previousDelta,
            }
          : null,
      });
      if (!previous) {
        await insertDayRecord(tx, input, membershipId, policyRow.id, calculation, policy, closedAt);
        created += 1;
      } else if (calculation.idempotent) {
        duplicate += 1;
      } else {
        const marker = `${previous.id}:${calculation.inputHash}`;
        if (!adjustmentHashes.has(marker)) {
          await tx.execute(sql`
            insert into day_adjustments
              (tenant_id, day_record_id, delta_kopecks, reason, source, input_hash)
            values (
              ${input.tenantId}, ${previous.id}, ${(calculation.adjustmentKopecks ?? 0n).toString()}::bigint,
              'Пересчет закрытого дня', 'recalc', ${calculation.inputHash}
            )
            on conflict (day_record_id, input_hash) do nothing
          `);
          adjustmentHashes.add(marker);
          await auditDayEvent(tx, input.tenantId, "day.recalculated", {
            date: input.date,
            membershipId,
            inputHash: calculation.inputHash,
            deltaKopecks: (calculation.adjustmentKopecks ?? 0n).toString(),
          });
          adjusted += 1;
        } else {
          duplicate += 1;
        }
      }

      poolAccruedKopecks += calculation.equityKopecks;
    }

    return {
      created,
      duplicate,
      adjusted,
      members: membershipIds.length,
      skipped: false,
    };
  });
}
