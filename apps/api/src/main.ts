import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { parseEnv, parseList } from "@partner-coder/config";
import { createDatabase, createPool } from "@partner-coder/db";

import { createAuth } from "./auth/config.js";
import { readRoleFacts, roleSeparationErrors } from "./auth/db-roles.js";
import { SmtpMailer } from "./auth/mailer.js";
import { createAuthRuntime } from "./auth/runtime.js";
import { loggerOptions } from "./logger.js";

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

const { initTelemetry } = await import("./telemetry.js");
const telemetry = await initTelemetry(env, { serviceName: "partner-coder-api", version });

const apiPool = createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX);
const db = createDatabase(apiPool);

const authPool = createPool(env.AUTH_DATABASE_URL ?? env.DATABASE_URL, env.DATABASE_POOL_MAX);
const authDb = createDatabase(authPool);

if (env.APP_ENV !== "local") {
  const apiErrors = roleSeparationErrors("api", await readRoleFacts((sql) => apiPool.query(sql)));
  const authErrors = roleSeparationErrors(
    "auth",
    await readRoleFacts((sql) => authPool.query(sql)),
  );
  const errors = [...apiErrors, ...authErrors];
  if (errors.length > 0) {
    process.stderr.write(`Неверное разделение ролей БД:\n${errors.join("\n")}\n`);
    throw new Error("Проверьте DATABASE_URL и AUTH_DATABASE_URL");
  }
}

const auth = createAuth({
  db: authDb,
  secret: env.AUTH_SECRET,
  baseURL: env.API_BASE_URL,
  webBaseURL: env.WEB_BASE_URL,
  sessionTtlHours: env.SESSION_TTL_HOURS,
  magicLinkTtlMinutes: env.MAGIC_LINK_TTL_MINUTES,
  mailer: new SmtpMailer(env),
  ipAddressHeaders: parseList(env.AUTH_IP_HEADERS),
  trustedProxies: parseList(env.AUTH_TRUSTED_PROXIES),
});

const { buildServer } = await import("./server.js");
const corsOrigins = parseList(env.API_CORS_ORIGINS ?? `${env.WEB_BASE_URL},${env.VENDOR_BASE_URL}`);
const server = buildServer({
  logger: loggerOptions(env),
  version,
  appEnv: env.APP_ENV,
  ...(env.METRICS_TOKEN ? { metricsToken: env.METRICS_TOKEN } : {}),
  corsOrigins,
  apiBaseUrl: env.API_BASE_URL,
  authRuntime: createAuthRuntime({ auth, db, webBaseUrl: env.WEB_BASE_URL }),
  onError: (error) => telemetry.captureException(error),
});

server.addHook("onClose", async () => {
  await apiPool.end();
  await authPool.end();
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
