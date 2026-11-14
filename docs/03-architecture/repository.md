# Структура репозитория

```text
partner-coder/
  apps/
    web/               Next.js: консоль вендора и кабинеты (M3, M5)
    api/               Fastify: REST, health, конверт ошибок (каркас готов)
    worker/            pg-boss задания (M2.3)
    mcp/               локальный MCP-сервер и агент (M4, M6)
    ide-extension/     VS Code/Cursor расширение (M6)
  packages/
    domain/            чистое доменное ядро; golden-тесты (M1 готов)
    db/                Drizzle-схема, миграции, RLS (M2.1)
    contracts/         Zod-схемы API и MCP
    ui/                общие компоненты
    config/            окружение и константы продукта
    testing/           фабрики и утилиты тестов
    package-template/  шаблоны пакета подключения (M4)
  docs/
    00-start/          quickstart
    01-product/        vision, glossary
    02-domain/         нормативные спецификации расчета
    03-architecture/   обзор, структура, API
    04-security/       модель угроз
    05-process/        процесс разработки, quality gates
    06-legal/          юридические тексты (за юристом)
    07-ops/            эксплуатация
    08-guides/         руководства для пользователей
    adr/               архитектурные решения
  deploy/
    compose/           локальная инфраструктура
    scripts/           вспомогательные скрипты
    environments/      описания окружений
  tools/
    seed/              демо-данные
    package-builder/   сборка zip-пакета
    load/              нагрузочные сценарии k6
    security/          проверки безопасности
  .github/             CI, CodeQL, шаблоны issue/PR, CODEOWNERS
```

## Правила

1. Пакеты собираются в `dist` (`tsc`) и экспортируют его; зависимости собираются
   через `turbo` (`^build`). Тесты используют alias на исходники (ADR-0001).
2. `packages/domain` не импортирует ничего из `apps/*` и `packages/db`.
   Зависимость допустима только в одну сторону: `db/api/web/mcp → domain`.
3. Доменная арифметика — только в `packages/domain`. В приложениях нет
   умножения ставок, деления на 3600 и округлений денег.
4. Контракты API — Zod-схемы в `packages/contracts`; OpenAPI генерируется из них.
5. Секреты — только в окружении; `.env.example` без реальных значений.

## Статус каркаса

| Пакет/приложение     | Состояние                                         |
| -------------------- | ------------------------------------------------- |
| `packages/domain`    | реализовано, покрыто golden и property-тестами    |
| `packages/config`    | валидация окружения через Zod                     |
| `packages/contracts` | конверт ошибок, health, коды доменных ошибок      |
| `apps/api`           | Fastify: requestId, ошибки, `/healthz`, `/readyz` |
| остальные            | манифесты-заглушки; реализация по вехам M2–M6     |
