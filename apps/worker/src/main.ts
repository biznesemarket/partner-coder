import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { parseEnv } from "@partner-coder/config";
import { createDatabase, createPool } from "@partner-coder/db";

import { startWorker } from "./boss.js";
import { readWorkerRoleFacts, workerRoleErrors } from "./db-roles.js";
import { createLogger } from "./logger.js";
import { JobMetrics, startMetricsServer } from "./metrics.js";

function loadEnvFile(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(found);
  }
}

loadEnvFile();

const env = parseEnv();
const logger = createLogger(env);
const metrics = new JobMetrics();
const pool = createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX, env.AUDIT_HMAC_KEY);
const db = createDatabase(pool);

if (env.APP_ENV !== "local") {
  const roleErrors = workerRoleErrors(await readWorkerRoleFacts((sql) => pool.query(sql)));
  if (roleErrors.length > 0) {
    logger.error({ roleErrors }, "worker_role_separation_failed");
    throw new Error(`Неверная роль БД worker:\n${roleErrors.join("\n")}`);
  }
}

const metricsServer = await startMetricsServer(metrics.registry, env.WORKER_METRICS_PORT, logger);
const worker = await startWorker({ env, db, logger, metrics });

let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker_stopping");
  try {
    await worker.stop();
    await new Promise<void>((resolveClose) => metricsServer.close(() => resolveClose()));
    await pool.end();
    process.exitCode = 0;
  } catch (error) {
    logger.error({ err: error }, "worker_stop_failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled_rejection");
});
