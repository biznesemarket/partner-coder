import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseEnv, resolveVendorBaseUrl } from "@partner-coder/config";
import {
  createDatabase,
  createPool,
  getVendorUserByEmail,
  getVendorUserById,
  listVendorUsers,
  updateVendorUser,
  writeVendorAudit,
  type Database,
} from "@partner-coder/db";

import { readRoleFacts, roleSeparationErrors } from "../auth/db-roles.js";
import { SmtpMailer, type AuthMailer } from "../auth/mailer.js";
import { normalizeBaseUrl } from "../vendor-auth/base-url.js";
import { createVendorAuth, type VendorAuth } from "../vendor-auth/config.js";

const USAGE =
  "Использование: pnpm --filter @partner-coder/api vendor:admin -- --email <email> [--name <name>] [--force]";

export interface ProvisionVendorAdminDeps {
  readonly db: Database;
  readonly authDb: Database;
  readonly auth: VendorAuth;
  readonly mailer: AuthMailer;
  readonly vendorBaseUrl: string;
}

export interface ProvisionVendorAdminInput {
  readonly email: string;
  readonly name: string;
  readonly force: boolean;
}

export interface ProvisionVendorAdminResult {
  readonly userId: string;
  readonly invited: boolean;
}

interface CliOptions {
  readonly email: string;
  readonly name: string;
  readonly force: boolean;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "***";
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) {
    throw new Error("Укажите корректный email");
  }
  return normalized;
}

async function sendResetLink(deps: ProvisionVendorAdminDeps, email: string): Promise<void> {
  await deps.auth.api.requestPasswordReset({
    body: {
      email,
      redirectTo: `${normalizeBaseUrl(deps.vendorBaseUrl)}/reset-password`,
    },
  });
}

export async function provisionVendorAdmin(
  deps: ProvisionVendorAdminDeps,
  input: ProvisionVendorAdminInput,
): Promise<ProvisionVendorAdminResult> {
  const email = normalizeEmail(input.email);
  const existing = await getVendorUserByEmail(deps.db, email);

  if (existing) {
    if (existing.status !== "invited") {
      throw new Error(
        `Вендор ${email} уже существует со статусом ${existing.status}; измените статус через PATCH /v1/vendor/users/:id`,
      );
    }
    if (existing.role !== "superadmin") {
      throw new Error(
        `Пользователь ${email} уже приглашён с ролью ${existing.role}; повысьте роль через PATCH /v1/vendor/users/:id`,
      );
    }
    await sendResetLink(deps, email);
    return { userId: existing.id, invited: true };
  }

  const superadminExists = (await listVendorUsers(deps.db)).some(
    (user) => user.role === "superadmin",
  );
  if (superadminExists && !input.force) {
    throw new Error("superadmin уже существует; передайте --force, чтобы создать нового");
  }

  const password = randomBytes(32).toString("base64url");
  const signedUp = await deps.auth.api.signUpEmail({
    body: { email, name: input.name, password },
  });
  const user = await updateVendorUser(deps.db, signedUp.user.id, {
    role: "superadmin",
    status: "invited",
  });
  if (!user) {
    throw new Error(`Не удалось назначить superadmin для ${email}`);
  }

  await sendResetLink(deps, email);
  await writeVendorAudit(deps.db, {
    actorId: null,
    action: "vendor.user.bootstrap_admin",
    entity: "vendor_user",
    after: {
      userId: user.id,
      email: maskEmail(email),
      role: user.role,
      status: user.status,
    },
    ip: null,
  });

  return { userId: user.id, invited: true };
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  let email: string | undefined;
  let name = "Superadmin";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--email" || arg === "--name") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Не указано значение для ${arg}`);
      }
      if (arg === "--email") {
        email = value;
      } else {
        name = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    throw new Error(`Неизвестный аргумент: ${arg ?? ""}`);
  }

  if (!email) {
    throw new Error("Укажите --email");
  }
  return { email, name, force };
}

function loadEnvFile(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(found);
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const options = parseCliArgs(argv);
  const env = parseEnv();
  const vendorBaseUrl = resolveVendorBaseUrl(env);
  const vendorPool = createPool(env.VENDOR_DATABASE_URL ?? env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const vendorAuthPool = createPool(
    env.VENDOR_AUTH_DATABASE_URL ?? env.DATABASE_URL,
    env.DATABASE_POOL_MAX,
  );
  const db = createDatabase(vendorPool);
  const authDb = createDatabase(vendorAuthPool);

  try {
    if (env.APP_ENV !== "local") {
      const errors = [
        ...roleSeparationErrors("vendor", await readRoleFacts((sql) => vendorPool.query(sql))),
        ...roleSeparationErrors(
          "vendor_auth",
          await readRoleFacts((sql) => vendorAuthPool.query(sql)),
        ),
      ];
      if (errors.length > 0) {
        throw new Error(
          `Неверное разделение ролей БД:\n${errors.join("\n")}\n` +
            "Проверьте VENDOR_DATABASE_URL и VENDOR_AUTH_DATABASE_URL",
        );
      }
    }

    const mailer = new SmtpMailer(env);
    const auth = createVendorAuth({
      db: authDb,
      secret: env.VENDOR_AUTH_SECRET ?? env.AUTH_SECRET,
      baseURL: env.API_BASE_URL,
      vendorBaseURL: vendorBaseUrl,
      sessionTtlHours: env.VENDOR_SESSION_TTL_HOURS,
      passwordResetTtlMinutes: env.VENDOR_PASSWORD_RESET_TTL_MINUTES,
      passwordMinLength: env.VENDOR_PASSWORD_MIN_LENGTH,
      mailer,
      getVendorStatus: async (vendorUserId) =>
        (await getVendorUserById(authDb, vendorUserId))?.status,
      getVendorStatusByEmail: async (email) => (await getVendorUserByEmail(authDb, email))?.status,
      onSessionCreated: async () => {},
      onPasswordReset: async () => {},
    });

    await provisionVendorAdmin({ db, authDb, auth, mailer, vendorBaseUrl }, options);
    process.stdout.write(`invite sent: ${options.email.trim().toLowerCase()}\n`);
  } finally {
    await Promise.all([vendorPool.end(), vendorAuthPool.end()]);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `vendor admin bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`,
    );
    process.exitCode = 1;
  });
}
