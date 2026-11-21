/**
 * `@partner-coder/domain` — чистое доменное ядро.
 *
 * Здесь нет ни БД, ни HTTP, ни UI: только политика, время, экономика,
 * калькулятор дня, вестинг и объяснения. Все денежные и долевые значения —
 * целые (копейки, базисные пункты, единицы доли); время — целые секунды
 * или миллисекунды epoch.
 */

export * from "./rational.js";
export * from "./decimal.js";
export * from "./units.js";
export * from "./errors.js";
export * from "./flags.js";
export * from "./explain.js";
export * from "./hash.js";
export * from "./billing.js";

export * from "./time/timezone.js";
export * from "./time/intervals.js";
export * from "./time/classify.js";

export * from "./policy/schema.js";
export * from "./policy/versions.js";
export * from "./policy/policy.js";

export * from "./economics/calculator.js";
export * from "./economics/pool.js";
export * from "./economics/vesting.js";
export * from "./economics/month.js";

export const DOMAIN_VERSION = "0.1.0";
