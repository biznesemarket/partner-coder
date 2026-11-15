# Архитектура: обзор

| Поле      | Значение                               |
| --------- | -------------------------------------- |
| Код       | ARCH-OVERVIEW                          |
| Версия    | 1.0                                    |
| Связанные | ADR-0001, ADR-0002, ADR-0006, ADR-0007 |

## 1. Контекст (C4 L1)

```text
[Суперадмин] ──клиенты, счета, оплаты, пакеты──────────────┐
[Директор] ────дашборд, политика, команда, выплаты─────────┤
[Разработчик] ─ИИ-клиент + расширение IDE──────────────────┤
[ИИ-ассистент] ─MCP: онбординг, сессии, дайджест───────────┤
[Git-платформа] ─вебхуки: ветки, PR, задачи───────────────┤
                                                            ▼
                                                   [Партнер кодер SaaS]
                                                            │
        ┌──────────email / Telegram / in-app────────────────┤
        ▼                                                   │
[Директор, разработчик]                                      ▼
                                                   [PostgreSQL + Storage]
```

Границы доверия: платформа не вызывает внешние LLM, не хранит код, промпты и
содержимое файлов. MCP-сервер работает локально. Git-коннектор читает только
метаданные.

## 2. Контейнеры (C4 L2)

| Контейнер                   | Технология                              | Ответственность                                           | Веха            |
| --------------------------- | --------------------------------------- | --------------------------------------------------------- | --------------- |
| `apps/web`                  | Next.js App Router, Tailwind, shadcn/ui | консоль вендора, кабинеты директора и разработчика        | M3, M5          |
| `apps/api`                  | Fastify, Zod, OpenAPI                   | REST, auth, изоляция tenant, онбординг, вебхуки           | M2 (готово)     |
| `apps/worker`               | Node.js, pg-boss                        | закрытие дня, якоря, TTL/retention, метрики               | M2.3 (готово)   |
| `apps/mcp`                  | MCP SDK, Bun compile                    | локальный сервер: enrollment, сессии, heartbeat, дайджест | M4              |
| `apps/ide-extension`        | VS Code API                             | присутствие, фокус, статус-бар, старт/пауза               | M6              |
| `packages/domain`           | чистый TypeScript                       | политика, время, экономика, калькулятор, вестинг          | **M1 (готово)** |
| `packages/db`               | Drizzle, PostgreSQL                     | схема, миграции, RLS, репозитории                         | M2.1            |
| `packages/contracts`        | Zod + OpenAPI                           | схемы API и MCP                                           | M2.3 (готово)   |
| `packages/ui`               | React                                   | общие компоненты                                          | M5              |
| `packages/package-template` | шаблоны                                 | START-HERE, AGENTS, конфиги MCP                           | M4              |

## 3. Потоки

### Enrollment

```text
Zip token → MCP enroll → API validates hash/TTL/one-use → device key registered
→ device token (DPAPI) → onboarding session → email magic link
→ director verifies → role upgraded → tenant active
```

### Heartbeat

```text
IDE/MCP signals → локальный агент классифицирует интервал → подпись Ed25519
→ POST /v1/agent/heartbeats (batch, seq) → API проверяет token/tenant/seq/signature
→ append-only интервал → закрытие дня позже
```

### Закрытие дня

```text
pg-boss scan (каждые 15 мин) → timezone + close_at → список пропущенных дат
→ pg-boss job (tenant/project/date) → advisory lock → policy + intervals + facts
→ calculateDay (чистый домен) → day_record + flags + input_hash
→ digest job → email/Telegram/in-app/MCP
```

Повтор задания с тем же `input_hash` — `duplicate`; изменившиеся данные
создают `day_adjustment`. После закрытия UTC-суток worker проверяет цепочки
аудита и ставит дневные якоря. TTL-задание удаляет истекшие ключи, OTP и
сессии, отзывает device-токены suspended tenant и вызывает retention-функцию
для сырых heartbeat. Детали — ADR-0011.

### Вебхук

```text
Git platform → POST /v1/hooks/{provider} → HMAC сырого тела → dedupe delivery_id
→ только метаданные → связывание сессий по ветке/задаче → no_output
```

## 4. Окружения

| Окружение | Назначение      | Данные                                                                                                         |
| --------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| local     | разработка      | Docker Compose: PostgreSQL, Mailpit, MinIO; seed                                                               |
| staging   | приемка и демо  | отдельная БД, синтетический tenant; конфигурация — `deploy/environments/staging` (деплой ждет выбора хостинга) |
| prod      | пилот и продажи | managed PostgreSQL, 2 API-инстанса, worker, S3, WAF                                                            |

Хостинг — российский облачный провайдер, регион РФ. Секреты — GitHub
Environments + облачный secret manager; в репозитории только `.env.example`.

## 5. Границы MVP

В MVP входят: консоль вендора (клиенты, счета, оплаты, пакеты), пакет
подключения, MCP-онбординг для трех ИИ-клиентов на Windows, кабинет директора,
учет времени (MCP + расширение), закрытие дня, дайджесты, GitHub + минимум
GitLab/Gitea, PostgreSQL/RLS/аудит, расчетная доля, пул, pending, вестинг.

Не входят: эквайринг, выплаты разработчикам, юридические доли, self-host,
мобильные приложения, macOS/Linux до пилота.
