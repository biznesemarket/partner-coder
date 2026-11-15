import type { DayClasses, ExplanationNode, PolicyDocument } from "@partner-coder/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  createdAt,
  intDefault,
  jsonArray,
  jsonObject,
  jsonValue,
  shareUnits,
  kopecks,
  tenantId,
  updatedAt,
  uuidPk,
} from "./columns.js";
import {
  adjustmentSource,
  disputeStatus,
  forge,
  intervalClass,
  intervalSource,
  membershipRole,
  payoutStatus,
  paymentMethod,
  projectStatus,
  workSessionStatus,
} from "./enums.js";
import { devices, memberships, tenants, users } from "./identity.js";

export interface DayVersions {
  readonly policyVersionId: string;
  readonly rateVersionIds: readonly string[];
  readonly valuationVersionId: string;
}

export interface DayExplanation {
  readonly [key: string]: unknown;
}

export const projects = pgTable(
  "projects",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    forge: forge("forge").notNull().default("github"),
    repo: text("repo").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    timezone: text("timezone").notNull().default("Europe/Moscow"),
    status: projectStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("projects_tenant_forge_repo_uq").on(t.tenantId, t.forge, t.repo),
    index("projects_tenant_status_idx").on(t.tenantId, t.status),
    check("projects_repo_len_chk", sql`length(${t.repo}) between 1 and 255`),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    role: membershipRole("role").notNull().default("developer"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "project_members_pk", columns: [t.projectId, t.membershipId] }),
    index("project_members_membership_idx").on(t.membershipId),
  ],
);

export const policies = pgTable(
  "policies",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    params: jsonValue<PolicyDocument>("params"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 3 }).notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("policies_project_version_uq").on(t.projectId, t.version),
    index("policies_tenant_effective_idx").on(t.tenantId, t.effectiveFrom),
    check("policies_version_chk", sql`${t.version} >= 1`),
    check("policies_sha256_chk", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const rateVersions = pgTable(
  "rate_versions",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "restrict" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 3 }).notNull(),
    valueKopecks: kopecks("value_kopecks"),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("rate_versions_policy_effective_uq").on(t.policyId, t.effectiveFrom),
    index("rate_versions_tenant_idx").on(t.tenantId),
    check("rate_versions_value_chk", sql`${t.valueKopecks} > 0`),
    check("rate_versions_reason_chk", sql`length(${t.reason}) >= 5`),
  ],
);

export const valuationVersions = pgTable(
  "valuation_versions",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "restrict" }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 3 }).notNull(),
    valueKopecks: kopecks("value_kopecks"),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    adrRef: text("adr_ref").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("valuation_versions_policy_effective_uq").on(t.policyId, t.effectiveFrom),
    index("valuation_versions_tenant_idx").on(t.tenantId),
    check("valuation_versions_value_chk", sql`${t.valueKopecks} > 0`),
    check("valuation_versions_reason_chk", sql`length(${t.reason}) >= 5`),
    check("valuation_versions_adr_chk", sql`length(${t.adrRef}) >= 1`),
  ],
);

export const workSessions = pgTable(
  "work_sessions",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "restrict" }),
    taskRef: text("task_ref"),
    branch: text("branch"),
    status: workSessionStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 3 }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("work_sessions_tenant_member_start_idx").on(t.tenantId, t.membershipId, t.startedAt),
    index("work_sessions_project_start_idx").on(t.projectId, t.startedAt),
    index("work_sessions_status_idx").on(t.status),
    check("work_sessions_period_chk", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const heartbeats = pgTable(
  "heartbeats",
  {
    eventId: uuid("event_id").primaryKey(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "restrict" }),
    seq: integer("seq").notNull(),
    class: intervalClass("class").notNull(),
    startUtc: timestamp("start_utc", { withTimezone: true, precision: 3 }).notNull(),
    endUtc: timestamp("end_utc", { withTimezone: true, precision: 3 }).notNull(),
    clientTime: timestamp("client_time", { withTimezone: true, precision: 3 }),
    receivedAt: timestamp("received_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    signals: jsonObject<Record<string, number>>("signals"),
    signatureValid: boolean("signature_valid").notNull().default(false),
    late: boolean("late").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("heartbeats_session_seq_uq").on(t.sessionId, t.seq),
    index("heartbeats_session_received_idx").on(t.sessionId, t.receivedAt),
    index("heartbeats_tenant_received_idx").on(t.tenantId, t.receivedAt),
    check("heartbeats_period_chk", sql`${t.endUtc} > ${t.startUtc}`),
    check("heartbeats_seq_chk", sql`${t.seq} >= 0`),
  ],
);

export const intervals = pgTable(
  "intervals",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "restrict" }),
    class: intervalClass("class").notNull(),
    startUtc: timestamp("start_utc", { withTimezone: true, precision: 3 }).notNull(),
    endUtc: timestamp("end_utc", { withTimezone: true, precision: 3 }).notNull(),
    seconds: integer("seconds").notNull(),
    source: intervalSource("source").notNull().default("agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("intervals_tenant_start_idx").on(t.tenantId, t.startUtc),
    index("intervals_session_start_idx").on(t.sessionId, t.startUtc),
    check("intervals_period_chk", sql`${t.endUtc} > ${t.startUtc}`),
    check("intervals_seconds_chk", sql`${t.seconds} >= 0`),
  ],
);

