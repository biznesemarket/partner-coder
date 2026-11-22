import {
  TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_CLIENT_IP_SIGNATURE_HEADER,
} from "@partner-coder/domain";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import type { LoggerOptions } from "pino";

import type { ErrorEnvelope } from "@partner-coder/contracts";
import { AuthServiceError } from "@partner-coder/db";

import { verifyTrustedClientIp } from "./client-ip.js";
import { ApiError } from "./errors.js";
import type { AuthRuntime } from "./auth/runtime.js";
import { createHttpMetrics } from "./metrics.js";
import { buildOpenApiDocument } from "./openapi/index.js";
import type { EmailRateLimitStore } from "./auth/email-rate-limit.js";
import type { VendorAuthRuntime } from "./vendor-auth/runtime.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerTenantRoutes } from "./routes/tenant.js";
import { normalizeBaseUrl, registerVendorAuthRoutes } from "./routes/vendor-auth.js";
import { registerVendorBillingRoutes } from "./routes/vendor-billing.js";
import { registerVendorDashboardRoutes } from "./routes/vendor-dashboard.js";
import { registerVendorFinanceRoutes } from "./routes/vendor-finance.js";
import { registerVendorPackageRoutes } from "./routes/vendor-packages.js";
import { registerVendorRoutes } from "./routes/vendor.js";

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
  readonly logger?: boolean | LoggerOptions;
  readonly version?: string;
  readonly authRuntime?: AuthRuntime;
  readonly corsOrigins?: readonly string[];
  readonly metricsToken?: string;
  readonly appEnv?: string;
  readonly apiBaseUrl?: string;
  readonly emailRateLimit?: number | false;
  readonly emailRateLimitStore?: EmailRateLimitStore;
  readonly vendorRuntime?: VendorAuthRuntime;
  readonly vendorEmailRateLimitStore?: EmailRateLimitStore;
  readonly trustedClientIpSecret?: string;
  readonly onError?: (error: unknown, request: FastifyRequest) => void;
}

function requireApiBaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("apiBaseUrl is required when vendorRuntime is configured");
  }
  return value;
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function isVendorApiPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  let normalized = path;
  try {
    normalized = decodeURIComponent(path).replace(/\/{2,}/g, "/");
  } catch {
    normalized = path;
  }
  return normalized === "/v1/vendor" || normalized.startsWith("/v1/vendor/");
}

