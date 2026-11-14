import {
  add,
  cmp,
  div,
  mul,
  ratio,
  roundHalfUp,
  sub,
  RATIO_ZERO,
  type Ratio,
} from "../rational.js";
import { parseDecimal } from "../decimal.js";
import {
  classMilliseconds,
  clipIntervals,
  splitAtBoundaries,
  unionTimeline,
  type IntervalClass,
  type TimelineInterval,
} from "../time/intervals.js";
import {
  dayWindowUtc,
  parseLocalDate,
  addLocalDays,
  zonedTimeToUtcMs,
  type DayWindow,
} from "../time/timezone.js";
import { activeVersion, versionBoundariesWithin } from "../policy/versions.js";
import type { ProjectPolicy } from "../policy/policy.js";
import { CalculatorError } from "../errors.js";
import { flag, type DayFlag } from "../flags.js";
import { hashObject } from "../hash.js";
import { poolStatus } from "./pool.js";
import type { BasisPoints, Kopecks, ShareUnits } from "../units.js";
import { explain, type ExplanationNode } from "../explain.js";

/**
 * Дневной расчет (R1–R16).
 *
 * Порядок строго детерминирован:
 * 1. классификация (интервалы приходят уже классифицированными),
 * 2. union пересечений (R3),
 * 3. разрез по полуночи и смене ставки (R4),
 * 4. коэффициенты классов,
 * 5. кап автономного класса, затем дневной кап (R5),
 * 6. деньги (R1/R6), cash/equity (R8), доля (R7), пул (R12/R15), флаги (R16).
 */

export type IntervalSource = "agent" | "ide" | "manual";

export interface InputInterval {
  class: IntervalClass;
  /** ISO-8601 с часовым поясом или Z. */
  start: string;
  end: string;
  source?: IntervalSource;
  /** Серверное время приема; по умолчанию равно `end`. */
  receivedAt?: string;
}

export interface SessionInput {
  id: string;
  membershipId: string;
  /** Привязка к задаче; без нее время не оплачивается (R9). */
  taskRef?: string | null;
  branch?: string | null;
  intervals: readonly InputInterval[];
}

export interface DayFacts {
  toolCalls?: number;
  commits?: number;
  pullRequestDiffs?: number;
  deviceClockSkewSeconds?: number;
  replayDetected?: boolean;
  syntheticInputDetected?: boolean;
}

export interface QualityAdjustment {
  kQuality: string | number;
  reason: string;
}

export interface PoolSnapshot {
  /** Накопленный вклад участников до текущего дня, копейки. */
  accruedEquityKopecks: Kopecks;
}

export interface ClosedDaySnapshot {
  amountKopecks: Kopecks;
  paidSeconds: number;
  inputHash: string;
  /** База + компенсирующие корректировки на момент пересчета. */
  effectiveAmountKopecks?: Kopecks;
}

export interface CalculateDayInput {
  policy: ProjectPolicy;
  /** Локальная дата YYYY-MM-DD. */
  date: string;
  sessions: readonly SessionInput[];
  facts?: DayFacts;
  quality?: QualityAdjustment | null;
  pool?: PoolSnapshot | null;
  previous?: ClosedDaySnapshot | null;
}

export interface DayClasses {
  activeSeconds: number;
  supervisedSeconds: number;
  autonomousSeconds: number;
  idleSeconds: number;
}

export interface DayCalculation {
  date: string;
  timezone: string;
  window: { startUtc: string; endUtc: string; durationSeconds: number };
  paidSeconds: number;
  /** Учтенные секунды, которые не оплачиваются (без задачи, без агента, поздние). */
  trackedSeconds: number;
  classes: DayClasses;
  caps: { dailyApplied: boolean; autonomousApplied: boolean };
  amountKopecks: Kopecks;
  cashKopecks: Kopecks;
  equityKopecks: Kopecks;
  shareBp: ShareUnits;
  poolUsedBp: BasisPoints;
  poolPending: boolean;
  /** Рубли, накопленные в pending: доля по ним не растет. */
  pendingEquityKopecks: Kopecks;
  flags: DayFlag[];
  versions: {
    policyVersionId: string;
    rateVersionIds: string[];
    valuationVersionId: string;
  };
  inputHash: string;
  idempotent: boolean;
  /** Компенсация относительно эффективной суммы закрытого дня; null — день новый. */
  adjustmentKopecks: Kopecks | null;
  explanation: ExplanationNode;
}

