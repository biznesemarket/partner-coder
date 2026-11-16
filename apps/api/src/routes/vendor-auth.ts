import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";

import { EmailRateLimiter, type EmailRateLimitStore } from "../auth/email-rate-limit.js";
import { ApiError } from "../errors.js";
import type { VendorAuthRuntime } from "../vendor-auth/runtime.js";

const MOUNT_PATH = "/api/vendor-auth";

const DENIED_PATHS = new Set([
  "/sign-up",
  "/sign-up/email",
  "/two-factor/disable",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/delete-user",
  "/change-email",
  "/link-social",
  "/unlink-account",
  "/sign-in/social",
]);

const DENIED_PREFIXES = ["/admin", "/callback"] as const;

const EMAIL_RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/request-password-reset"]);

export interface VendorAuthRouteOptions {
  /** База API; разрешена как Origin наравне с vendorBaseUrl. */
  readonly apiBaseUrl: string;
  /** Общий store (PostgreSQL); без него используется memory-лимитер 5/60. */
  readonly emailRateLimitStore?: EmailRateLimitStore;
}

function relativePath(pathname: string): string {
  const relative = pathname.slice(MOUNT_PATH.length);
  if (!relative) {
    return "/";
  }
  return relative.length > 1 && relative.endsWith("/") ? relative.replace(/\/+$/, "") : relative;
}

/** Декодирует и схлопывает слэши, чтобы deny-list нельзя было обойти кодированием. */
function normalizedPathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname).replace(/\/{2,}/g, "/");
  } catch {
    return pathname;
  }
}

function isDeniedPath(path: string): boolean {
  if (DENIED_PATHS.has(path)) {
    return true;
  }
  return DENIED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizedEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const email = (body as { email?: unknown }).email;
  if (typeof email !== "string") {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function registerVendorAuthRoutes(
  server: FastifyInstance,
  runtime: VendorAuthRuntime,
  options: VendorAuthRouteOptions,
): void {
  const vendorOrigin = normalizeBaseUrl(runtime.vendorBaseUrl);
  const apiOrigin = normalizeBaseUrl(options.apiBaseUrl);
  const emailLimiter: EmailRateLimitStore = options.emailRateLimitStore ?? new EmailRateLimiter();

  server.route({
    method: ["GET", "POST"],
    url: `${MOUNT_PATH}/*`,
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const path = relativePath(normalizedPathname(url.pathname));

      if (isDeniedPath(path)) {
        throw new ApiError(
          403,
          "vendor_auth_path_forbidden",
          "Метод вендорской аутентификации запрещен",
        );
      }

      if (isUnsafeMethod(request.method)) {
        const origin = request.headers.origin;
        if (typeof origin === "string" && origin.length > 0) {
          const normalizedOrigin = normalizeBaseUrl(origin);
          if (normalizedOrigin !== vendorOrigin && normalizedOrigin !== apiOrigin) {
            throw new ApiError(403, "vendor_origin_denied", "Недопустимый источник запроса");
          }
        }
      }

      if (EMAIL_RATE_LIMITED_PATHS.has(path)) {
        const email = normalizedEmail(request.body);
        if (email && !(await emailLimiter.consume(email))) {
          throw new ApiError(
            429,
            "email_rate_limited",
            "Слишком много попыток входа для этого email",
          );
        }
      }

      const headers = fromNodeHeaders(request.headers);
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);
      const fetchRequest = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
      });

      const response = await runtime.auth.handler(fetchRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") {
          reply.header(key, value);
        }
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) {
        reply.header("set-cookie", cookies);
      }
      const text = await response.text();
      return reply.send(text.length > 0 ? text : null);
    },
  });
}
