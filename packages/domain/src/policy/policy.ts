import { parseDecimal, percentToBasisPoints } from "../decimal.js";
import { add, mul, ratio, type Ratio } from "../rational.js";
import { isValidTimeZone } from "../time/timezone.js";
import type { BasisPoints } from "../units.js";
import {
  policyDocumentSchema,
  type PolicyDocument,
  type RateVersionDocument,
  type ValuationVersionDocument,
} from "./schema.js";
import {
  activeVersion,
  parseInstant,
  type RateVersion,
  type ValuationVersion,
} from "./versions.js";

/** Нормализованная политика: точные дроби и копейки, готова к расчету. */
export interface ProjectPolicy {
  readonly meta: {
    readonly schemaVersion: string;
    readonly policyVersion: number;
    readonly tenantId: string;
    readonly projectId: string;
    readonly approvedBy: string;
    readonly effectiveFrom: string;
    readonly effectiveFromMs: number;
  };
  readonly project: {
    readonly name: string;
    readonly forge: PolicyDocument["project"]["forge"];
    readonly repo: string;
    readonly timezone: string;
    readonly defaultBranch: string;
  };
  readonly economics: {
    readonly currency: "RUB";
    readonly currentRateKopecksPerHour: bigint;
    readonly currentValuationKopecks: bigint;
    readonly poolPctBp: BasisPoints;
    readonly founderFloorPctBp: BasisPoints;
    readonly cashShareBp: BasisPoints;
    readonly poolInfoPctBp: BasisPoints;
    readonly poolWarnPctBp: BasisPoints;
    readonly revaluationNoticeDays: number;
    readonly cashPaymentSchedule: "monthly" | "manual";
  };
  readonly time: {
    readonly mode: "time_based" | "fixed_price" | "hybrid";
    readonly heartbeatIntervalSec: number;
    readonly activeWindowSec: number;
    readonly presenceWindowSec: number;
    readonly idleTimeoutSec: number;
    readonly maxClockSkewSec: number;
    readonly kSupervised: Ratio;
    readonly kAutonomous: Ratio;
    readonly dailyCapSeconds: Ratio;
    readonly autonomousPaidCapSeconds: Ratio;
    readonly kQualityDefault: Ratio;
    readonly manualOnlyPolicy: "track_only" | "bill" | "ignore";
    readonly requireTaskLink: boolean;
  };
  readonly day: {
    readonly closeAt: string;
    readonly lateGraceHours: number;
    readonly lateGraceSeconds: number;
    readonly disputeWindowDays: number;
    readonly digestHour: number;
    readonly digestChannels: readonly string[];
  };
  readonly vesting: {
    readonly enabled: boolean;
    readonly months: number;
    readonly cliffMonths: number;
    readonly activeMonthRule: "paid_hours" | "amount";
    readonly activeMonthMinPaidHours: Ratio;
    readonly activeMonthMinAmountKopecks: bigint;
    readonly cashVesting: boolean;
    readonly acceleration: "single_trigger_100" | "none";
    readonly controlChangeThresholdPct: Ratio;
    readonly inactivePauseMonths: number;
  };
  readonly quality: {
    readonly enabled: boolean;
    readonly kDefault: Ratio;
    readonly kMin: Ratio;
    readonly kMax: Ratio;
    readonly requiresReason: boolean;
  };
  readonly security: {
    readonly requireSignedEvents: boolean;
    readonly noOutputFlagHours: Ratio;
    readonly nightAutonomousFlagHours: Ratio;
    readonly syntheticInputDetection: boolean;
  };
  readonly versions: {
    readonly rate: readonly RateVersion[];
    readonly valuation: readonly ValuationVersion[];
  };
}

export interface PolicyIssue {
  code: string;
  path: string;
  message: string;
}

