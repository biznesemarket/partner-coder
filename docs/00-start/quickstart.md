# Быстрый старт

## 1. Требования

- Node.js ≥ 22.12, pnpm ≥ 9 (ядро пакета зафиксировано в `package.json`).
- Docker Desktop (для PostgreSQL, Mailpit, S3).
- Windows 10/11 для проверки MCP-сценариев; macOS/Linux — после пилота.

## 2. Установка

```bash
pnpm install
cp .env.example .env   # Windows PowerShell: Copy-Item .env.example .env
```

`packages/config/src/env.ts` валидирует окружение через Zod: сервис не
стартует с неполным `.env`.

## 3. Локальная инфраструктура

```bash
docker compose -f deploy/compose/docker-compose.yml up -d
pnpm db:migrate   # схема, RLS, триггеры аудита
pnpm seed         # демо-вендор, клиент, проект, 3 разработчика, 5 дней
```

| Сервис        | Адрес                 | Назначение                    |
| ------------- | --------------------- | ----------------------------- |
| PostgreSQL 17 | `localhost:5432`      | БД (логин/пароль `partner`)   |
| Mailpit       | http://localhost:8025 | SMTP-перехватчик писем        |
| S3 (SILO)     | http://localhost:9001 | S3-хранилище пакетов и счетов |

Если нужен только PostgreSQL: `docker compose ... up -d postgres`.

Письма входа (OTP и magic link) локально видны в Mailpit. В staging/prod
`AUTH_DATABASE_URL` должен указывать на логин роли `partner_coder_auth`;
локально можно не задавать — Better Auth использует `DATABASE_URL`.

## 4. Проверки

```bash
pnpm test:golden   # 20 golden-сценариев домена
pnpm test          # unit + property + интеграционные тесты БД
pnpm test:db       # схема, RLS, append-only, аудит, идемпотентность, seed
pnpm typecheck     # tsc strict во всех пакетах
pnpm lint
pnpm check         # всё вместе: prettier + lint + typecheck + тесты
pnpm build         # turbo build
```

Ожидаемый результат: весь набор зелёный; в PR B — 891 тест в 54 файлах, все
20 golden-сценариев совпадают точно. `pnpm check` и интеграционные тесты
создают отдельные БД, поэтому PostgreSQL должен быть запущен; в CI он
поднимается сервисом GitHub Actions. Без PostgreSQL падают тесты БД, а не
prettier/lint/typecheck.

E2E вендорской консоли требует собранных `apps/api/dist` и `apps/web/.next`,
PostgreSQL и Mailpit:

```bash
pnpm build            # обязательный шаг перед test:e2e
pnpm test:e2e         # prepare БД + Playwright (Chromium)
pnpm test:e2e:full    # pnpm build + pnpm test:e2e
```

`pnpm test:e2e` пересоздаёт БД `partner_coder_e2e`, применяет миграции,
создаёт e2e-админов, очищает Mailpit и запускает API и web на портах
4000/3001. Vitest не подхватывает `apps/web/e2e/*.spec.ts`.

## 5. API

```bash
pnpm --filter @partner-coder/api dev
curl http://localhost:4000/healthz
```

Отвечает `{ "status": "ok", "version": "0.0.1", … }`. В M2.2 работают
`/api/auth/*` (Better Auth: OTP, magic link), `/v1/auth/me`,
`/v1/auth/tenant`, приглашения, device-токены и tenant-маршруты; в M3 PR A —
вендорский `/api/vendor-auth/*` и `/v1/vendor/*`; см.
`docs/03-architecture/api.md`.

## 6. Вендорская консоль

Консоль — Next.js в `apps/web` на `http://localhost:3001`. Браузер работает
только с этим origin: same-origin BFF проксирует запросы в API на
`http://localhost:4000` (ADR-0014). Прямой вход в API из браузера не нужен.

Запуск в двух терминалах:

```bash
pnpm --filter @partner-coder/api dev
pnpm --filter @partner-coder/web dev
```

API читает корневой `.env`; web-серверу нужны `API_BASE_URL` и
`VENDOR_BASE_URL`. Next не подхватывает корневой `.env`, поэтому создайте
`apps/web/.env.local` (gitignored) или передайте переменные в окружение:

