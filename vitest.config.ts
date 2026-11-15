import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const pkg = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Тесты работают с исходниками пакетов, а не со собранным dist.
      "@partner-coder/domain": pkg("./packages/domain/src/index.ts"),
      "@partner-coder/config": pkg("./packages/config/src/index.ts"),
      "@partner-coder/contracts": pkg("./packages/contracts/src/index.ts"),
      "@partner-coder/db": pkg("./packages/db/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tools/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
    reporters: ["default"],
    testTimeout: 20_000,
    // Интеграционные тесты создают и удаляют отдельные БД и роли PostgreSQL.
    // Параллельный запуск файлов приводит к гонкам DDL и сбросу соединений.
    fileParallelism: false,
  },
});
