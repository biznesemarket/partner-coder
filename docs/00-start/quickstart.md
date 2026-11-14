# Быстрый старт

## 1. Требования

- Node.js ≥ 22.6, pnpm ≥ 9 (ядро пакета зафиксировано в `package.json`).
- Docker Desktop (для PostgreSQL, Mailpit, MinIO).
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
```

| Сервис        | Адрес                 | Назначение                    |
| ------------- | --------------------- | ----------------------------- |
| PostgreSQL 17 | `localhost:5432`      | БД (логин/пароль `partner`)   |
| Mailpit       | http://localhost:8025 | SMTP-перехватчик писем        |
| MinIO         | http://localhost:9001 | S3-хранилище пакетов и счетов |

## 4. Проверки

```bash
pnpm test:golden   # 20 golden-сценариев домена
pnpm test          # + unit + property
pnpm typecheck     # tsc strict во всех пакетах
pnpm lint
pnpm check         # всё вместе: prettier + lint + typecheck + тесты
pnpm build         # turbo build
```

Ожидаемый результат: `Tests 66 passed`, все 20 golden-сценариев совпадают точно.

## 5. API (скелет)

```bash
pnpm --filter @partner-coder/api dev
curl http://localhost:4000/healthz
```

Отвечает `{ "status": "ok", "version": "0.0.1", … }`. Тенантные маршруты,
аутентификация и RLS появятся в M2.

## 6. Что читать дальше

1. `docs/02-domain/time-accounting.md` — как считается время.
2. `docs/02-domain/economics.md` — как считаются рубли и доля.
3. `docs/05-process/development-process.md` — как вести изменения.
4. `docs/adr/` — принятые архитектурные решения.

## 7. Частые проблемы

| Симптом                   | Причина                                 | Решение                                                              |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `EnvValidationError`      | не заполнен `.env`                      | скопировать `.env.example` и проверить поля                          |
| Порт 5432 занят           | локальный PostgreSQL                    | изменить порт в compose и `DATABASE_URL`                             |
| `pnpm test:golden` падает | изменились расчеты                      | не «поправлять» golden без ADR; см. `docs/02-domain/golden-tests.md` |
| `bun: command not found`  | bun нужен только для сборки `.exe` (M4) | установить bun перед M4                                              |
