import { addLocalDays, localDateOf } from "@partner-coder/domain";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function localMinutesOf(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number.parseInt(value, 10);
  };
  const hour = read("hour");
  return (hour === 24 ? 0 : hour) * 60 + read("minute");
}

export function parseCloseAt(closeAt: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(closeAt);
  if (!match) {
    throw new Error(`close_at должен быть в формате HH:MM, получено "${closeAt}"`);
  }
  return Number.parseInt(match[1] as string, 10) * 60 + Number.parseInt(match[2] as string, 10);
}

/**
 * Последняя локальная дата, которая должна быть закрыта к моменту `now`.
 *
 * `close_at` — время следующих суток, когда закрывается предыдущая дата:
 * при 00:00 в течение всего дня D уже закрыта дата D-1. Если сейчас раньше
 * `close_at`, последняя закрытая дата — D-2.
 */
export function dueCloseDate(now: Date, timeZone: string, closeAt: string): string {
  const date = localDateOf(now.getTime(), timeZone);
  const nowMinutes = localMinutesOf(now.getTime(), timeZone);
  const closeMinutes = parseCloseAt(closeAt);
  return nowMinutes >= closeMinutes ? addLocalDays(date, -1) : addLocalDays(date, -2);
}

/** Диапазон локальных дат включительно; `limit` оставляет последние N дат. */
export function dateRange(from: string, to: string, limit?: number): string[] {
  if (from > to) {
    return [];
  }
  const dates: string[] = [];
  for (let date = from; date <= to; date = addLocalDays(date, 1)) {
    dates.push(date);
    if (dates.length > 3660) {
      throw new Error("Слишком длинный диапазон дат для закрытия дня");
    }
  }
  if (limit !== undefined && dates.length > limit) {
    return dates.slice(-limit);
  }
  return dates;
}
