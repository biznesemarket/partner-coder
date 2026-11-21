import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { pino } from "pino";

import {
  parseEnv,
  parseList,
  resolveRateLimitStorage,
  resolveVendorBaseUrl,
  resolveVendorWebauthnRpId,
} from "@partner-coder/config";
import {
  activateAfterPasswordReset,
  createDatabase,
  createPool,
  getVendorUserByEmail,
  getVendorUserById,
  markVendorLogin,
  writeVendorAudit,
} from "@partner-coder/db";

import { createAuth } from "./auth/config.js";
import { readRoleFacts, roleSeparationErrors } from "./auth/db-roles.js";
import { DatabaseEmailRateLimiter, EmailRateLimiter } from "./auth/email-rate-limit.js";
import { SmtpMailer } from "./auth/mailer.js";
import { createAuthRuntime } from "./auth/runtime.js";
import { loggerOptions } from "./logger.js";
import { VENDOR_AUDIT_ACTIONS } from "./vendor-auth/audit-actions.js";
import { createVendorAuth } from "./vendor-auth/config.js";
import type { VendorAuthRuntime } from "./vendor-auth/runtime.js";

/**
 * Загружает `.env`, если он есть рядом с приложением или в корне монорепозитория.
 * Ошибки в окружении валидируются Zod до старта сервера.
 */
function loadEnvFile(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(found);
  }
}

loadEnvFile();

const env = parseEnv();
const version = "0.0.1";
const vendorBaseUrl = resolveVendorBaseUrl(env);
const rateLimitStorage = resolveRateLimitStorage(env);
const logger = pino(loggerOptions(env));

const { initTelemetry } = await import("./telemetry.js");
const telemetry = await initTelemetry(env, { serviceName: "partner-coder-api", version });

const apiPool = createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX);
const db = createDatabase(apiPool);

const authPool = createPool(env.AUTH_DATABASE_URL ?? env.DATABASE_URL, env.DATABASE_POOL_MAX);
const authDb = createDatabase(authPool);

const vendorPool = createPool(env.VENDOR_DATABASE_URL ?? env.DATABASE_URL, env.DATABASE_POOL_MAX);
const vendorDb = createDatabase(vendorPool);

const vendorAuthPool = createPool(
  env.VENDOR_AUTH_DATABASE_URL ?? env.DATABASE_URL,
  env.DATABASE_POOL_MAX,
);
const vendorAuthDb = createDatabase(vendorAuthPool);

if (env.APP_ENV !== "local") {
  const apiErrors = roleSeparationErrors("api", await readRoleFacts((sql) => apiPool.query(sql)));
  const authErrors = roleSeparationErrors(
    "auth",
    await readRoleFacts((sql) => authPool.query(sql)),
  );
  const vendorErrors = roleSeparationErrors(
    "vendor",
    await readRoleFacts((sql) => vendorPool.query(sql)),
  );
  const vendorAuthErrors = roleSeparationErrors(
    "vendor_auth",
    await readRoleFacts((sql) => vendorAuthPool.query(sql)),
  );
  const errors = [...apiErrors, ...authErrors, ...vendorErrors, ...vendorAuthErrors];
  if (errors.length > 0) {
    process.stderr.write(`Неверное разделение ролей БД:\n${errors.join("\n")}\n`);
    throw new Error(
      "Проверьте DATABASE_URL, AUTH_DATABASE_URL, VENDOR_DATABASE_URL и VENDOR_AUTH_DATABASE_URL",
    );
  }
}

const mailer = new SmtpMailer(env);

const auth = createAuth({
  db: authDb,
  secret: env.AUTH_SECRET,
  baseURL: env.API_BASE_URL,
  webBaseURL: env.WEB_BASE_URL,
  sessionTtlHours: env.SESSION_TTL_HOURS,
  magicLinkTtlMinutes: env.MAGIC_LINK_TTL_MINUTES,
  mailer,
  rateLimitStorage,
  ipAddressHeaders: parseList(env.AUTH_IP_HEADERS),
  trustedProxies: parseList(env.AUTH_TRUSTED_PROXIES),
});

const emailRateLimitStore =
  rateLimitStorage === "database"
    ? new DatabaseEmailRateLimiter(db, {
        onError: (error) => logger.warn({ err: error }, "email_rate_limit_store_failed"),
      })
    : new EmailRateLimiter();

