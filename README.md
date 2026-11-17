# Партнер кодер

SaaS-платформа, которая превращает время работы разработчиков с ИИ-агентами
в ежедневные прозрачные начисления: рубли, расчетный процент вклада и
накопительный итог.

> **Граница продукта.** «Доля» — расчетный процент вклада (фантомная доля),
> а не юридическая доля в ООО и не ценная бумага. «Начислено» и «выплачено»
> всегда разделены. Платформа не проводит платежи разработчикам.

## Что уже есть

| Веха                         | Состояние                                                                |
| ---------------------------- | ------------------------------------------------------------------------ |
| M0 — фундамент репозитория   | каркас, стандарты, CI, ADR, спецификации, compose                        |
| M1 — доменное ядро           | политика, время, экономика, калькулятор, вестинг, golden-тесты           |
| M2.1 — платформенное ядро    | схема, RLS, append-only, аудит, идемпотентность, seed                    |
| M2.2 — аутентификация        | Better Auth, OTP/magic link, роли, приглашения, device-токены            |
| M2.3 — API/worker            | pg-boss, закрытие дня, TTL, якоря, метрики, OpenAPI                      |
| M3 PR A — вендорский вход    | password+TOTP, роли, аудит, rate limit, bootstrap CLI                    |
| M3 PR B — вендорская консоль | passkeys, Next.js BFF, login/reset/setup-mfa/me/security, Playwright E2E |
| M4–M11                       | следующие вехи — см. мега-план                                           |

Доменное ядро покрыто golden-тестами T-01…T-12 и E-01…E-08: числа зафиксированы
до копейки и до единицы доли.

## Стек

TypeScript end-to-end: Next.js (кабинеты), Fastify (API), pg-boss (worker),
TypeScript MCP-сервер, PostgreSQL 17 с RLS, Drizzle, Zod, Vitest, Playwright.

## Быстрый старт

```bash
pnpm install
docker compose -f deploy/compose/docker-compose.yml up -d   # PostgreSQL, Mailpit, S3
pnpm db:migrate    # схема, RLS, триггеры аудита
pnpm seed          # демо-данные: вендор, клиент, 3 разработчика, 5 дней
pnpm check         # prettier + eslint + typecheck + тесты (нужен PostgreSQL)
pnpm test:golden   # только golden-тесты домена
```

Консоль вендора — `http://localhost:3001`:

```bash
pnpm --filter @partner-coder/api dev
pnpm --filter @partner-coder/web dev   # нужен API_BASE_URL в apps/web/.env.local
```

Требуется Node.js ≥ 22.12 и pnpm ≥ 9. Вход в консоль, Mailpit, TOTP и
passkeys — в `docs/00-start/quickstart.md`.

## Структура

```text
apps/
  api/            Fastify API (health, tenant-auth, vendor-auth, tenant-маршруты)
  web/            Next.js: вендорская консоль и BFF (M3 PR B), кабинеты — M5
  worker/         pg-boss: закрытие дня, TTL, якоря, метрики
  mcp/            локальный MCP-сервер (каркас — M4)
  ide-extension/  расширение VS Code/Cursor (каркас — M6)
packages/
  domain/         чистое доменное ядро и golden-тесты
  contracts/      Zod-схемы API и MCP
  config/         конфигурация и валидация окружения
  db/             Drizzle-схема, миграции, RLS, аудит, auth-сервисы
  ui/             общие компоненты, токены и тема консоли (M3 PR B/M5)
  testing/        фабрики и утилиты тестов
  package-template/ шаблоны пакета подключения (M4)
docs/             нормативные спецификации, ADR, процессы
deploy/           compose, скрипты, окружения
tools/            seed, package-builder, load, security
```

## Документация

Правила работы — `AGENTS.md`. Вся техническая документация и порядок чтения —
`docs/index.md`.

## Лицензия

Source-available, все права защищены. См. `LICENSE`: код виден, коммерческое
использование ограничено; финальный текст лицензии утверждает юрист.