```dotenv
API_BASE_URL=http://localhost:4000
VENDOR_BASE_URL=http://localhost:3001
```

Откройте `http://localhost:3001`; неаутентифицированный пользователь попадёт
на `/login`. Маршруты: `/login`, `/reset-password`, `/setup-mfa`, `/me`,
`/me/security`.

### 6.1 Первый вход и TOTP

`pnpm seed` создаёт демо-суперадминистратора `vendor@demo.partnercoder.local`
в статусе `invited`, без пароля, TOTP и passkeys.

1. На `/login` нажмите «Забыли пароль?» и запросите ссылку для
   `vendor@demo.partnercoder.local`. Ответ нейтрален и не раскрывает
   существование пользователя.
2. Письмо придёт в Mailpit (http://localhost:8025). Откройте ссылку
   `http://localhost:3001/reset-password?token=…`, задайте пароль (минимум
   12 символов). Токен одноразовый, действует 30 минут и удаляется из
   адресной строки после чтения; после сброса старые сессии отзываются.
3. Войдите с email и паролем. Пока `two_factor_enabled = false`, консоль
   принудительно ведёт на `/setup-mfa`: повторно введите пароль, добавьте
   TOTP-аккаунт по QR или секрету, сохраните 10 backup-кодов и подтвердите
   6-значный код. После этого откроется `/me`.
4. Последующие входы по паролю просят код TOTP (или backup-код).
   Отключение TOTP в UI недоступно; сброс — только суперадминистратором.

### 6.2 Passkey

Passkey — дополнительный способ входа; TOTP остаётся обязательным. На
`/me/security` в разделе «Ключи доступа» нажмите «Добавить», задайте имя и
подтвердите WebAuthn-регистрацию на устройстве. Плагин требует user
verification и resident (discoverable) key; non-discoverable cross-platform
ключи не подойдут.

После выхода на `/login` появляется кнопка «Войти с ключом доступа
(passkey)» — вход выполняется без email. Потеря passkey не блокирует вход,
пока есть пароль и TOTP/backup-коды; self-service сброса MFA нет.

Управление passkeys, смена пароля и отзыв сессий до включения TOTP отвечают
403 `vendor_mfa_required`: сначала завершите `/setup-mfa`. Выход из аккаунта
доступен всегда.

### 6.3 Bootstrap и staging

`pnpm seed` уже создаёт суперадминистратора, поэтому локальный bootstrap
другого админа запускается с `--force` — без него CLI откажется создавать
второго superadmin:

```bash
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops" --force
```

CLI создаёт пользователя в статусе `invited` и отправляет письмо со ссылкой
сброса. Пароль и токен не печатаются. `--force` создаёт нового superadmin
только для другого email; существующего active/suspended/disabled
пользователя он не сбрасывает.

В staging на пустой БД первый superadmin создаётся без `--force` (боевые
`DATABASE_URL`, `VENDOR_DATABASE_URL`, `VENDOR_AUTH_DATABASE_URL`, `SMTP_*`):

```bash
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops"
```

Повторный запуск для того же invited-superadmin идемпотентен и переотправляет
ссылку. Проверить профиль и MFA-состояние можно через `GET /v1/vendor/auth/me`
(cookie сессии), список вендорских пользователей — `GET /v1/vendor/users`
(только superadmin + TOTP).

## 7. Что читать дальше

1. `docs/02-domain/time-accounting.md` — как считается время.
2. `docs/02-domain/economics.md` — как считаются рубли и доля.
3. `docs/05-process/development-process.md` — как вести изменения.
4. `docs/adr/` — принятые архитектурные решения.

## 8. Частые проблемы

| Симптом                   | Причина                                 | Решение                                                              |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `EnvValidationError`      | не заполнен `.env`                      | скопировать `.env.example` и проверить поля                          |
| Порт 5432 занят           | локальный PostgreSQL                    | изменить порт в compose и `DATABASE_URL`                             |
| `pnpm test:golden` падает | изменились расчеты                      | не «поправлять» golden без ADR; см. `docs/02-domain/golden-tests.md` |
| `bun: command not found`  | bun нужен только для сборки `.exe` (M4) | установить bun перед M4                                              |
