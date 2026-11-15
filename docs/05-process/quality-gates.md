# Quality gates

| Поле   | Значение   |
| ------ | ---------- |
| Код    | PROC-GATES |
| Версия | 1.0        |

## 1. Уровни проверок

| Уровень     | Инструмент             | Что проверяет                                     |
| ----------- | ---------------------- | ------------------------------------------------- |
| Unit        | Vitest                 | домен, политика, калькулятор, вестинг, утилиты    |
| Golden      | Vitest                 | T-01…T-12, E-01…E-08 — точные числа               |
| Property    | fast-check             | инварианты union, капов, округления, монотонности |
| Integration | Vitest + PostgreSQL    | RLS, репозитории, API, очереди, вебхуки (M2)      |
| Contract    | Zod/OpenAPI            | схемы API и MCP (M2.3)                            |
| E2E         | Playwright             | вендор, директор, разработчик, онбординг (M3–M8)  |
| MCP         | MCP SDK client         | tools/list, tool calls, ошибки, enrollment (M4)   |
| Load        | k6                     | heartbeat, закрытие, дашборды (M6, M9)            |
| Security    | CodeQL, audit, pentest | уязвимости и изоляция                             |
| Manual      | чек-листы              | 3 ИИ-клиента × чистая Windows VM                  |

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
```

Плюс в CI: secret scan, dependency review. Для изменений схемы БД обязательны
миграция на чистой базе и тесты RLS/append-only/аудита.

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
