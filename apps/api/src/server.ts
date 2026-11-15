import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";

import type { ErrorEnvelope } from "@partner-coder/contracts";
import { AuthServiceError } from "@partner-coder/db";

import { ApiError } from "./errors.js";
import type { AuthRuntime } from "./auth/runtime.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerTenantRoutes } from "./routes/tenant.js";

export { ApiError } from "./errors.js";

function fastifyClientError(
  error: unknown,
): { readonly statusCode: number; readonly code: string } | null {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode >= 500) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return {
    statusCode,
    code: typeof code === "string" && code.length > 0 ? code : "bad_request",
  };
}

function authServiceStatus(code: AuthServiceError["code"]): number {
  switch (code) {
    case "invitation_not_found":
    case "device_not_found":
    case "device_token_not_found":
    case "membership_not_found":
      return 404;
    case "invitation_used":
    case "membership_exists":
      return 409;
    case "invitation_expired":
      return 410;
    case "invitation_email_mismatch":
    case "role_assignment_denied":
    case "membership_inactive":
    case "tenant_inactive":
    case "device_token_forbidden":
      return 403;
    case "device_token_revoked":
    case "device_token_expired":
      return 401;
  }
}

export interface BuildServerOptions {
  readonly logger?: boolean;
  readonly version?: string;
  readonly authRuntime?: AuthRuntime;
}

/**
 * Скелет REST API (M2.3). Аутентификация, RLS-контекст и тенантные маршруты
 * добавляются в M2; здесь зафиксированы общие правила: requestId, конверт
 * ошибок, health/readiness, security-заголовки.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({
    logger: options.logger ?? false,
    genReqId: (request) => {
      const incoming = request.headers["x-request-id"];
      const safe =
        typeof incoming === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : null;
      return safe ?? randomUUID();
    },
    bodyLimit: 256 * 1024,
  });

  void server.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    allowList: (request) => request.url === "/healthz" || request.url === "/readyz",
  });

  const startedAt = Date.now();
  const version = options.version ?? "0.0.1";

  server.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
  });

  server.setErrorHandler((error, request, reply) => {
    const clientError = fastifyClientError(error);
    const statusCode = (() => {
      if (error instanceof ApiError) {
        return error.statusCode;
      }
      if (error instanceof AuthServiceError) {
        return authServiceStatus(error.code);
      }
      return clientError?.statusCode ?? 500;
    })();
    const isPublic =
      error instanceof ApiError || error instanceof AuthServiceError || clientError !== null;
    const payload: ErrorEnvelope = {
      error: {
        code: isPublic
          ? error instanceof ApiError || error instanceof AuthServiceError
            ? error.code
            : clientError!.code
          : "internal_error",
        message: isPublic
          ? error instanceof ApiError || error instanceof AuthServiceError
            ? error.message
            : "Некорректный запрос"
          : "Внутренняя ошибка. Попробуйте позже.",
        requestId: request.id,
        ...(error instanceof ApiError && error.details ? { details: error.details } : {}),
      },
    };
    if (statusCode >= 500) {
      request.log.error({ err: error }, "request_failed");
    }
    return reply.status(statusCode).send(payload);
  });

  server.setNotFoundHandler((request, reply) => {
    const payload: ErrorEnvelope = {
      error: {
        code: "not_found",
        message: "Маршрут не найден",
        requestId: request.id,
      },
    };
    return reply.status(404).send(payload);
  });

  server.get("/healthz", async () => ({
    status: "ok" as const,
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    checks: {},
  }));

  server.get("/readyz", async () => ({ status: "ok" as const }));

  if (options.authRuntime) {
    registerAuthRoutes(server, options.authRuntime);
    registerTenantRoutes(server, options.authRuntime);
  }

  return server;
}
