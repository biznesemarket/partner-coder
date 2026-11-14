import { z } from "zod";

/**
 * Контракты API и MCP (OPENAPI + Zod). Единый формат ошибок задан в
 * docs/03-architecture/api.md §«Ошибки».
 */

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.unknown()).optional(),
    requestId: z.string().min(1),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.record(z.enum(["ok", "fail", "skip"])),
});
export type Health = z.infer<typeof healthSchema>;

/** Служебные коды ошибок домена (совпадают с CalculatorError.code). */
export const DOMAIN_ERROR_CODES = [
  "manual_only_policy_not_supported",
  "invalid_interval",
  "policy_violation",
  "cross_tenant_denied",
  "package_expired",
  "package_used",
  "duplicate_seq",
] as const;

export const idempotencyHeader = "idempotency-key";
export const requestIdHeader = "x-request-id";

export const CONTRACTS_VERSION = "0.1.0";
