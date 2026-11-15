import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { parseEnv, parseList } from "@partner-coder/config";
import { createDatabase, createPool } from "@partner-coder/db";

import { createAuth } from "./auth/config.js";
import { readRoleFacts, roleSeparationErrors } from "./auth/db-roles.js";
import { SmtpMailer } from "./auth/mailer.js";
import { createAuthRuntime } from "./auth/runtime.js";
import { buildServer } from "./server.js";

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

const server = buildServer({
  logger: env.LOG_LEVEL !== "fatal",
  authRuntime: createAuthRuntime({ auth, db, webBaseUrl: env.WEB_BASE_URL }),
});

server.addHook("onClose", async () => {
  await apiPool.end();
  await authPool.end();
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
