/**
 * Версии ставки и оценки (R14, V-01…V-08).
 *
 * Ставка и оценка выбираются по моменту времени: действует последняя версия,
 * чей `effective_from` не позже момента. Версии неизменяемы, добавляются
 * только вперед (инвариант 5).
 */

export interface EffectiveVersion<T> {
  id: string;
  effectiveFrom: string;
  effectiveFromMs: number;
  value: T;
  reason: string;
  approvedBy: string;
}

export interface RateVersion extends EffectiveVersion<bigint> {
  /** Значение в копейках за час. */
  valueKopecksPerHour: bigint;
}

export interface ValuationVersion extends EffectiveVersion<bigint> {
  /** Значение в копейках. */
  valueKopecks: bigint;
  adrRef: string;
}

export class VersionError extends Error {
  constructor(
    readonly code: "no_active_version" | "invalid_versions",
    message: string,
  ) {
    super(message);
    this.name = "VersionError";
  }
}

export function parseInstant(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new VersionError("invalid_versions", `Некорректный момент времени "${iso}"`);
  }
  return ms;
}

/** Последняя версия, действующая на момент `atMs`. */
export function activeVersion<T extends { effectiveFromMs: number }>(
  versions: readonly T[],
  atMs: number,
  label: string,
): T {
  let found: T | undefined;
  for (const version of versions) {
    if (version.effectiveFromMs <= atMs) {
      if (!found || version.effectiveFromMs >= found.effectiveFromMs) {
        found = version;
      }
    }
  }
  if (!found) {
    throw new VersionError(
      "no_active_version",
      `Нет действующей версии ${label} на момент ${new Date(atMs).toISOString()}`,
    );
  }
  return found;
}

/** Отсортированные моменты смены версии внутри окна (для R4). */
export function versionBoundariesWithin(
  versions: readonly { effectiveFromMs: number }[],
  startMs: number,
  endMs: number,
): number[] {
  return versions
    .map((version) => version.effectiveFromMs)
    .filter((ms) => ms > startMs && ms < endMs)
    .sort((a, b) => a - b);
}