export class PolicyValidationError extends Error {
  constructor(readonly issues: readonly PolicyIssue[]) {
    super(
      `Политика не прошла валидацию (${issues.length}):\n${issues
        .map((issue) => `  - [${issue.code}] ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "PolicyValidationError";
  }
}

function toBasisPoints(value: string | number, path: string, issues: PolicyIssue[]): BasisPoints {
  try {
    return percentToBasisPoints(value);
  } catch {
    issues.push({
      code: "P-precision",
      path,
      message: `процент ${value} не представим в целых базисных пунктах (максимум 2 знака)`,
    });
    return 0n;
  }
}

function toRatio(value: string | number, path: string, issues: PolicyIssue[]): Ratio {
  try {
    return parseDecimal(value);
  } catch {
    issues.push({
      code: "P-decimal",
      path,
      message: `некорректное десятичное значение "${value}"`,
    });
    return ratio(0n);
  }
}

/** V-01…V-08 и кросс-полевые проверки. Возвращает все найденные нарушения. */
export function validatePolicy(doc: PolicyDocument): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const referenceMs = parseInstant(doc.meta.effective_from);

  for (const kind of ["rate", "valuation"] as const) {
    const versions = doc.versions[kind];
    if (versions.length === 0) {
      issues.push({ code: "V-01", path: `versions.${kind}`, message: "нужна хотя бы одна версия" });
    }
    let previousMs = Number.NEGATIVE_INFINITY;
    versions.forEach((version, index) => {
      const path = `versions.${kind}[${index}]`;
      const ms = Date.parse(version.effective_from);
      if (Number.isNaN(ms)) {
        issues.push({ code: "V-02", path: `${path}.effective_from`, message: "некорректная дата" });
        return;
      }
      if (ms <= previousMs) {
        issues.push({
          code: "V-02",
          path: `${path}.effective_from`,
          message: "версии должны строго возрастать по времени вступления",
        });
      }
      previousMs = ms;
      if (version.value <= 0) {
        issues.push({ code: "V-03", path: `${path}.value`, message: "значение должно быть > 0" });
      }
      if (version.reason.trim().length < 5) {
        issues.push({
          code: "V-06",
          path: `${path}.reason`,
          message: "причина минимум 5 символов",
        });
      }
      if (version.approved_by.trim().length === 0) {
        issues.push({
          code: "V-06",
          path: `${path}.approved_by`,
          message: "не указан утвердивший",
        });
      }
      if (
        kind === "valuation" &&
        (version as ValuationVersionDocument).adr_ref.trim().length === 0
      ) {
        issues.push({ code: "V-05", path: `${path}.adr_ref`, message: "оценке нужен ADR" });
      }
    });
  }

  // V-07 / V-08: текущие значения совпадают с версией, действующей на момент создания политики.
  const rateVersions = normalizeRateVersions(doc);
  const valuationVersions = normalizeValuationVersions(doc);
  if (rateVersions.length > 0) {
    try {
      const active = activeVersion(rateVersions, referenceMs, "ставки");
      if (active.valueKopecksPerHour !== BigInt(doc.economics.rate_rub_per_hour) * 100n) {
        issues.push({
          code: "V-07",
          path: "economics.rate_rub_per_hour",
          message: `текущая ставка ${doc.economics.rate_rub_per_hour} ₽ не совпадает с действующей версией`,
        });
      }
    } catch {
      issues.push({
        code: "V-07",
        path: "versions.rate",
        message: "нет версии ставки, действующей на effective_from политики",
      });
    }
  }
  if (valuationVersions.length > 0) {
    try {
      const active = activeVersion(valuationVersions, referenceMs, "оценки");
      if (active.valueKopecks !== BigInt(doc.economics.valuation_rub) * 100n) {
        issues.push({
          code: "V-08",
          path: "economics.valuation_rub",
          message: `текущая оценка ${doc.economics.valuation_rub} ₽ не совпадает с действующей версией`,
        });
      }
    } catch {
      issues.push({
        code: "V-08",
        path: "versions.valuation",
        message: "нет версии оценки, действующей на effective_from политики",
      });
    }
  }

