import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { ErrorEnvelope } from "@partner-coder/contracts";

/** Коды ошибок, которые API отдает клиенту без раскрытия внутренних деталей. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface BuildServerOptions {
  readonly logger?: boolean;
  readonly version?: string;
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
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const payload: ErrorEnvelope = {
      error: {
        code: error instanceof ApiError ? error.code : "internal_error",
        message: error instanceof ApiError ? error.message : "Внутренняя ошибка. Попробуйте позже.",
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

  return server;
}
