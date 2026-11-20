# ADR-0001: TypeScript-монорепозиторий и стек

| Поле     | Значение                                                        |
| -------- | --------------------------------------------------------------- |
| Статус   | принято                                                         |
| Дата     | 2026-11-15                                                      |
| Контекст | новый продукт «Партнёр кодер», старый Python-код не переносится |

## Контекст

Продукт состоит из веб-кабинетов, API, фонового worker, локального MCP-сервера и
VS Code-расширения. Контракты между ними меняются часто, ошибки в расчетах
дорогие, команда маленькая. Нужен один язык и один источник типов.

## Решение

- Монорепозиторий pnpm workspaces + Turborepo.
- TypeScript strict (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) во всех пакетах.
- Next.js App Router (`apps/web`), Fastify + Zod (`apps/api`), pg-boss
  (`apps/worker`), TypeScript MCP SDK (`apps/mcp`), VS Code Extension API
  (`apps/ide-extension`).
- Общие пакеты: `domain` (чистое ядро), `contracts` (Zod/OpenAPI), `db`
  (Drizzle), `ui`, `config`, `testing`, `package-template`.
- Пакеты собираются в `dist` и экспортируют его (`exports` → `dist/index.js`,
  `dist/index.d.ts`); `turbo` собирает зависимости перед typecheck и build.
- Тесты работают с исходниками через alias в `vitest.config.ts`, поэтому
  `pnpm test` не требует предварительной сборки и проверяет тот же код.
- Тесты: Vitest, fast-check, Playwright; lint — ESLint 9 + typescript-eslint;
  форматирование — Prettier.

## Последствия

- Плюс: единые типы от БД до MCP, быстрый рефакторинг контрактов, один CI.
- Минус: приложения должны уметь транспилировать workspace-пакеты
  (`transpilePackages` в Next.js, `tsx` в dev-режиме API).
- Минус: строгий TypeScript требует дисциплины в адаптерах внешних API.

## Альтернативы

- Python-ядро + TS-фронтенд: два источника типов, расхождение контрактов.
- Отдельные репозитории: сложнее синхронизировать golden-тесты и контракты.
