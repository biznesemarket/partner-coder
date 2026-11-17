import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL, fileURLToPath } from "node:url";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const e2eEnv = JSON.parse(readFileSync(resolve(here, "env.json"), "utf8"));
const databaseUrl = new URL(e2eEnv.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
const adminUrl = new URL(databaseUrl.toString());
const adminEmail = "e2e-superadmin@example.test";
const setupMfaAdminEmail = "e2e-a11y@example.test";
const buildArtifacts = [
  resolve(repoRoot, "apps/api/dist/main.js"),
  resolve(repoRoot, "apps/web/.next"),
];

if (!/^[a-z0-9_]+$/.test(databaseName) || !databaseName.endsWith("_e2e")) {
  throw new Error(`Неожиданное имя E2E-базы: ${databaseName}`);
}

adminUrl.pathname = "/postgres";

const childEnv = { ...process.env, ...e2eEnv };

function step(message) {
  process.stdout.write(`[e2e] ${message}\n`);
}

function assertBuildArtifacts() {
  const missing = buildArtifacts.filter((artifact) => !existsSync(artifact));

  if (missing.length === 0) {
    return;
  }

  process.stderr.write(`[e2e] не найдены артефакты сборки: ${missing.join(", ")}\n`);
  process.stderr.write("[e2e] run pnpm build\n");
  process.exit(1);
}

function run(command) {
  step(command);
  const result = spawnSync(command, {
    cwd: repoRoot,
    env: childEnv,
    shell: true,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Команда завершилась с кодом ${result.status ?? "null"}: ${command}`);
  }
}

async function recreateDatabase() {
  const { Client } = pg;
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  try {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`drop database if exists ${databaseName}`);
    await admin.query(`create database ${databaseName}`);
  } finally {
    await admin.end();
  }

  const e2e = new Client({ connectionString: databaseUrl.toString() });
  await e2e.connect();

  try {
    await e2e.query("drop schema if exists public cascade");
    await e2e.query("drop schema if exists drizzle cascade");
    await e2e.query("drop schema if exists pgboss cascade");
    await e2e.query("create schema public");
  } finally {
    await e2e.end();
  }
}

async function clearMailpit() {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await globalThis.fetch("http://localhost:8025/api/v1/messages", {
        method: "DELETE",
        signal: globalThis.AbortSignal.timeout(5_000),
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(`Mailpit: не удалось очистить письма (${response.status})`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw lastError instanceof Error ? lastError : new Error("Mailpit: не удалось очистить письма");
}

function adminMissingError(email) {
  const error = new Error(
    `E2E-админ ${email} не найден в ${databaseName}; проверьте env precedence`,
  );

  error.name = "E2eAdminMissingError";

  return error;
}

async function assertVendorAdminExists() {
  const { Client } = pg;
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();

  try {
    for (const email of [adminEmail, setupMfaAdminEmail]) {
      const result = await client.query("select 1 from vendor_users where email = $1", [email]);

      if (result.rowCount !== 1) {
        throw adminMissingError(email);
      }
    }
  } finally {
    await client.end();
  }
}

assertBuildArtifacts();

step(`Пересоздаю базу ${databaseName}`);
await recreateDatabase();

run("pnpm db:migrate");
run(`pnpm --filter @partner-coder/api vendor:admin --email ${adminEmail} --name "E2E Admin"`);
// Второй админ остаётся без TOTP: /setup-mfa нужен a11y-спеке, а у основного
// админа второй фактор включает setup-проект Playwright.
run(
  `pnpm --filter @partner-coder/api vendor:admin --email ${setupMfaAdminEmail} --name "E2E A11y" --force`,
);
await assertVendorAdminExists();

step("Очищаю Mailpit");
await clearMailpit();

step("Готово");
