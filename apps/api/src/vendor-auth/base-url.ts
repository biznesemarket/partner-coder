/**
 * Линейные аналоги `trim().replace(/\/+$/, "")` и `replace(/\/+$/, "")`:
 * CodeQL справедливо считает такие регэкспы polynomial на пользовательском
 * вводе. Здесь нет бэктрекинга, только проход по строке.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function normalizeBaseUrl(value: string): string {
  return stripTrailingSlashes(value.trim());
}
