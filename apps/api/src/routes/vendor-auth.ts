import { createHash } from "node:crypto";

import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { writeVendorAudit, type VendorAuditEvent } from "@partner-coder/db";

import { EmailRateLimiter, type EmailRateLimitStore } from "../auth/email-rate-limit.js";
import { ApiError } from "../errors.js";
import { VENDOR_AUDIT_ACTIONS } from "../vendor-auth/audit-actions.js";
import { normalizeBaseUrl, stripTrailingSlashes } from "../vendor-auth/base-url.js";
import {
  resolveVendorIdentity,
  type VendorAuthRuntime,
  type VendorIdentity,
} from "../vendor-auth/runtime.js";

const MOUNT_PATH = "/api/vendor-auth";

const DENIED_PATHS = new Set([
  "/two-factor/disable",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/delete-user",
  "/change-email",
  "/link-social",
  "/unlink-account",
  "/sign-in/social",
]);

const DENIED_PREFIXES = ["/sign-up", "/admin", "/callback"] as const;

const EMAIL_RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/request-password-reset"]);

const SIGN_IN_PATH = "/sign-in/email";
const SIGN_OUT_PATH = "/sign-out";
const CHANGE_PASSWORD_PATH = "/change-password";
const MFA_VERIFY_TOTP_PATH = "/two-factor/verify-totp";
const MFA_VERIFY_BACKUP_PATH = "/two-factor/verify-backup-code";
const MFA_VERIFY_PATHS = new Set([MFA_VERIFY_TOTP_PATH, MFA_VERIFY_BACKUP_PATH]);
const SESSION_REVOKE_PATHS = new Set(["/revoke-session", "/revoke-other-sessions"]);
const PASSKEY_REGISTER_PATH = "/passkey/verify-registration";
const PASSKEY_DELETE_PATH = "/passkey/delete-passkey";
const PASSKEY_UPDATE_PATH = "/passkey/update-passkey";

/**
 * Управление passkey и паролем требует включённого TOTP: парольная сессия не
 * должна ни менять пароль, ни отзывать сессии, ни добавлять ключи доступа.
 * Passkey-вход и sign-out сюда не входят.
 */
const MFA_REQUIRED_PATHS = new Set([
  "/change-password",
  "/revoke-session",
  "/revoke-other-sessions",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/register",
  "/passkey/list-user-passkeys",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
]);

export function isMfaRequiredPath(path: string): boolean {
  return MFA_REQUIRED_PATHS.has(path);
}

/** Перед проксированием нужен актор: пишем его в аудит только после успеха. */
const IDENTITY_PATHS = new Set([
  SIGN_OUT_PATH,
  CHANGE_PASSWORD_PATH,
  ...SESSION_REVOKE_PATHS,
  ...MFA_VERIFY_PATHS,
  PASSKEY_REGISTER_PATH,
  PASSKEY_DELETE_PATH,
  PASSKEY_UPDATE_PATH,
]);

export { normalizeBaseUrl };

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
  return relative.length > 1 && relative.endsWith("/") ? stripTrailingSlashes(relative) : relative;
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function auditBestEffort(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
  event: VendorAuditEvent,
): Promise<void> {
  try {
    await writeVendorAudit(runtime.db, event);
  } catch (error) {
    request.log.warn({ err: error }, "vendor_auth_audit_failed");
  }
}

/**
 * Актор для аудита после успешного ответа. Сессия читается до проксирования,
 * поэтому sign-out/revoke/change-password ещё видят её. Ошибка чтения не
 * влияет на auth-ответ: аудит остаётся best-effort.
 */
async function identityForAudit(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
): Promise<VendorIdentity | null> {
  const api = runtime.auth.api as unknown as { getSession?: unknown } | undefined;
  if (typeof api?.getSession !== "function") {
    return null;
  }
  try {
    return await resolveVendorIdentity(runtime, request.headers, request.log);
  } catch (error) {
    request.log.warn({ err: error }, "vendor_auth_identity_lookup_failed");
    return null;
  }
}

/**
 * Строгий gate для путей из MFA_REQUIRED_PATHS. В отличие от аудита, ошибки не
 * проглатываются: без валидной сессии, активного статуса и включённого TOTP
 * upstream-обработчик не вызывается.
 */
