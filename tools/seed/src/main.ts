import { fileURLToPath } from "node:url";

import { createDatabase, createPool } from "@partner-coder/db";

import { seedDemo } from "./seed.js";

async function main(): Promise<void> {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    // В CI и на staging переменные приходят из окружения.
  }

  const connectionString =
    process.env.DATABASE_URL ?? "postgres://partner:partner@localhost:5432/partner_coder";
  const pool = createPool(connectionString);
  try {
    const summary = await seedDemo(createDatabase(pool));
    process.stdout.write(
      `${JSON.stringify(
        {
          ...summary,
          amountKopecks: summary.amountKopecks.toString(),
          equityKopecks: summary.equityKopecks.toString(),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