const vendorAuth = createVendorAuth({
  db: vendorAuthDb,
  secret: env.VENDOR_AUTH_SECRET ?? env.AUTH_SECRET,
  baseURL: env.API_BASE_URL,
  vendorBaseURL: vendorBaseUrl,
  sessionTtlHours: env.VENDOR_SESSION_TTL_HOURS,
  passwordResetTtlMinutes: env.VENDOR_PASSWORD_RESET_TTL_MINUTES,
  passwordMinLength: env.VENDOR_PASSWORD_MIN_LENGTH,
  webauthnRpId: resolveVendorWebauthnRpId(env),
  mailer,
  getVendorStatus: async (vendorUserId) =>
    (await getVendorUserById(vendorAuthDb, vendorUserId))?.status,
  getVendorStatusByEmail: async (email) =>
    (await getVendorUserByEmail(vendorAuthDb, email))?.status,
  onSessionCreated: async (vendorUserId, ip) => {
    try {
      await markVendorLogin(vendorDb, vendorUserId);
    } catch (error) {
      logger.warn({ err: error, vendorUserId }, "vendor_login_mark_failed");
    }
    try {
      await writeVendorAudit(vendorDb, {
        actorId: vendorUserId,
        action: VENDOR_AUDIT_ACTIONS.signInSucceeded,
        entity: "vendor_session",
        after: { userId: vendorUserId },
        ip,
      });
    } catch (error) {
      logger.warn({ err: error, vendorUserId }, "vendor_sign_in_audit_failed");
    }
  },
  onPasswordReset: async (vendorUserId) => {
    let status: string | null = null;
    try {
      status = (await activateAfterPasswordReset(vendorDb, vendorUserId)).status;
    } catch (error) {
      logger.warn({ err: error, vendorUserId }, "vendor_password_reset_activate_failed");
    }
    try {
      await writeVendorAudit(vendorDb, {
        actorId: null,
        action: "vendor.auth.password_reset_completed",
        entity: "vendor_user",
        after: { userId: vendorUserId, status },
        ip: null,
      });
    } catch (error) {
      logger.warn({ err: error, vendorUserId }, "vendor_password_reset_audit_failed");
    }
  },
  rateLimitStorage,
  ipAddressHeaders: parseList(env.AUTH_IP_HEADERS),
  trustedProxies: parseList(env.AUTH_TRUSTED_PROXIES),
});

const vendorEmailRateLimitStore =
  rateLimitStorage === "database"
    ? new DatabaseEmailRateLimiter(vendorAuthDb, {
        table: "vendor_auth_email_limits",
        onError: (error) => logger.warn({ err: error }, "vendor_email_rate_limit_store_failed"),
      })
    : new EmailRateLimiter();

const vendorRuntime: VendorAuthRuntime = {
  auth: vendorAuth,
  db: vendorDb,
  authDb: vendorAuthDb,
  vendorBaseUrl,
  stepUpMinutes: 5,
  packageTtlDays: env.PACKAGE_TTL_DAYS,
  packageVersion: env.MCP_MIN_VERSION,
};

const { buildServer } = await import("./server.js");
const corsOrigins = parseList(env.API_CORS_ORIGINS ?? `${env.WEB_BASE_URL},${vendorBaseUrl}`);
const server = buildServer({
  logger: loggerOptions(env),
  version,
  appEnv: env.APP_ENV,
  ...(env.METRICS_TOKEN ? { metricsToken: env.METRICS_TOKEN } : {}),
  corsOrigins,
  apiBaseUrl: env.API_BASE_URL,
  authRuntime: createAuthRuntime({ auth, db, webBaseUrl: env.WEB_BASE_URL }),
  emailRateLimitStore,
  vendorRuntime,
  vendorEmailRateLimitStore,
  onError: (error) => telemetry.captureException(error),
});

server.addHook("onClose", async () => {
  await apiPool.end();
  await authPool.end();
  await vendorPool.end();
  await vendorAuthPool.end();
  await telemetry.shutdown();
});

server
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then((address) => {
    server.log.info({ address, appEnv: env.APP_ENV }, "partner-coder API запущен");
  })
  .catch((error: unknown) => {
    server.log.error({ err: error }, "не удалось запустить API");
    process.exitCode = 1;
  });