/**
 * Скелет REST API (M2.3). Аутентификация, RLS-контекст и тенантные маршруты
 * добавляются в M2; здесь зафиксированы общие правила: requestId, конверт
 * ошибок, health/readiness, security-заголовки.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const vendorSetup = options.vendorRuntime
    ? {
        runtime: options.vendorRuntime,
        apiBaseUrl: requireApiBaseUrl(options.apiBaseUrl),
      }
    : null;

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

  const trustedClientIpSecret = options.trustedClientIpSecret;

  // codeql[js/missing-rate-limiting]: global hook, rate limit is registered below and keyed by the verified IP.
  server.addHook("onRequest", (request, _reply, done) => {
    const rawIp = request.headers[TRUSTED_CLIENT_IP_HEADER];
    const rawSignature = request.headers[TRUSTED_CLIENT_IP_SIGNATURE_HEADER];
    delete request.headers[TRUSTED_CLIENT_IP_HEADER];
    delete request.headers[TRUSTED_CLIENT_IP_SIGNATURE_HEADER];

    if (trustedClientIpSecret) {
      const verified = verifyTrustedClientIp(rawIp, rawSignature, trustedClientIpSecret);
      if (verified !== null) {
        request.headers[TRUSTED_CLIENT_IP_HEADER] = verified;
      }
    }
    done();
  });

  void server.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    allowList: (request) => request.url === "/healthz" || request.url === "/readyz",
    keyGenerator: (request) => {
      const verified = request.headers[TRUSTED_CLIENT_IP_HEADER];
      return typeof verified === "string" && verified !== "" ? verified : request.ip;
    },
  });

  if (options.corsOrigins && options.corsOrigins.length > 0) {
    void server.register(cors, {
      origin: [...options.corsOrigins],
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["content-type", "authorization", "x-request-id", "idempotency-key"],
      exposedHeaders: ["x-request-id"],
      maxAge: 600,
    });
  }

  const metrics = createHttpMetrics();

  server.addHook("onRequest", async (request) => {
    (request as FastifyRequest & { metricsStart?: bigint }).metricsStart = process.hrtime.bigint();
  });

  server.addHook("onResponse", async (request, reply) => {
    const started = (request as FastifyRequest & { metricsStart?: bigint }).metricsStart;
    const seconds = started ? Number(process.hrtime.bigint() - started) / 1e9 : 0;
    const labels = {
      method: request.method,
      route: metrics.routeOf(request),
      status: String(reply.statusCode),
    };
    metrics.requestCounter.inc(labels);
    metrics.requestDuration.observe(labels, seconds);
  });

  const startedAt = Date.now();
  const version = options.version ?? "0.0.1";

  server.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-resource-policy", "same-site");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    if (options.appEnv && options.appEnv !== "local") {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
  });

  server.get("/metrics", async (request, reply) => {
    if (options.metricsToken) {
      const authorization = request.headers.authorization;
      const token = request.headers["x-metrics-token"];
      const provided =
        typeof authorization === "string" && authorization.startsWith("Bearer ")
          ? authorization.slice(7)
          : typeof token === "string"
            ? token
            : null;
      if (provided !== options.metricsToken) {
        return reply.status(401).send({ error: "metrics_unauthorized" });
      }
    }
    reply.type(metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });

  server.get("/openapi.json", async (_request, reply) => {
    reply.type("application/json; charset=utf-8");
    return reply.send(
      buildOpenApiDocument({
        serverUrl: options.apiBaseUrl ?? "http://localhost:4000",
        version,
      }),
    );
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
      options.onError?.(error, request);
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
    registerAuthRoutes(server, options.authRuntime, {
      ...(options.emailRateLimit === undefined ? {} : { emailRateLimit: options.emailRateLimit }),
      ...(options.emailRateLimitStore === undefined
        ? {}
        : { emailRateLimitStore: options.emailRateLimitStore }),
    });
    registerTenantRoutes(server, options.authRuntime);
  }

  if (vendorSetup) {
    const vendorOrigin = normalizeBaseUrl(vendorSetup.runtime.vendorBaseUrl);
    const apiOrigin = normalizeBaseUrl(vendorSetup.apiBaseUrl);

    server.addHook("onRequest", async (request) => {
      if (!isUnsafeMethod(request.method) || !isVendorApiPath(request.url)) {
        return;
      }
      const origin = request.headers.origin;
      if (typeof origin !== "string" || origin.length === 0) {
        return;
      }
      const normalizedOrigin = normalizeBaseUrl(origin);
      if (normalizedOrigin !== vendorOrigin && normalizedOrigin !== apiOrigin) {
        throw new ApiError(403, "vendor_origin_denied", "Недопустимый источник запроса");
      }
    });

    registerVendorAuthRoutes(server, vendorSetup.runtime, {
      apiBaseUrl: vendorSetup.apiBaseUrl,
      ...(options.vendorEmailRateLimitStore === undefined
        ? {}
        : { emailRateLimitStore: options.vendorEmailRateLimitStore }),
    });
    registerVendorRoutes(server, vendorSetup.runtime);
    registerVendorFinanceRoutes(server, vendorSetup.runtime);
    registerVendorBillingRoutes(server, vendorSetup.runtime);
    registerVendorPackageRoutes(server, vendorSetup.runtime);
    registerVendorDashboardRoutes(server, vendorSetup.runtime);
  }

  return server;
}
