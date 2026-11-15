import { z } from "zod";

/**
 * Структурная схема политики проекта (POLICY-SCHEMA).
 *
 * Входные имена — snake_case: так политика хранится в JSONB и совпадает с
 * нормативной спецификацией. Нормализованное представление (camelCase, точные
 * дроби и копейки) собирается в `normalizePolicy`.
 */

const decimal = z.union([z.number(), z.string().min(1)]);
const isoDateTime = z
  .string()
  .datetime({ offset: true, message: "Ожидался ISO-8601 с часовым поясом" });

export const FORGES = ["github", "gitlab", "gitea", "forgejo"] as const;
export const TIME_MODES = ["time_based", "fixed_price", "hybrid"] as const;
export const MANUAL_ONLY_POLICIES = ["track_only", "bill", "ignore"] as const;
export const ACTIVE_MONTH_RULES = ["paid_hours", "amount"] as const;
export const ACCELERATIONS = ["single_trigger_100", "none"] as const;
export const CASH_SCHEDULES = ["monthly", "manual"] as const;

const metaSchema = z.object({
  schema_version: z.string().default("1.0"),
  policy_version: z.number().int().min(1),
  tenant_id: z.string().min(1),
  project_id: z.string().min(1),
  approved_by: z.string().min(1),
  effective_from: isoDateTime,
});

const projectSchema = z.object({
  name: z.string().min(1),
  forge: z.enum(FORGES).default("github"),
  repo: z.string().min(1),
  timezone: z.string().min(1).default("Europe/Moscow"),
  default_branch: z.string().min(1).default("main"),
});

const economicsSchema = z.object({
  valuation_rub: z.number().int().positive(),
  rate_rub_per_hour: z.number().int().positive(),
  currency: z.literal("RUB").default("RUB"),
  pool_pct: decimal,
  founder_floor_pct: decimal.default(70),
  cash_share_pct: decimal.default(0),
  cash_payment_schedule: z.enum(CASH_SCHEDULES).default("monthly"),
  revaluation_notice_days: z.number().int().min(0).default(3),
  pool_info_pct: decimal.default(80),
  pool_warn_pct: decimal.default(90),
});

const timeSchema = z.object({
  mode: z.enum(TIME_MODES).default("time_based"),
  heartbeat_interval_sec: z.number().int().positive().default(30),
  active_window_sec: z.number().int().positive().default(120),
  presence_window_sec: z.number().int().positive().default(600),
  idle_timeout_sec: z.number().int().positive().default(300),
  max_clock_skew_sec: z.number().int().min(0).default(300),
  k_supervised: decimal.default(1),
  k_autonomous: decimal.default(0.2),
  daily_cap_hours: decimal.default(12),
  autonomous_paid_cap_hours: decimal.default(2),
  k_quality_default: decimal.default(1),
  manual_only_policy: z.enum(MANUAL_ONLY_POLICIES).default("track_only"),
  require_task_link: z.boolean().default(true),
});

const daySchema = z.object({
  close_at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ожидался формат HH:MM")
    .default("00:00"),
  late_grace_hours: z.number().int().min(0).default(24),
  dispute_window_days: z.number().int().min(0).default(3),
  digest_hour: z.number().int().min(0).max(23).default(9),
  digest_channels: z
    .array(z.enum(["agent", "email", "telegram", "in_app"]))
    .default(["agent", "email"]),
});

const vestingSchema = z.object({
  enabled: z.boolean().default(true),
  months: z.number().int().positive().default(48),
  cliff_months: z.number().int().min(0).default(12),
  active_month_rule: z.enum(ACTIVE_MONTH_RULES).default("paid_hours"),
  active_month_min_paid_hours: decimal.default(20),
  active_month_min_amount_rub: z.number().int().min(0).default(10_000),
  cash_vesting: z.boolean().default(false),
  acceleration: z.enum(ACCELERATIONS).default("single_trigger_100"),
  control_change_threshold_pct: decimal.default(50),
  inactive_pause_months: z.number().int().min(0).default(3),
});

const rateVersionSchema = z.object({
  id: z.string().min(1).optional(),
  effective_from: isoDateTime,
  value: z.number().int().positive(),
  reason: z.string().min(1),
  approved_by: z.string().min(1),
});

const valuationVersionSchema = z.object({
  id: z.string().min(1).optional(),
  effective_from: isoDateTime,
  value: z.number().int().positive(),
  reason: z.string().min(1),
  approved_by: z.string().min(1),
  adr_ref: z.string().min(1),
});

const versionsSchema = z.object({
  rate: z.array(rateVersionSchema).min(1),
  valuation: z.array(valuationVersionSchema).min(1),
});

const qualitySchema = z.object({
  enabled: z.boolean().default(false),
  k_default: decimal.default(1),
  k_min: decimal.default(0.5),
  k_max: decimal.default(1.3),
  requires_reason: z.boolean().default(true),
});

const securitySchema = z.object({
  require_signed_events: z.boolean().default(true),
  no_output_flag_hours: decimal.default(3),
  night_autonomous_flag_hours: decimal.default(6),
  synthetic_input_detection: z.boolean().default(true),
});

