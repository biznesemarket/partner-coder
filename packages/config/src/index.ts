/**
 * Общие константы продукта, не зависящие от окружения.
 * Значения по умолчанию для политики живут в `@partner-coder/domain`.
 */
export const PRODUCT = {
  name: "Партнёр кодер",
  vendor: "Partner Coder",
  defaultCurrency: "RUB",
  defaultLocale: "ru-RU",
} as const;

export const LIMITS = {
  /** Максимальный размер тела запроса API, байт. */
  maxRequestBytes: 256 * 1024,
  /** Максимальный размер батча heartbeat. */
  maxHeartbeatBatch: 500,
  /** Окно идемпотентности, часы. */
  idempotencyTtlHours: 24,
} as const;

export * from "./env.js";
