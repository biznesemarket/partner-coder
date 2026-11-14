import { createHash } from "node:crypto";

/**
 * Канонический JSON и хеш входа расчета.
 *
 * Хеш фиксирует все входы дня (интервалы, версии политики, коэффициенты),
 * поэтому повторный расчет с теми же данными идемпотентен, а изменившиеся
 * данные дают другой хеш и требуют компенсирующей записи (инварианты 3–4).
 */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (typeof value === "bigint") return `{"$bigint":"${value.toString()}"}`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("canonicalJson: недопустимое число");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: неподдерживаемый тип ${typeof value}`);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** SHA-256 файла/строки политики для записи в дневной расчет. */
export function policyHash(policyDocument: unknown): string {
  return hashObject(policyDocument);
}
