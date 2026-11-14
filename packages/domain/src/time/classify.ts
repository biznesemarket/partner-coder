import type { ProjectPolicy } from "../policy/policy.js";
import { MS_PER_SECOND } from "../units.js";
import type { IntervalClass, TimelineInterval } from "./intervals.js";

/**
 * Классификация сигналов активности в интервалы классов времени
 * (time-accounting §2–§3).
 *
 * Авторитетное время — серверное `receivedAt`. Интервал между двумя
 * событиями не может быть длиннее `idle_timeout_sec`: всё, что дальше,
 * считается простоем (защита от накрутки offline-промежутков).
 */

export interface HeartbeatSignals {
  inputEvents?: number;
  scroll?: number;
  filesTouched?: number;
  focus?: boolean;
  toolCalls?: number;
}

export interface Heartbeat {
  /** Серверное время приема события, ISO-8601. */
  receivedAt: string;
  /** Часы клиента (справочно, для флага clock_skew). */
  clientTime?: string;
  signals?: HeartbeatSignals;
  agentAttached?: boolean;
  agentRunning?: boolean;
}

export interface ClassifyResult {
  intervals: TimelineInterval[];
  /** Максимальное расхождение часов клиента и сервера, секунды. */
  maxClockSkewSeconds: number;
}

function hasHumanSignal(signals: HeartbeatSignals | undefined): boolean {
  if (!signals) return false;
  return (
    (signals.inputEvents ?? 0) > 0 || (signals.scroll ?? 0) > 0 || (signals.filesTouched ?? 0) > 0
  );
}

export function classifyHeartbeats(
  heartbeats: readonly Heartbeat[],
  policy: ProjectPolicy,
): ClassifyResult {
  const samples = [...heartbeats]
    .map((heartbeat) => ({
      ...heartbeat,
      atMs: Date.parse(heartbeat.receivedAt),
      clientMs: heartbeat.clientTime ? Date.parse(heartbeat.clientTime) : null,
    }))
    .filter((sample) => !Number.isNaN(sample.atMs))
    .sort((a, b) => a.atMs - b.atMs);

  let maxClockSkewSeconds = 0;
  for (const sample of samples) {
    if (sample.clientMs === null || Number.isNaN(sample.clientMs)) continue;
    const skew = Math.abs(sample.atMs - sample.clientMs) / MS_PER_SECOND;
    if (skew > maxClockSkewSeconds) maxClockSkewSeconds = skew;
  }

  const { activeWindowSec, presenceWindowSec, idleTimeoutSec } = policy.time;
  const intervals: TimelineInterval[] = [];
  let lastHumanMs: number | null = null;

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    if (!current) continue;
    if (hasHumanSignal(current.signals) || current.signals?.focus === true) {
      lastHumanMs = current.atMs;
    }
    const next = samples[index + 1];
    if (!next) break;

    const gapMs = next.atMs - current.atMs;
    if (gapMs <= 0) continue;
    // Простой: всё, что дольше idle_timeout, не кредитуется.
    const creditedMs = Math.min(gapMs, idleTimeoutSec * MS_PER_SECOND);

    const sinceHumanSec =
      lastHumanMs === null
        ? Number.POSITIVE_INFINITY
        : (current.atMs - lastHumanMs) / MS_PER_SECOND;
    let cls: IntervalClass;
    if (sinceHumanSec <= activeWindowSec) {
      cls = "active_human";
    } else if (current.agentRunning === true && sinceHumanSec <= presenceWindowSec) {
      cls = "supervised_agent";
    } else if (current.agentRunning === true) {
      cls = "autonomous_agent";
    } else if (sinceHumanSec <= presenceWindowSec) {
      // Человек присутствует (фокус, скролл), но агент не запущен:
      // это ручная работа; оплата зависит от manual_only_policy на уровне сессии.
      cls = "active_human";
    } else {
      cls = "idle";
    }

    intervals.push({ startMs: current.atMs, endMs: current.atMs + creditedMs, class: cls });
  }

  return { intervals, maxClockSkewSeconds };
}
