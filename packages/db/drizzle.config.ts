import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // `.env` отсутствует в CI: используется DATABASE_URL из окружения.
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://partner:partner@localhost:5432/partner_coder",
  },
  strict: true,
  verbose: true,
});
