import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { parseEnv } from "@partner-coder/config";

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
const server = buildServer({ logger: env.LOG_LEVEL !== "fatal" });

server
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then((address) => {
    server.log.info({ address, appEnv: env.APP_ENV }, "partner-coder API запущен");
  })
  .catch((error: unknown) => {
    server.log.error({ err: error }, "не удалось запустить API");
    process.exitCode = 1;
  });