  const poolBp = toBasisPoints(doc.economics.pool_pct, "economics.pool_pct", issues);
  const founderBp = toBasisPoints(
    doc.economics.founder_floor_pct,
    "economics.founder_floor_pct",
    issues,
  );
  const cashBp = toBasisPoints(doc.economics.cash_share_pct, "economics.cash_share_pct", issues);
  const infoBp = toBasisPoints(doc.economics.pool_info_pct, "economics.pool_info_pct", issues);
  const warnBp = toBasisPoints(doc.economics.pool_warn_pct, "economics.pool_warn_pct", issues);
  const dailyCap = toRatio(doc.time.daily_cap_hours, "time.daily_cap_hours", issues);
  const autoCap = toRatio(
    doc.time.autonomous_paid_cap_hours,
    "time.autonomous_paid_cap_hours",
    issues,
  );
  const kSupervised = toRatio(doc.time.k_supervised, "time.k_supervised", issues);
  const kAutonomous = toRatio(doc.time.k_autonomous, "time.k_autonomous", issues);

  if (poolBp + founderBp > 10_000n) {
    issues.push({
      code: "C-pool-sum",
      path: "economics.pool_pct",
      message: "пул + пол основателя не могут превышать 100 %",
    });
  }
  if (cashBp < 0n || cashBp > 10_000n) {
    issues.push({
      code: "C-cash-range",
      path: "economics.cash_share_pct",
      message: "денежная доля должна быть в диапазоне 0…100 %",
    });
  }
  if (infoBp >= warnBp || warnBp > 10_000n) {
    issues.push({
      code: "C-pool-thresholds",
      path: "economics.pool_info_pct",
      message: "пороги пула должны возрастать: info < warn ≤ 100 %",
    });
  }
  if (dailyCap.n * autoCap.d <= autoCap.n * dailyCap.d) {
    issues.push({
      code: "C-caps",
      path: "time.autonomous_paid_cap_hours",
      message: "кап автономного класса не может превышать дневной кап",
    });
  }
  for (const [path, value] of [
    ["time.k_supervised", kSupervised],
    ["time.k_autonomous", kAutonomous],
  ] as const) {
    if (value.n < 0n || value.n > value.d * 3n) {
      issues.push({
        code: "C-koef-range",
        path,
        message: "коэффициент должен быть в диапазоне 0…3",
      });
    }
  }
  if (!isValidTimeZone(doc.project.timezone)) {
    issues.push({
      code: "C-timezone",
      path: "project.timezone",
      message: `неизвестный часовой пояс "${doc.project.timezone}"`,
    });
  }
  if (doc.vesting.cliff_months > doc.vesting.months) {
    issues.push({
      code: "C-vesting",
      path: "vesting.cliff_months",
      message: "клифф не может быть больше полного срока вестинга",
    });
  }
  if (doc.time.manual_only_policy === "bill") {
    issues.push({
      code: "C-manual-bill",
      path: "time.manual_only_policy",
      message: "режим bill зарезервирован и не поддерживается без ADR",
    });
  }

  return issues;
}