async function requireMfaGate(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
): Promise<VendorIdentity> {
  const identity = await resolveVendorIdentity(runtime, request.headers, request.log);
  if (!identity) {
    throw new ApiError(401, "vendor_unauthenticated", "Требуется вход вендора");
  }
  if (identity.status !== "invited" && identity.status !== "active") {
    throw new ApiError(403, "vendor_inactive", "Учётная запись вендора заблокирована");
  }
  if (!identity.twoFactorEnabled) {
    throw new ApiError(403, "vendor_mfa_required", "Требуется включить TOTP");
  }
  return identity;
}

/**
 * Аудит по результату прокси. Все записи best-effort и не содержат секретов:
 * неуспешный вход — только sha256(normalizedEmail), второй фактор — path.
 */
async function auditResponse(
  request: FastifyRequest,
  runtime: VendorAuthRuntime,
  path: string,
  status: number,
  email: string | null,
  identity: VendorIdentity | null,
): Promise<void> {
  if (path === SIGN_IN_PATH && (status === 401 || status === 403) && email) {
    await auditBestEffort(request, runtime, {
      actorId: null,
      action: VENDOR_AUDIT_ACTIONS.signInFailed,
      entity: "vendor_auth",
      after: {
        emailHash: sha256(email),
        reason: status === 403 ? "inactive" : "invalid_credentials",
      },
      ip: request.ip || null,
    });
    return;
  }

  if (MFA_VERIFY_PATHS.has(path) && (status === 401 || status === 429)) {
    await auditBestEffort(request, runtime, {
      actorId: null,
      action: VENDOR_AUDIT_ACTIONS.mfaFailed,
      entity: "vendor_auth",
      after: { path, reason: status === 429 ? "locked" : "invalid_totp" },
      ip: request.ip || null,
    });
    return;
  }

  if (status !== 200 || !identity) {
    return;
  }

  if (path === MFA_VERIFY_TOTP_PATH && !identity.twoFactorEnabled) {
    await auditBestEffort(request, runtime, {
      actorId: identity.userId,
      action: VENDOR_AUDIT_ACTIONS.mfaEnabled,
      entity: "vendor_user",
      after: { userId: identity.userId, sessionId: identity.sessionId },
      ip: request.ip || null,
    });
    return;
  }

  const passkeyEvent =
    path === PASSKEY_REGISTER_PATH
      ? VENDOR_AUDIT_ACTIONS.passkeyAdded
      : path === PASSKEY_DELETE_PATH
        ? VENDOR_AUDIT_ACTIONS.passkeyRemoved
        : path === PASSKEY_UPDATE_PATH
          ? VENDOR_AUDIT_ACTIONS.passkeyRenamed
          : null;
  if (passkeyEvent) {
    await auditBestEffort(request, runtime, {
      actorId: identity.userId,
      action: passkeyEvent,
      entity: "vendor_passkey",
      after: { userId: identity.userId, sessionId: identity.sessionId },
      ip: request.ip || null,
    });
    return;
  }

  const sessionEvent =
    path === SIGN_OUT_PATH
      ? VENDOR_AUDIT_ACTIONS.signedOut
      : path === CHANGE_PASSWORD_PATH
        ? VENDOR_AUDIT_ACTIONS.passwordChanged
        : SESSION_REVOKE_PATHS.has(path)
          ? VENDOR_AUDIT_ACTIONS.sessionRevoked
          : null;
  if (!sessionEvent) {
    return;
  }
  await auditBestEffort(request, runtime, {
    actorId: identity.userId,
    action: sessionEvent,
    entity: "vendor_session",
    after: { userId: identity.userId, sessionId: identity.sessionId, path },
    ip: request.ip || null,
  });
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
      const requestEmail = path === SIGN_IN_PATH ? normalizedEmail(request.body) : null;
      const gatedIdentity = isMfaRequiredPath(path) ? await requireMfaGate(request, runtime) : null;
      const identity =
        gatedIdentity ??
        (IDENTITY_PATHS.has(path) ? await identityForAudit(request, runtime) : null);
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
      await auditResponse(request, runtime, path, response.status, requestEmail, identity);
      return reply.send(text.length > 0 ? text : null);
    },
  });
}