export const dayRecords = pgTable(
  "day_records",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    dateLocal: date("date_local", { mode: "string" }).notNull(),
    timezone: text("timezone").notNull(),
    paidSeconds: integer("paid_seconds").notNull(),
    trackedSeconds: intDefault("tracked_seconds", 0),
    classes: jsonObject<DayClasses>("classes"),
    amountKopecks: kopecks("amount_kopecks"),
    cashKopecks: kopecks("cash_kopecks"),
    equityKopecks: kopecks("equity_kopecks"),
    shareBp: shareUnits("share_bp"),
    poolUsedBp: integer("pool_used_bp").notNull().default(0),
    poolPending: boolean("pool_pending").notNull().default(false),
    pendingEquityKopecks: kopecks("pending_equity_kopecks"),
    versions: jsonObject<DayVersions>("versions"),
    inputHash: text("input_hash").notNull(),
    explanation: jsonObject<ExplanationNode | DayExplanation>("explanation"),
    closedAt: timestamp("closed_at", { withTimezone: true, precision: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("day_records_tenant_project_member_date_uq").on(
      t.tenantId,
      t.projectId,
      t.membershipId,
      t.dateLocal,
    ),
    index("day_records_tenant_date_idx").on(t.tenantId, t.dateLocal),
    index("day_records_project_date_idx").on(t.projectId, t.dateLocal),
    check("day_records_paid_seconds_chk", sql`${t.paidSeconds} >= 0`),
    check("day_records_tracked_seconds_chk", sql`${t.trackedSeconds} >= 0`),
    check("day_records_amount_chk", sql`${t.amountKopecks} >= 0`),
    check("day_records_cash_chk", sql`${t.cashKopecks} >= 0`),
    check("day_records_equity_chk", sql`${t.equityKopecks} >= 0`),
    check("day_records_split_chk", sql`${t.cashKopecks} + ${t.equityKopecks} = ${t.amountKopecks}`),
    check("day_records_share_chk", sql`${t.shareBp} >= 0`),
    check("day_records_pool_used_chk", sql`${t.poolUsedBp} >= 0`),
    check("day_records_input_hash_chk", sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const dayAdjustments = pgTable(
  "day_adjustments",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    dayRecordId: uuid("day_record_id")
      .notNull()
      .references(() => dayRecords.id, { onDelete: "restrict" }),
    deltaKopecks: bigint("delta_kopecks", { mode: "bigint" }).notNull(),
    reason: text("reason").notNull(),
    source: adjustmentSource("source").notNull().default("recalc"),
    inputHash: text("input_hash").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("day_adjustments_record_hash_uq").on(t.dayRecordId, t.inputHash),
    index("day_adjustments_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("day_adjustments_reason_chk", sql`length(${t.reason}) >= 5`),
    check("day_adjustments_input_hash_chk", sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const dayFlags = pgTable(
  "day_flags",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    dayRecordId: uuid("day_record_id")
      .notNull()
      .references(() => dayRecords.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    detail: text("detail").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("day_flags_record_code_uq").on(t.dayRecordId, t.code),
    index("day_flags_tenant_code_idx").on(t.tenantId, t.code),
  ],
);

export const disputes = pgTable(
  "disputes",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    dayRecordId: uuid("day_record_id")
      .notNull()
      .references(() => dayRecords.id, { onDelete: "restrict" }),
    openedBy: uuid("opened_by").references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    intervalRefs: jsonArray<string>("interval_refs"),
    status: disputeStatus("status").notNull().default("open"),
    deadline: timestamp("deadline", { withTimezone: true, precision: 3 }).notNull(),
    resolution: text("resolution"),
    deltaKopecks: bigint("delta_kopecks", { mode: "bigint" }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("disputes_tenant_status_idx").on(t.tenantId, t.status),
    index("disputes_record_idx").on(t.dayRecordId),
    check("disputes_reason_chk", sql`length(${t.reason}) >= 5`),
  ],
);

export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    period: text("period").notNull(),
    status: payoutStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    paidAt: timestamp("paid_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payout_batches_tenant_period_uq").on(t.tenantId, t.period),
    check("payout_batches_period_chk", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

export const payoutItems = pgTable(
  "payout_items",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => payoutBatches.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    amountKopecks: kopecks("amount_kopecks"),
    method: paymentMethod("method").notNull().default("bank_transfer"),
    reference: text("reference"),
    paidAt: timestamp("paid_at", { withTimezone: true, precision: 3 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payout_items_batch_member_uq").on(t.batchId, t.membershipId),
    index("payout_items_tenant_idx").on(t.tenantId),
    check("payout_items_amount_chk", sql`${t.amountKopecks} >= 0`),
  ],
);

export const monthlySnapshots = pgTable(
  "monthly_snapshots",
  {
    id: uuidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "restrict" }),
    month: date("month", { mode: "string" }).notNull(),
    sha256: text("sha256").notNull(),
    payload: jsonValue<Record<string, unknown>>("payload"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("monthly_snapshots_tenant_month_uq").on(t.tenantId, t.month),
    check("monthly_snapshots_month_chk", sql`${t.month} = date_trunc('month', ${t.month})::date`),
    check("monthly_snapshots_sha256_chk", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