/** Парсит, валидирует и нормализует документ политики. */
export function loadPolicy(raw: unknown): ProjectPolicy {
  const parsed = policyDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PolicyValidationError(
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  const issues = validatePolicy(parsed.data);
  if (issues.length > 0) {
    throw new PolicyValidationError(issues);
  }
  return normalizePolicy(parsed.data);
}

export function normalizePolicy(doc: PolicyDocument): ProjectPolicy {
  const referenceMs = parseInstant(doc.meta.effective_from);
  const rateVersions = normalizeRateVersions(doc);
  const valuationVersions = normalizeValuationVersions(doc);
  const activeRate = activeVersion(rateVersions, referenceMs, "ставки");
  const activeValuation = activeVersion(valuationVersions, referenceMs, "оценки");

  return {
    meta: {
      schemaVersion: doc.meta.schema_version,
      policyVersion: doc.meta.policy_version,
      tenantId: doc.meta.tenant_id,
      projectId: doc.meta.project_id,
      approvedBy: doc.meta.approved_by,
      effectiveFrom: doc.meta.effective_from,
      effectiveFromMs: referenceMs,
    },
    project: {
      name: doc.project.name,
      forge: doc.project.forge,
      repo: doc.project.repo,
      timezone: doc.project.timezone,
      defaultBranch: doc.project.default_branch,
    },
    economics: {
      currency: doc.economics.currency,
      currentRateKopecksPerHour: activeRate.valueKopecksPerHour,
      currentValuationKopecks: activeValuation.valueKopecks,
      poolPctBp: percentToBasisPoints(doc.economics.pool_pct),
      founderFloorPctBp: percentToBasisPoints(doc.economics.founder_floor_pct),
      cashShareBp: percentToBasisPoints(doc.economics.cash_share_pct),
      poolInfoPctBp: percentToBasisPoints(doc.economics.pool_info_pct),
      poolWarnPctBp: percentToBasisPoints(doc.economics.pool_warn_pct),
      revaluationNoticeDays: doc.economics.revaluation_notice_days,
      cashPaymentSchedule: doc.economics.cash_payment_schedule,
    },
    time: {
      mode: doc.time.mode,
      heartbeatIntervalSec: doc.time.heartbeat_interval_sec,
      activeWindowSec: doc.time.active_window_sec,
      presenceWindowSec: doc.time.presence_window_sec,
      idleTimeoutSec: doc.time.idle_timeout_sec,
      maxClockSkewSec: doc.time.max_clock_skew_sec,
      kSupervised: parseDecimal(doc.time.k_supervised),
      kAutonomous: parseDecimal(doc.time.k_autonomous),
      dailyCapSeconds: mul(parseDecimal(doc.time.daily_cap_hours), ratio(3600n)),
      autonomousPaidCapSeconds: mul(parseDecimal(doc.time.autonomous_paid_cap_hours), ratio(3600n)),
      kQualityDefault: parseDecimal(doc.time.k_quality_default),
      manualOnlyPolicy: doc.time.manual_only_policy,
      requireTaskLink: doc.time.require_task_link,
    },
    day: {
      closeAt: doc.day.close_at,
      lateGraceHours: doc.day.late_grace_hours,
      lateGraceSeconds: doc.day.late_grace_hours * 3600,
      disputeWindowDays: doc.day.dispute_window_days,
      digestHour: doc.day.digest_hour,
      digestChannels: doc.day.digest_channels,
    },
    vesting: {
      enabled: doc.vesting.enabled,
      months: doc.vesting.months,
      cliffMonths: doc.vesting.cliff_months,
      activeMonthRule: doc.vesting.active_month_rule,
      activeMonthMinPaidHours: parseDecimal(doc.vesting.active_month_min_paid_hours),
      activeMonthMinAmountKopecks: BigInt(doc.vesting.active_month_min_amount_rub) * 100n,
      cashVesting: doc.vesting.cash_vesting,
      acceleration: doc.vesting.acceleration,
      controlChangeThresholdPct: parseDecimal(doc.vesting.control_change_threshold_pct),
      inactivePauseMonths: doc.vesting.inactive_pause_months,
    },
    quality: {
      enabled: doc.quality.enabled,
      kDefault: parseDecimal(doc.quality.k_default),
      kMin: parseDecimal(doc.quality.k_min),
      kMax: parseDecimal(doc.quality.k_max),
      requiresReason: doc.quality.requires_reason,
    },
    security: {
      requireSignedEvents: doc.security.require_signed_events,
      noOutputFlagHours: parseDecimal(doc.security.no_output_flag_hours),
      nightAutonomousFlagHours: parseDecimal(doc.security.night_autonomous_flag_hours),
      syntheticInputDetection: doc.security.synthetic_input_detection,
    },
    versions: { rate: rateVersions, valuation: valuationVersions },
  };
}

function normalizeRateVersions(doc: PolicyDocument): RateVersion[] {
  const policyVersion = doc.meta.policy_version;
  return doc.versions.rate.map((version: RateVersionDocument, index) => ({
    id: version.id ?? `${policyVersion}:rate:${index}`,
    effectiveFrom: version.effective_from,
    effectiveFromMs: parseInstant(version.effective_from),
    value: BigInt(version.value) * 100n,
    valueKopecksPerHour: BigInt(version.value) * 100n,
    reason: version.reason,
    approvedBy: version.approved_by,
  }));
}

function normalizeValuationVersions(doc: PolicyDocument): ValuationVersion[] {
  const policyVersion = doc.meta.policy_version;
  return doc.versions.valuation.map((version: ValuationVersionDocument, index) => ({
    id: version.id ?? `${policyVersion}:valuation:${index}`,
    effectiveFrom: version.effective_from,
    effectiveFromMs: parseInstant(version.effective_from),
    value: BigInt(version.value) * 100n,
    valueKopecks: BigInt(version.value) * 100n,
    reason: version.reason,
    approvedBy: version.approved_by,
    adrRef: version.adr_ref,
  }));
}

/**
 * Форвард-онли обновление политики (V-04, инвариант 5):
 * существующие версии менять нельзя, новые не могут действовать раньше
 * начала текущих открытых суток.
 */
export function validatePolicyUpdate(
  previous: ProjectPolicy,
  next: PolicyDocument,
  atMs: number,
  timeZone: string,
  startOfDayMs: number,
): PolicyIssue[] {
  const issues = validatePolicy(next);
  const previousRate = new Map(previous.versions.rate.map((v) => [v.effectiveFrom, v.value]));
  const previousValuation = new Map(
    previous.versions.valuation.map((v) => [v.effectiveFrom, v.value]),
  );

  for (const version of next.versions.rate) {
    const before = previousRate.get(version.effective_from);
    if (before === undefined) continue;
    if (before !== BigInt(version.value) * 100n) {
      issues.push({
        code: "C-immutable",
        path: `versions.rate[${version.effective_from}]`,
        message: "существующую версию ставки нельзя менять",
      });
    }
  }
  for (const version of next.versions.valuation) {
    const before = previousValuation.get(version.effective_from);
    if (before === undefined) continue;
    if (before !== BigInt(version.value) * 100n) {
      issues.push({
        code: "C-immutable",
        path: `versions.valuation[${version.effective_from}]`,
        message: "существующую версию оценки нельзя менять",
      });
    }
  }
  for (const version of [...next.versions.rate, ...next.versions.valuation]) {
    const ms = Date.parse(version.effective_from);
    if (!Number.isNaN(ms) && ms < startOfDayMs) {
      issues.push({
        code: "V-04",
        path: "versions",
        message: `версия не может вступать в силу задним числом (${version.effective_from}, пояс ${timeZone}, сейчас ${new Date(atMs).toISOString()})`,
      });
    }
  }
  return issues;
}

/** Суммарная доля пула и пола основателя (для отображения). */
export function describePolicyTotals(policy: ProjectPolicy): {
  poolPercent: string;
  founderPercent: string;
  cashSharePercent: string;
  combinedPercent: string;
} {
  const combined = add(
    ratio(policy.economics.poolPctBp),
    ratio(policy.economics.founderFloorPctBp),
  );
  return {
    poolPercent: (Number(policy.economics.poolPctBp) / 100).toFixed(2),
    founderPercent: (Number(policy.economics.founderFloorPctBp) / 100).toFixed(2),
    cashSharePercent: (Number(policy.economics.cashShareBp) / 100).toFixed(2),
    combinedPercent: (Number(combined.n) / Number(combined.d)).toFixed(2),
  };
}
