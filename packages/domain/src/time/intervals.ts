/**
 * Таймлайн интервалов: классы времени, union и разрезы (R3, R4).
 *
 * Все границы — целые миллисекунды UTC. Классы времени заданы нормативно
 * (docs/02-domain/time-accounting.md §3).
 */

export type IntervalClass = "active_human" | "supervised_agent" | "autonomous_agent" | "idle";

export const INTERVAL_CLASSES: readonly IntervalClass[] = [
  "active_human",
  "supervised_agent",
  "autonomous_agent",
  "idle",
] as const;

/** Приоритет класса при пересечении: активная работа человека важнее. */
export const CLASS_PRIORITY: Readonly<Record<IntervalClass, number>> = {
  active_human: 3,
  supervised_agent: 2,
  autonomous_agent: 1,
  idle: 0,
};

export interface TimelineInterval {
  startMs: number;
  endMs: number;
  class: IntervalClass;
}

export class IntervalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntervalError";
  }
}

function assertInterval(interval: TimelineInterval): void {
  if (!Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs)) {
    throw new IntervalError("Границы интервала должны быть конечными числами");
  }
  if (interval.endMs < interval.startMs) {
    throw new IntervalError(
      `Интервал ${interval.startMs}…${interval.endMs} заканчивается раньше начала`,
    );
  }
}

export function clipInterval(
  interval: TimelineInterval,
  startMs: number,
  endMs: number,
): TimelineInterval | null {
  const start = Math.max(interval.startMs, startMs);
  const end = Math.min(interval.endMs, endMs);
  if (end <= start) return null;
  return { startMs: start, endMs: end, class: interval.class };
}

export function clipIntervals(
  intervals: readonly TimelineInterval[],
  startMs: number,
  endMs: number,
): TimelineInterval[] {
  const result: TimelineInterval[] = [];
  for (const interval of intervals) {
    const clipped = clipInterval(interval, startMs, endMs);
    if (clipped) result.push(clipped);
  }
  return result;
}

/**
 * R3 + инвариант 6: пересекающиеся интервалы одного человека объединяются,
 * а не суммируются. При пересечении разных классов побеждает класс с
 * большим приоритетом (active_human → supervised_agent → autonomous_agent →
 * idle), поэтому один и тот же отрезок времени никогда не оплачивается дважды.
 */
export function unionTimeline(intervals: readonly TimelineInterval[]): TimelineInterval[] {
  interface SweepEvent {
    at: number;
    delta: 1 | -1;
    cls: IntervalClass;
  }

  const events: SweepEvent[] = [];
  for (const interval of intervals) {
    assertInterval(interval);
    if (interval.endMs === interval.startMs) continue;
    events.push({ at: interval.startMs, delta: 1, cls: interval.class });
    events.push({ at: interval.endMs, delta: -1, cls: interval.class });
  }
  if (events.length === 0) return [];

  events.sort((a, b) => a.at - b.at);

  const counts = new Map<IntervalClass, number>();
  const result: TimelineInterval[] = [];
  let cursor: number | null = null;
  let cursorClass: IntervalClass | null = null;
  let index = 0;

  while (index < events.length) {
    const at = (events[index] as SweepEvent).at;
    // Состояние, посчитанное на прошлом шаге, действует до текущей границы.
    if (cursor !== null && cursorClass !== null && at > cursor) {
      result.push({ startMs: cursor, endMs: at, class: cursorClass });
    }
    while (index < events.length && (events[index] as SweepEvent).at === at) {
      const event = events[index] as SweepEvent;
      counts.set(event.cls, (counts.get(event.cls) ?? 0) + event.delta);
      index += 1;
    }
    cursor = at;
    cursorClass = bestActiveClass(counts);
  }

  // Склейка соседних отрезков одного класса: union дает максимальные интервалы.
  const merged: TimelineInterval[] = [];
  for (const segment of result) {
    const last = merged[merged.length - 1];
    if (last && last.class === segment.class && last.endMs === segment.startMs) {
      merged[merged.length - 1] = { ...last, endMs: segment.endMs };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function bestActiveClass(counts: ReadonlyMap<IntervalClass, number>): IntervalClass | null {
  let best: IntervalClass | null = null;
  for (const [cls, count] of counts) {
    if (count > 0 && (best === null || CLASS_PRIORITY[cls] > CLASS_PRIORITY[best])) {
      best = cls;
    }
  }
  return best;
}

/** R4: разрезает интервалы по заданным границам (полночь, смена ставки). */
export function splitAtBoundaries(
  intervals: readonly TimelineInterval[],
  boundaries: readonly number[],
): TimelineInterval[] {
  const cuts = [...new Set(boundaries)].sort((a, b) => a - b);
  const result: TimelineInterval[] = [];
  for (const interval of intervals) {
    let cursor = interval.startMs;
    for (const cut of cuts) {
      if (cut <= cursor) continue;
      if (cut >= interval.endMs) break;
      result.push({ startMs: cursor, endMs: cut, class: interval.class });
      cursor = cut;
    }
    if (cursor < interval.endMs) {
      result.push({ startMs: cursor, endMs: interval.endMs, class: interval.class });
    }
  }
  return result;
}

export interface ClassMilliseconds {
  activeMs: number;
  supervisedMs: number;
  autonomousMs: number;
  idleMs: number;
}

export function classMilliseconds(intervals: readonly TimelineInterval[]): ClassMilliseconds {
  const totals: ClassMilliseconds = {
    activeMs: 0,
    supervisedMs: 0,
    autonomousMs: 0,
    idleMs: 0,
  };
  for (const interval of intervals) {
    const duration = Math.max(0, interval.endMs - interval.startMs);
    switch (interval.class) {
      case "active_human":
        totals.activeMs += duration;
        break;
      case "supervised_agent":
        totals.supervisedMs += duration;
        break;
      case "autonomous_agent":
        totals.autonomousMs += duration;
        break;
      case "idle":
        totals.idleMs += duration;
        break;
    }
  }
  return totals;
}
