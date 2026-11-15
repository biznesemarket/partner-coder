import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(packageDir, "drizzle");
const tempRoot = join(packageDir, ".drift-tmp");
const tempDrizzle = join(tempRoot, "drizzle");

function sqlFiles(folder) {
  return readdirSync(folder).filter((name) => name.endsWith(".sql")).length;
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  cpSync(source, tempDrizzle, { recursive: true });
  const before = sqlFiles(tempDrizzle);

  const kitBin = join(packageDir, "node_modules", "drizzle-kit", "bin.cjs");
  const result = spawnSync(
    process.execPath,
    [
      kitBin,
      "generate",
      "--schema",
      "./src/schema/index.ts",
      "--dialect",
      "postgresql",
      "--out",
      ".drift-tmp/drizzle",
      "--name",
      "drift_check",
    ],
    { cwd: packageDir, encoding: "utf8" },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  const after = sqlFiles(tempDrizzle);
  if (after !== before) {
    process.stderr.write(
      "Schema drift: drizzle-kit создал миграцию. Запустите pnpm db:generate и закоммитьте ее.\n",
    );
    process.stderr.write(result.stdout ?? "");
    process.exit(1);
  }

  process.stdout.write("Schema drift: нет\n");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
