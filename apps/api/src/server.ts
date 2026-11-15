import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { ErrorEnvelope } from "@partner-coder/contracts";
import { AuthServiceError } from "@partner-coder/db";

import { ApiError } from "./errors.js";
import type { AuthRuntime } from "./auth/runtime.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerTenantRoutes } from "./routes/tenant.js";

export { ApiError } from "./errors.js";

function authServiceStatus(code: AuthServiceError["code"]): number {
  switch (code) {
    case "invitation_not_found":
    case "device_token_not_found":
    case "membership_not_found":
      return 404;
    case "invitation_used":
      return 409;
    case "invitation_expired":
      return 410;
    case "invitation_email_mismatch":
    case "membership_inactive":
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
      return typeof incoming === "string" && incoming.length > 0 ? incoming : randomUUID();
    },
    bodyLimit: 256 * 1024,
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
    const statusCode = (() => {
      if (error instanceof ApiError) {
        return error.statusCode;
      }
      if (error instanceof AuthServiceError) {
        return authServiceStatus(error.code);
      }
      return 500;
    })();
    const isPublic = error instanceof ApiError || error instanceof AuthServiceError;
    const payload: ErrorEnvelope = {
      error: {
        code: isPublic ? error.code : "internal_error",
        message: isPublic ? error.message : "Внутренняя ошибка. Попробуйте позже.",
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
