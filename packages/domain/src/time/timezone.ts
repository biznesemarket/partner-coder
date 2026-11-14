import { MS_PER_DAY, MS_PER_HOUR } from "../units.js";

/**
 * Границы локальных суток в заданном часовом поясе.
 *
 * Используется `Intl.DateTimeFormat` вместо сторонних библиотек: он есть в
 * Node.js и в браузере, поддерживает IANA-пояса и правила DST. Смещение
 * вычисляется итеративно (двух проходов достаточно для всех переходов DST,
 * где смещение меняется не более одного раза в сутки).
 */

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface ZonedDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
}

function partsOf(instantMs: number, timeZone: string): ZonedDateTimeParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new RangeError(`Нет части ${type} при форматировании ${instantMs}`);
    return Number.parseInt(found.value, 10);
  };
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // hour12: false иногда отдает 24 вместо 00
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Смещение пояса относительно UTC в миллисекундах для конкретного мгновения. */
export function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const wholeSecond = instantMs - (((instantMs % 1000) + 1000) % 1000);
  const p = partsOf(wholeSecond, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - wholeSecond;
}

/** Мгновение UTC для локальных даты и времени пояса. */
export function zonedTimeToUtcMs(parts: ZonedDateTimeParts, timeZone: string): number {
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let instant = asUtc - zoneOffsetMs(asUtc, timeZone);
  instant = asUtc - zoneOffsetMs(instant, timeZone);
  return instant;
}

export function parseLocalDate(date: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`Ожидалась дата YYYY-MM-DD, получено "${date}"`);
  }
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);
  return { year, month, day };
}

export function formatLocalDate(parts: LocalDateParts): string {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function addLocalDays(date: string, days: number): string {
  const base = parseLocalDate(date);
  const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return formatLocalDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** Локальная дата мгновения в поясе. */
export function localDateOf(instantMs: number, timeZone: string): string {
  const p = partsOf(instantMs, timeZone);
  return formatLocalDate(p);
}

/**
 * Первое мгновение локальной даты в поясе.
 *
 * Если 00:00 не существует (переход DST ровно в полночь, например
 * America/Santiago), возвращается первое существующее мгновение этой даты.
 */
export function startOfLocalDay(date: string, timeZone: string): number {
  const p = parseLocalDate(date);
  const guess = zonedTimeToUtcMs({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
  if (localDateOf(guess, timeZone) === date) {
    return guess;
  }
  const searchFrom = guess - 6 * MS_PER_HOUR;
  const searchUntil = guess + 6 * MS_PER_HOUR;
  for (let candidate = searchFrom; candidate <= searchUntil; candidate += 60_000) {
    if (localDateOf(candidate, timeZone) === date) {
      return candidate;
    }
  }
  throw new RangeError(`Не удалось найти начало суток ${date} в поясе ${timeZone}`);
}

export interface DayWindow {
  /** Локальная дата YYYY-MM-DD. */
  date: string;
  timeZone: string;
  startMs: number;
  endMs: number;
  /** Длительность суток в миллисекундах: 23/24/25 ч при переходах DST. */
  durationMs: number;
}

export function dayWindowUtc(date: string, timeZone: string): DayWindow {
  const startMs = startOfLocalDay(date, timeZone);
  const endMs = startOfLocalDay(addLocalDays(date, 1), timeZone);
  if (endMs <= startMs) {
    throw new RangeError(`Некорректное окно суток ${date} в поясе ${timeZone}`);
  }
  if (endMs - startMs > 2 * MS_PER_DAY) {
    throw new RangeError(`Подозрительно длинные сутки ${date} в поясе ${timeZone}`);
  }
  return { date, timeZone, startMs, endMs, durationMs: endMs - startMs };
}

/** Часы локального времени для мгновения (0…23). */
export function localHourOf(instantMs: number, timeZone: string): number {
  return partsOf(instantMs, timeZone).hour;
}
