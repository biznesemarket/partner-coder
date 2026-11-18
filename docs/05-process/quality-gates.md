# Quality gates

| Поле   | Значение   |
| ------ | ---------- |
| Код    | PROC-GATES |
| Версия | 1.1        |

## 1. Уровни проверок

| Уровень     | Инструмент             | Что проверяет                                               |
| ----------- | ---------------------- | ----------------------------------------------------------- |
| Unit        | Vitest                 | домен, политика, калькулятор, вестинг, утилиты              |
| Golden      | Vitest                 | T-01…T-12, E-01…E-08 — точные числа                         |
| Property    | fast-check             | инварианты union, капов, округления, монотонности           |
| Integration | Vitest + PostgreSQL    | RLS, репозитории, API, очереди, вебхуки (M2)                |
| Contract    | Zod/OpenAPI            | схемы API, `/openapi.json`, типы клиента (M2.3)             |
| E2E         | Playwright             | вендорская консоль (M3), далее директор/разработчик (M5–M8) |
| MCP         | MCP SDK client         | tools/list, tool calls, ошибки, enrollment (M4)             |
| Load        | k6                     | heartbeat, закрытие, дашборды (M6, M9)                      |
| Security    | CodeQL, audit, pentest | уязвимости и изоляция                                       |
| Manual      | чек-листы              | 3 ИИ-клиента × чистая Windows VM                            |

## 2. Обязательные проверки PR

```bash
docker compose -f deploy/compose/docker-compose.yml up -d postgres
pnpm db:migrate
pnpm db:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test          # unit + golden + property + интеграционные тесты БД
pnpm build
pnpm --filter @partner-coder/api openapi:emit
pnpm --filter @partner-coder/api openapi:types
```

Для изменений API обязательна проверка `/openapi.json` и regenerated-типов;
для worker — интеграционные тесты jobs на PostgreSQL и smoke pg-boss.
Плюс в CI: secret scan, dependency review. Для изменений схемы БД обязательны
миграция на чистой базе и тесты RLS/append-only/аудита.

### 2.1 E2E вендорской консоли

Playwright проверяет полный сценарий: сброс пароля через Mailpit, TOTP,
добавление passkey виртуальным authenticator, выход и passkey-вход, а также
негативные ошибки и axe-проверки.

```bash
pnpm build          # apps/api/dist и apps/web/.next обязательны
pnpm test:e2e       # prepare БД + Playwright (Chromium)
pnpm test:e2e:full  # pnpm build + pnpm test:e2e
```

- Нужны запущенные PostgreSQL и Mailpit; `prepare.mjs` пересоздаёт БД
  `partner_coder_e2e`, применяет миграции, создаёт e2e-админов и очищает
  Mailpit. Mailpit зафиксирован по версии (`axllent/mailpit:v1.33.1`) и имеет
  healthcheck `/readyz` в compose и CI.
- Playwright сам поднимает API (`node ../api/dist/main.js`) и web
  (`pnpm start`) на портах 4000/3001; `reuseExistingServer: false`.
- CI job `e2e` в `.github/workflows/ci.yml` использует сервисы PostgreSQL и
  Mailpit, ставит Chromium и выполняет `pnpm build` + `pnpm test:e2e`.
  `trace: retain-on-failure`, screenshot/video на падении; при ошибке job
  выгружает `apps/web/playwright-report` и `apps/web/test-results` артефактом.
- E2E использует `RATE_LIMIT_STORAGE=database` (как staging). Перед входом
  тесты очищают `vendor_auth_rate_limits` и `vendor_auth_email_limits`, чтобы
  special-rule Better Auth (`/sign-in*` — 3/10 с на IP+путь за BFF) и
  per-email 5/60 не зависели от порядка тестов и входов setup-проекта.
- Job пока **не входит** в обязательные проверки PR (format/lint/typecheck/
  test/build, commit messages, secret scan, CodeQL). Предпосылки для перевода
  в required (429-coupling, trace/artifacts, pin/healthcheck Mailpit) закрыты;
  нужна серия зелёных прогонов на PR/main, после чего job добавляется в
  ruleset.
- Vitest не подхватывает `apps/web/e2e/*.spec.ts`: это отдельный Playwright
  набор, а не unit-тесты.

## 3. Ветка main

- Полный набор проверок.
- CodeQL и dependency review.
- Деплой на staging и smoke-проверка `/healthz` (M2+).

## 4. Релиз

- Подписанные бинарники (Windows), checksum.
- Changelog и версия.
- Миграции вперед + план отката.
- SBOM.

## 5. Пилот

- Acceptance-чек-лист (директор + вендор).
- Restore drill (RPO/RTO).
- Нагрузочный профиль: 50 tenant × 50 разработчиков.
- Юридические тексты согласованы.

## 6. Запреты

- Не отключать проверки ради зеленого прогона.
- Не коммитить сгенерированные секреты и `.env`.
- Не «поправлять» golden без ADR.
- Не мержить красный CI.
