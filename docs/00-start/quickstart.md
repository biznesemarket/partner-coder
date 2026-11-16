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

Ожидаемый результат: `Tests 768 passed`, все 20 golden-сценариев совпадают
точно. Интеграционные тесты создают отдельные БД, поэтому PostgreSQL должен
быть запущен; в CI он поднимается сервисом GitHub Actions.

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

## 6. Вход в консоль вендора

В PR A ещё нет вендорского веб-кабинета: экран входа появится в PR B вместе с
консолью. Пока вход проверяется через Mailpit и HTTP-маршруты Better Auth.

`pnpm seed` уже создаёт демо-суперадминистратора, поэтому локальный bootstrap
запускается с `--force` — без него CLI откажется создавать второго superadmin:

```bash
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops" --force
```

CLI создаёт пользователя со статусом `invited` и отправляет письмо со ссылкой
сброса пароля. Пароль и токен не печатаются. `--force` создаёт нового
superadmin только для другого email; существующего active/suspended/disabled
пользователя он не сбрасывает.

1. Запросите ссылку: `POST /api/vendor-auth/request-password-reset` с
   `{ "email": "ops@example.com", "redirectTo": "http://localhost:3001/reset-password" }`.
2. Письмо придёт в Mailpit (http://localhost:8025). Ссылка ведёт на
   `http://localhost:3001/reset-password?token=…`, но страницы консоли в
   PR A ещё нет — не открывайте её, а скопируйте значение `token` из query.
3. Установите пароль: `POST /api/vendor-auth/reset-password` с
   `{ "token": "...", "newPassword": "..." }` — учётная запись станет `active`.
   Токен одноразовый и действует 30 минут.
4. Войдите: `POST /api/vendor-auth/sign-in/email` с email и паролем.
5. Включите TOTP: `POST /api/vendor-auth/two-factor/enable`, затем подтвердите
   секрет через `POST /api/vendor-auth/two-factor/verify-totp`. После этого
   `POST /api/vendor-auth/sign-in/email` отвечает `twoFactorRedirect: true`,
   и вход завершается кодом из authenticator.

Пример установки пароля (PowerShell, после копирования токена из Mailpit):

```powershell
$token = "вставьте-token-из-письма"
Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/vendor-auth/reset-password `
  -ContentType "application/json" `
  -Body (@{ token = $token; newPassword = "correct horse battery staple" } | ConvertTo-Json)
```

После сброса пароля все старые сессии отзываются. Проверить профиль и
MFA-состояние можно через `GET /v1/vendor/auth/me` (cookie сессии), а список
вендорских пользователей — `GET /v1/vendor/users` (только superadmin + TOTP).

В staging на пустой БД первый superadmin создаётся без `--force` (боевые
переменные окружения `DATABASE_URL`, `VENDOR_DATABASE_URL`,
`VENDOR_AUTH_DATABASE_URL`, `SMTP_*`):

```bash
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops"
```

Повторный запуск для того же invited-superadmin идемпотентен и переотправляет
ссылку.

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
