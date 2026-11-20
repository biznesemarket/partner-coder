import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const e2eEnv = JSON.parse(readFileSync(resolve(here, "../env.json"), "utf8")) as {
  DATABASE_URL: string;
};

/**
 * E2E использует database rate-limit store, как staging. Перед входом очищаем
 * окна, чтобы special-rule Better Auth (`/sign-in*` — 3/10 с на IP+путь) и
 * per-email лимит 5/60 не зависели от порядка тестов и входов setup-проекта.
 */
export async function clearVendorRateLimits(): Promise<void> {
  const client = new Client({
    connectionString: e2eEnv.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });

  await client.connect();

  try {
    await client.query("delete from vendor_auth_rate_limits");
    await client.query("delete from vendor_auth_email_limits");
  } finally {
    await client.end();
  }
}