const identitySchema = z
  .object({
    max_accounts_per_forge: z.number().int().min(1).default(1),
    require_proof: z.boolean().default(true),
    exception_approvers: z.array(z.string().min(1)).default([]),
    exception_min_reason_len: z.number().int().min(0).default(20),
    wip_scope: z.enum(["person", "project"]).default("person"),
  })
  .prefault({});

const storageSchema = z
  .object({
    raw_events_retention_days: z.number().int().positive().default(90),
    git_anchor: z.enum(["daily", "monthly"]).default("monthly"),
    anchor_repo_path: z.string().min(1).default("ledger/"),
  })
  .prefault({});

const legalSchema = z
  .object({
    enabled: z.boolean().default(false),
    jurisdiction: z.string().nullable().default(null),
    entity_name: z.string().nullable().default(null),
    entity_ids: z.record(z.string(), z.string()).nullable().default(null),
    contract_template_ref: z.string().nullable().default(null),
    newco_target_months: z.number().int().min(0).nullable().default(null),
    pd_consent_required: z.boolean().default(true),
  })
  .prefault({});

export const policyDocumentSchema = z.object({
  meta: metaSchema,
  project: projectSchema,
  economics: economicsSchema,
  time: timeSchema,
  day: daySchema.prefault({}),
  vesting: vestingSchema.prefault({}),
  versions: versionsSchema,
  identity: identitySchema,
  quality: qualitySchema.prefault({}),
  storage: storageSchema,
  legal: legalSchema,
  security: securitySchema.prefault({}),
});

export type PolicyDocument = z.infer<typeof policyDocumentSchema>;
export type RateVersionDocument = z.infer<typeof rateVersionSchema>;
export type ValuationVersionDocument = z.infer<typeof valuationVersionSchema>;

/** Дефолтная политика демо-проекта; используется в тестах и seed. */
export function defaultPolicyDocument(overrides: PolicyDocumentOverrides = {}): PolicyDocument {
  const base = policyDocumentSchema.parse({
    meta: {
      schema_version: "1.0",
      policy_version: 1,
      tenant_id: "demo",
      project_id: "demo-project",
      approved_by: "director",
      effective_from: "2026-11-01T00:00:00+03:00",
    },
    project: {
      name: "Демо-проект",
      forge: "github",
      repo: "demo/partner-coder",
      timezone: "Europe/Moscow",
      default_branch: "main",
    },
    economics: {
      valuation_rub: 10_000_000,
      rate_rub_per_hour: 500,
      currency: "RUB",
      pool_pct: 30,
      founder_floor_pct: 70,
      cash_share_pct: 0,
      revaluation_notice_days: 3,
      pool_info_pct: 80,
      pool_warn_pct: 90,
    },
    time: {
      mode: "time_based",
      k_supervised: 1,
      k_autonomous: 0.2,
      daily_cap_hours: 12,
      autonomous_paid_cap_hours: 2,
      heartbeat_interval_sec: 30,
      active_window_sec: 120,
      presence_window_sec: 600,
      idle_timeout_sec: 300,
      max_clock_skew_sec: 300,
      manual_only_policy: "track_only",
      require_task_link: true,
    },
    day: {
      close_at: "00:00",
      late_grace_hours: 24,
      dispute_window_days: 3,
      digest_hour: 9,
      digest_channels: ["agent", "email"],
    },
    vesting: {
      enabled: true,
      months: 48,
      cliff_months: 12,
      active_month_rule: "paid_hours",
      active_month_min_paid_hours: 20,
      active_month_min_amount_rub: 10_000,
      cash_vesting: false,
      acceleration: "single_trigger_100",
      control_change_threshold_pct: 50,
      inactive_pause_months: 3,
    },
    versions: {
      rate: [
        {
          effective_from: "2026-11-01T00:00:00+03:00",
          value: 500,
          reason: "Стартовая ставка часа работы с ИИ-агентом",
          approved_by: "director",
        },
      ],
      valuation: [
        {
          effective_from: "2026-11-01T00:00:00+03:00",
          value: 10_000_000,
          reason: "Стартовая оценка проекта",
          approved_by: "director",
          adr_ref: "ADR-0016",
        },
      ],
    },
    quality: { enabled: false, k_default: 1, k_min: 0.5, k_max: 1.3, requires_reason: true },
    security: {
      require_signed_events: true,
      no_output_flag_hours: 3,
      night_autonomous_flag_hours: 6,
      synthetic_input_detection: true,
    },
  });
  return deepMerge(base, overrides) as PolicyDocument;
}

export type PolicyDocumentOverrides = {
  meta?: Partial<PolicyDocument["meta"]>;
  project?: Partial<PolicyDocument["project"]>;
  economics?: Partial<PolicyDocument["economics"]>;
  time?: Partial<PolicyDocument["time"]>;
  day?: Partial<PolicyDocument["day"]>;
  vesting?: Partial<PolicyDocument["vesting"]>;
  quality?: Partial<PolicyDocument["quality"]>;
  security?: Partial<PolicyDocument["security"]>;
  versions?: {
    rate?: PolicyDocument["versions"]["rate"];
    valuation?: PolicyDocument["versions"]["valuation"];
  };
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch ?? base) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
