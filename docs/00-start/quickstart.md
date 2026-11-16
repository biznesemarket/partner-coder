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

Ожидаемый результат: `Tests 635 passed`, все 20 golden-сценариев совпадают
точно. Интеграционные тесты создают отдельные БД, поэтому PostgreSQL должен
быть запущен; в CI он поднимается сервисом GitHub Actions.

## 5. API

```bash
pnpm --filter @partner-coder/api dev
curl http://localhost:4000/healthz
```

Отвечает `{ "status": "ok", "version": "0.0.1", … }`. В M2.2 работают
`/api/auth/*` (Better Auth: OTP, magic link), `/v1/auth/me`,
`/v1/auth/tenant`, приглашения, device-токены и tenant-маршруты; см.
`docs/03-architecture/api.md`.

## 6. Вход в консоль вендора

Первого вендорского `superadmin` создаёт CLI (пароль и токен не печатаются):

```bash
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops"
```

CLI создаёт пользователя со статусом `invited` и отправляет письмо со ссылкой
сброса пароля. Если `superadmin` уже есть, без `--force` команда откажется;
`--force` создаёт нового только для другого email.

1. Откройте http://localhost:3001/login и нажмите «Забыли пароль».
2. Введите email и заберите письмо в Mailpit (http://localhost:8025).
3. Перейдите по ссылке и установите пароль — учётная запись станет `active`.
4. При первом входе включите TOTP: отсканируйте QR-код или введите секрет
   в приложение-аутентификатор.

Демо-вендор из `pnpm seed` создаётся со статусом `invited` без пароля и TOTP,
поэтому для локального входа используйте CLI выше.

В staging тот же CLI запускается с боевыми переменными окружения (`DATABASE_URL`,
`VENDOR_DATABASE_URL`, `VENDOR_AUTH_DATABASE_URL`, `SMTP_*`):

```bash
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops"
```

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