interface AcceptedSegment extends TimelineInterval {
  rateKopecksPerHour: bigint;
  rateVersionId: string;
}

interface LabelledInterval extends TimelineInterval {
  membershipId: string;
  sessionId: string;
}

const PAYMENT_CLASSES: readonly IntervalClass[] = [
  "active_human",
  "supervised_agent",
  "autonomous_agent",
];

function secondsOf(ms: number): Ratio {
  return ratio(BigInt(ms), 1000n);
}

function msOf(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new CalculatorError("invalid_interval", `Некорректное время интервала "${iso}"`, 400);
  }
  return ms;
}

function classKoef(policy: ProjectPolicy, cls: IntervalClass): Ratio {
  switch (cls) {
    case "active_human":
      return ratio(1n);
    case "supervised_agent":
      return policy.time.kSupervised;
    case "autonomous_agent":
      return policy.time.kAutonomous;
    case "idle":
      return RATIO_ZERO;
  }
}

export function calculateDay(input: CalculateDayInput): DayCalculation {
  const { policy, date } = input;
  const timezone = policy.project.timezone;
  const window = dayWindowUtc(date, timezone);

  const valuation = activeVersion(policy.versions.valuation, window.startMs, "оценки");
  const rateBoundaries = versionBoundariesWithin(
    policy.versions.rate,
    window.startMs,
    window.endMs,
  );

  const flags: DayFlag[] = [];
  const paidCandidates: LabelledInterval[] = [];
  const unpaidTracked: LabelledInterval[] = [];
  const idleIntervals: LabelledInterval[] = [];

  let lateRejected = 0;
  let lateArrival = false;
  let noTaskLinkCount = 0;
  let manualTrackedMs = 0;

  for (const session of input.sessions) {
    const taskLinked = Boolean(session.taskRef && session.branch);
    for (const interval of session.intervals) {
      const startMs = msOf(interval.start);
      const endMs = msOf(interval.end);
      if (endMs === startMs) {
        // Пустой интервал не несет времени и пропускается.
        continue;
      }
      if (endMs < startMs) {
        throw new CalculatorError(
          "invalid_interval",
          `Интервал сессии ${session.id}: конец раньше начала (${interval.start}…${interval.end})`,
          400,
        );
      }
      const clipped = clipIntervals(
        [{ startMs, endMs, class: interval.class }],
        window.startMs,
        window.endMs,
      );
      const withinDay = clipped[0];
      if (!withinDay) continue;

      const labelled: LabelledInterval = {
        ...withinDay,
        membershipId: session.membershipId,
        sessionId: session.id,
      };

      const receivedMs = interval.receivedAt ? msOf(interval.receivedAt) : endMs;
      if (receivedMs > window.endMs) {
        lateArrival = true;
      }
      const delaySeconds = (receivedMs - endMs) / 1000;
      if (delaySeconds > policy.day.lateGraceSeconds) {
        lateRejected += 1;
        unpaidTracked.push(labelled);
        continue;
      }

      if (interval.class === "idle") {
        idleIntervals.push(labelled);
        continue;
      }

      if (interval.source === "manual") {
        if (policy.time.manualOnlyPolicy === "bill") {
          throw new CalculatorError(
            "manual_only_policy_not_supported",
            "Режим manual_only_policy=bill не реализован: требуется ADR; используйте track_only или ignore",
            422,
          );
        }
        if (policy.time.manualOnlyPolicy === "ignore") {
          continue;
        }
        manualTrackedMs += withinDay.endMs - withinDay.startMs;
        unpaidTracked.push(labelled);
        continue;
      }

      if (policy.time.requireTaskLink && !taskLinked) {
        noTaskLinkCount += 1;
        unpaidTracked.push(labelled);
        continue;
      }

      paidCandidates.push(labelled);
    }
  }

  // R3: пересечения одного человека объединяются, а не суммируются.
  const unioned = unionTimeline(paidCandidates);
  // R4: разрез по смене версии ставки.
  const rateSegments = splitAtBoundaries(unioned, rateBoundaries).map<AcceptedSegment>(
    (segment) => {
      const version = activeVersion(policy.versions.rate, segment.startMs, "ставки");
      return {
        ...segment,
        rateKopecksPerHour: version.valueKopecksPerHour,
        rateVersionId: version.id,
      };
    },
  );

  const rawByClass = new Map<IntervalClass, Ratio>();
  for (const cls of PAYMENT_CLASSES) rawByClass.set(cls, RATIO_ZERO);
  for (const segment of rateSegments) {
    const cls = segment.class;
    rawByClass.set(
      cls,
      add(rawByClass.get(cls) ?? RATIO_ZERO, secondsOf(segment.endMs - segment.startMs)),
    );
  }

  // Взвешенные секунды до капов: активный класс с коэффициентом 1,
  // остальные — со своими коэффициентами политики.
  const weightedRawByClass = new Map<IntervalClass, Ratio>([
    ["active_human", rawByClass.get("active_human") ?? RATIO_ZERO],
    [
      "supervised_agent",
      mul(rawByClass.get("supervised_agent") ?? RATIO_ZERO, policy.time.kSupervised),
    ],
    [
      "autonomous_agent",
      mul(rawByClass.get("autonomous_agent") ?? RATIO_ZERO, policy.time.kAutonomous),
    ],
  ]);

  // R5: кап автономного класса, затем дневной кап.
  let autonomousApplied = false;
  let dailyApplied = false;

  let autonomousPaid = weightedRawByClass.get("autonomous_agent") ?? RATIO_ZERO;
  if (cmp(autonomousPaid, policy.time.autonomousPaidCapSeconds) > 0) {
    autonomousPaid = policy.time.autonomousPaidCapSeconds;
    autonomousApplied = true;
  }

  let activePaid = weightedRawByClass.get("active_human") ?? RATIO_ZERO;
  let supervisedPaid = weightedRawByClass.get("supervised_agent") ?? RATIO_ZERO;

  const totalBeforeCap = add(add(activePaid, supervisedPaid), autonomousPaid);
  if (cmp(totalBeforeCap, policy.time.dailyCapSeconds) > 0) {
    dailyApplied = true;
    let excess = sub(totalBeforeCap, policy.time.dailyCapSeconds);
    // Приоритет усечения: сначала автономный, затем супервизия, затем активный.
    const fromAutonomous = ratioMin(autonomousPaid, excess);
    autonomousPaid = sub(autonomousPaid, fromAutonomous);
    excess = sub(excess, fromAutonomous);
    const fromSupervised = ratioMin(supervisedPaid, excess);
    supervisedPaid = sub(supervisedPaid, fromSupervised);
    excess = sub(excess, fromSupervised);
    const fromActive = ratioMin(activePaid, excess);
    activePaid = sub(activePaid, fromActive);
  }

  const paidByClass = new Map<IntervalClass, Ratio>([
    ["active_human", activePaid],
    ["supervised_agent", supervisedPaid],
    ["autonomous_agent", autonomousPaid],
  ]);

  // Распределение усеченных секунд по отрезкам пропорционально сырому вкладу класса.
  let kopeckSeconds = RATIO_ZERO;
  let paidWeightedSeconds = RATIO_ZERO;
  for (const segment of rateSegments) {
    const rawWeightedSegment = mul(
      secondsOf(segment.endMs - segment.startMs),
      classKoef(policy, segment.class),
    );
    const rawTotal = weightedRawByClass.get(segment.class) ?? RATIO_ZERO;
    const paidTotal = paidByClass.get(segment.class) ?? RATIO_ZERO;
    const allocated =
      rawTotal.n === 0n ? RATIO_ZERO : mul(rawWeightedSegment, div(paidTotal, rawTotal));
    paidWeightedSeconds = add(paidWeightedSeconds, allocated);
    kopeckSeconds = add(kopeckSeconds, mul(allocated, ratio(segment.rateKopecksPerHour)));
  }

  const quality = input.quality ?? null;
  let kQuality = policy.time.kQualityDefault;
  if (quality) {
    const parsed = parseDecimal(quality.kQuality);
    if (parsed.n <= 0n) {
      throw new CalculatorError("policy_violation", "k_quality должен быть больше нуля", 409);
    }
    if (policy.quality.requiresReason && quality.reason.trim().length < 5) {
      throw new CalculatorError(
        "policy_violation",
        "Для k_quality требуется обоснование директора (минимум 5 символов)",
        409,
      );
    }
    kQuality = parsed;
  }

  let amountKopecks = roundHalfUp(div(mul(kopeckSeconds, kQuality), ratio(3600n)));
  if (amountKopecks < 0n) amountKopecks = 0n;

  const replay = input.facts?.replayDetected === true;
  if (replay) {
    amountKopecks = 0n;
    flags.push(flag("replay", "Повтор event_id или нарушение seq: начисление отменено"));
  }

  const cashKopecks = roundHalfUp(
    div(mul(ratio(amountKopecks), ratio(policy.economics.cashShareBp)), ratio(10_000n)),
  );
  const equityKopecks = amountKopecks - cashKopecks;

  const poolInput = input.pool ?? { accruedEquityKopecks: 0n };
  const accruedAfter = poolInput.accruedEquityKopecks + equityKopecks;
  const pool = poolStatus({
    valuationKopecks: valuation.valueKopecks,
    poolPctBp: policy.economics.poolPctBp,
    accruedEquityKopecks: accruedAfter,
  });

  const shareBp = pool.pending
    ? 0n
    : roundHalfUp(div(mul(ratio(equityKopecks), ratio(1_000_000n)), ratio(valuation.valueKopecks)));

  const paidSeconds = numberFromRatioRound(paidWeightedSeconds);

  // Классы: сколько фактически оплачено по каждому классу (в секундах).
  const classes: DayClasses = {
    activeSeconds: numberFromRatioRound(activePaid),
    supervisedSeconds: numberFromRatioRound(supervisedPaid),
    autonomousSeconds: numberFromRatioRound(autonomousPaid),
    idleSeconds: Math.round(classMilliseconds(idleIntervals).idleMs / 1000),
  };

  const trackedUnion = unionTimeline(unpaidTracked);
  let trackedMs = 0;
  for (const interval of trackedUnion) {
    trackedMs += interval.endMs - interval.startMs;
  }
  const trackedSeconds = Math.round(trackedMs / 1000);

  if (autonomousApplied) {
    flags.push(
      flag(
        "autonomous_cap_applied",
        `Автономный класс ограничен ${formatHours(policy.time.autonomousPaidCapSeconds)} ч`,
      ),
    );
  }
  if (dailyApplied) {
    flags.push(flag("cap_applied", `Дневной кап ${formatHours(policy.time.dailyCapSeconds)} ч`));
  }
  if (noTaskLinkCount > 0) {
    flags.push(flag("no_task_link", `Сессий без задачи: ${noTaskLinkCount}`));
  }
  if (manualTrackedMs > 0) {
    flags.push(
      flag(
        "manual_track_only",
        `Работа без агента учтена (${formatSeconds(manualTrackedMs / 1000)}), но не оплачивается`,
      ),
    );
  }
  if (lateRejected > 0) {
    flags.push(
      flag(
        "late_rejected",
        `Поздних событий за пределами грейса: ${lateRejected}; требуется решение директора`,
      ),
    );
  }
  if (lateArrival) {
    flags.push(flag("late_arrival", "События поступили после закрытия суток"));
  }
  if (pool.pending) {
    flags.push(
      flag(
        "pending",
        `Пул исчерпан (${(Number(pool.usedBp) / 100).toFixed(2)} %): рубли копятся, доля не растет`,
      ),
    );
  }

  const facts = input.facts;
  if (facts) {
    const noOutputThreshold = mul(policy.security.noOutputFlagHours, ratio(3600n));
    const outputs = (facts.toolCalls ?? 0) + (facts.commits ?? 0) + (facts.pullRequestDiffs ?? 0);
    if (outputs === 0 && cmp(paidWeightedSeconds, noOutputThreshold) > 0) {
      flags.push(
        flag(
          "no_output",
          "Оплачено больше порога при нулевых коммитах, диффах и вызовах инструментов",
        ),
      );
    }
    if ((facts.deviceClockSkewSeconds ?? 0) > policy.time.maxClockSkewSec) {
      flags.push(
        flag(
          "clock_skew",
          `Расхождение часов ${facts.deviceClockSkewSeconds} с > ${policy.time.maxClockSkewSec} с`,
        ),
      );
    }
    if (facts.syntheticInputDetected === true && policy.security.syntheticInputDetection) {
      flags.push(flag("synthetic_input", "Интервалы ввода без вариативности"));
    }
  }

  const nightAutonomous = nightAutonomousSeconds(rateSegments, window, date, timezone);
  if (cmp(nightAutonomous, mul(policy.security.nightAutonomousFlagHours, ratio(3600n))) > 0) {
    flags.push(
      flag(
        "night_autonomous_spike",
        `Автономно ночью ${formatHours(nightAutonomous)} ч (порог ${formatHours(
          mul(policy.security.nightAutonomousFlagHours, ratio(3600n)),
        )} ч)`,
      ),
    );
  }

  const rateVersionIds = [...new Set(rateSegments.map((segment) => segment.rateVersionId))];
  const inputHash = hashObject({
    tenantId: policy.meta.tenantId,
    projectId: policy.meta.projectId,
    policyVersion: policy.meta.policyVersion,
    date,
    timezone,
    valuationVersionId: valuation.id,
    rateVersionIds,
    sessions: [...input.sessions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((session) => ({
        id: session.id,
        membershipId: session.membershipId,
        taskRef: session.taskRef ?? null,
        branch: session.branch ?? null,
        intervals: [...session.intervals]
          .map((interval) => ({
            class: interval.class,
            start: interval.start,
            end: interval.end,
            source: interval.source ?? "agent",
            receivedAt: interval.receivedAt ?? interval.end,
          }))
          .sort(
            (a, b) =>
              Date.parse(a.start) - Date.parse(b.start) ||
              Date.parse(a.end) - Date.parse(b.end) ||
              a.class.localeCompare(b.class),
          ),
      })),
    facts: input.facts ?? null,
    quality: quality ? { k: String(quality.kQuality), reason: quality.reason } : null,
    poolAccruedKopecks: poolInput.accruedEquityKopecks,
  });

  const idempotent =
    input.previous !== null && input.previous !== undefined
      ? input.previous.inputHash === inputHash
      : false;
  const adjustmentKopecks =
    input.previous !== null && input.previous !== undefined && !idempotent
      ? amountKopecks - (input.previous.effectiveAmountKopecks ?? input.previous.amountKopecks)
      : null;

  const pendingEquityKopecks = pool.pending ? equityKopecks : 0n;

  const explanation = buildExplanation({
    policy,
    window,
    date,
    classes,
    rateSegments,
    caps: { autonomousApplied, dailyApplied },
    amountKopecks,
    cashKopecks,
    equityKopecks,
    shareBp,
    poolUsedBp: pool.usedBp,
    poolPending: pool.pending,
    poolBudgetKopecks: pool.budgetKopecks,
    pendingEquityKopecks,
    kQuality,
    valuationKopecks: valuation.valueKopecks,
    paidSeconds,
    flags,
  });

  return {
    date,
    timezone,
    window: {
      startUtc: new Date(window.startMs).toISOString(),
      endUtc: new Date(window.endMs).toISOString(),
      durationSeconds: Math.round(window.durationMs / 1000),
    },
    paidSeconds,
    trackedSeconds,
    classes,
    caps: { dailyApplied, autonomousApplied },
    amountKopecks,
    cashKopecks,
    equityKopecks,
    shareBp,
    poolUsedBp: pool.usedBp,
    poolPending: pool.pending,
    pendingEquityKopecks,
    flags,
    versions: {
      policyVersionId: `${policy.meta.tenantId}/${policy.meta.projectId}:v${policy.meta.policyVersion}`,
      rateVersionIds,
      valuationVersionId: valuation.id,
    },
    inputHash,
    idempotent,
    adjustmentKopecks,
    explanation,
  };
}

function ratioMin(a: Ratio, b: Ratio): Ratio {
  return cmp(a, b) <= 0 ? a : b;
}

function numberFromRatioRound(value: Ratio): number {
  return Number(roundHalfUp(value));
}

function formatHours(seconds: Ratio): string {
  const hundredths = roundHalfUp(mul(div(seconds, ratio(3600n)), ratio(100n)));
  return (Number(hundredths) / 100).toFixed(2);
}

function formatSeconds(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}

function nightAutonomousSeconds(
  segments: readonly AcceptedSegment[],
  _window: DayWindow,
  date: string,
  timeZone: string,
): Ratio {
  const ranges = nightRanges(date, timeZone);
  let total = RATIO_ZERO;
  for (const segment of segments) {
    if (segment.class !== "autonomous_agent") continue;
    for (const range of ranges) {
      const overlap =
        Math.min(segment.endMs, range.endMs) - Math.max(segment.startMs, range.startMs);
      if (overlap > 0) {
        total = add(total, secondsOf(overlap));
      }
    }
  }
  return total;
}

/** Ночное окно 22:00–06:00 по локальному времени (две части вокруг полуночи). */
function nightRanges(date: string, timeZone: string): { startMs: number; endMs: number }[] {
  const at = (localDate: string, hour: number): number =>
    zonedTimeToUtcMs({ ...parseLocalDate(localDate), hour, minute: 0, second: 0 }, timeZone);
  return [
    { startMs: at(addLocalDays(date, -1), 22), endMs: at(date, 6) },
    { startMs: at(date, 22), endMs: at(addLocalDays(date, 1), 6) },
  ];
}

interface BuildExplanationInput {
  policy: ProjectPolicy;
  window: DayWindow;
  date: string;
  classes: DayClasses;
  rateSegments: readonly AcceptedSegment[];
  caps: { autonomousApplied: boolean; dailyApplied: boolean };
  amountKopecks: Kopecks;
  cashKopecks: Kopecks;
  equityKopecks: Kopecks;
  shareBp: ShareUnits;
  poolUsedBp: BasisPoints;
  poolPending: boolean;
  poolBudgetKopecks: Kopecks;
  pendingEquityKopecks: Kopecks;
  kQuality: Ratio;
  valuationKopecks: Kopecks;
  paidSeconds: number;
  flags: readonly DayFlag[];
}

function buildExplanation(input: BuildExplanationInput): ExplanationNode {
  const { policy } = input;
  const classNodes: ExplanationNode[] = [
    explain(
      "class_active",
      "Активная работа человека",
      `${formatSeconds(input.classes.activeSeconds)} ч × 1.0`,
    ),
    explain(
      "class_supervised",
      "Работа под присмотром",
      `${formatSeconds(input.classes.supervisedSeconds)} ч (k=${ratioText(policy.time.kSupervised)})`,
    ),
    explain(
      "class_autonomous",
      "Автономная работа агента",
      `${formatSeconds(input.classes.autonomousSeconds)} ч (k=${ratioText(policy.time.kAutonomous)})`,
    ),
    explain("class_idle", "Простой", `${formatSeconds(input.classes.idleSeconds)} ч × 0`),
  ];

  const capsNode = explain(
    "caps",
    "Ограничения",
    `дневной ${input.caps.dailyApplied ? "применен" : "не применен"}; автономный ${
      input.caps.autonomousApplied ? "применен" : "не применен"
    }`,
    [
      explain("cap_daily", "Дневной кап", `${formatHours(policy.time.dailyCapSeconds)} ч`),
      explain(
        "cap_autonomous",
        "Кап автономного класса",
        `${formatHours(policy.time.autonomousPaidCapSeconds)} ч`,
      ),
    ],
  );

  const rateNodes = input.rateSegments.map((segment) =>
    explain(
      "rate_segment",
      `Интервал ${new Date(segment.startMs).toISOString()}…${new Date(segment.endMs).toISOString()}`,
      `${segment.class}, ${segment.rateKopecksPerHour} коп/ч`,
    ),
  );

  const economicsNode = explain("economics", "Экономика", null, [
    explain(
      "paid_hours",
      "Оплачиваемые часы",
      `${formatSeconds(input.paidSeconds)} ч (k_quality=${ratioText(input.kQuality)})`,
    ),
    explain("amount", "Начислено", `${input.amountKopecks} коп`),
    explain("cash", "Денежная часть", `${input.cashKopecks} коп`),
    explain("equity", "Вклад (equity)", `${input.equityKopecks} коп`),
    explain(
      "share",
      "Доля дня",
      `${(Number(input.shareBp) / 10_000).toFixed(4)} % от оценки ${input.valuationKopecks} коп`,
    ),
    explain(
      "pool",
      "Пул",
      `${(Number(input.poolUsedBp) / 100).toFixed(2)} % бюджета ${input.poolBudgetKopecks} коп${
        input.poolPending ? `; pending ${input.pendingEquityKopecks} коп` : ""
      }`,
    ),
  ]);

  const flagsNode = explain(
    "flags",
    "Флаги",
    input.flags.length === 0 ? "нет" : input.flags.map((f) => f.code).join(", "),
    input.flags.map((f) => explain(`flag_${f.code}`, f.code, f.detail)),
  );

  return explain(
    "day_calculation",
    `Расчет дня ${input.date} (${policy.project.timezone})`,
    `${formatSeconds(input.paidSeconds)} ч → ${input.amountKopecks} коп → ${(
      Number(input.shareBp) / 10_000
    ).toFixed(4)} %`,
    [
      explain(
        "window",
        "Окно суток",
        `${new Date(input.window.startMs).toISOString()}…${new Date(input.window.endMs).toISOString()} (${Math.round(
          input.window.durationMs / 1000,
        )} с)`,
      ),
      ...classNodes,
      capsNode,
      ...rateNodes,
      economicsNode,
      flagsNode,
    ],
  );
}

function ratioText(value: Ratio): string {
  if (value.d === 1n) return value.n.toString();
  return (Number(value.n) / Number(value.d)).toString();
}
