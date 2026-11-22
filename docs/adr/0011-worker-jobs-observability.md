# ADR-0011: Фоновые задания, якоря аудита и наблюдаемость

| Поле      | Значение                           |
| --------- | ---------------------------------- |
| Статус    | принято                            |
| Дата      | 2026-11-15                         |
| Связанные | ADR-0007, ADR-0009, ADR-0010, M2.3 |

## Контекст

M2.2 закрыл аутентификацию, роли и tenant-изоляцию. Для эксплуатации нужны
фоновые задания, которые не зависят от HTTP-процесса: закрытие дня, дневные
якоря аудита, TTL-очистка и отзыв доступов при suspension. Одновременно нужны
структурные логи без токенов, метрики, трассировка и контракт API.

## Решение

1. **pg-boss в отдельной схеме.** Очереди `day-close-scan`, `day-close`,
   `audit-anchor`, `ttl-cleanup` живут в схеме `pgboss`. У каждой очереди есть
   DLQ, retry limit, backoff и расписание. Схема создается pg-boss; в managed
   PostgreSQL login worker-а получает право на создание/владение этой схемой.
2. **Закрытие дня идемпотентно.** Задание получает `tenantId`, `projectId` и
   `date`. Расчет идет через `calculateDay`; `input_hash` неизменен. Повтор с
   тем же hash — `duplicate`; изменившиеся входные данные создают
   `day_adjustments`, а не UPDATE `day_records`. Параллельные запуски
   сериализуются `pg_try_advisory_xact_lock` по проекту и дате.
3. **Сканирование учитывает timezone.** Cron запускает скан каждые 15 минут,
   но due-дата вычисляется по `timezone` и `close_at` политики проекта.
   Пропущенные дни закрываются ограниченным catch-up (31 день по умолчанию).
4. **Якоря только после закрытия UTC-суток.** Worker сначала вызывает
   `verify_tenant_audit_chain` и `verify_vendor_audit_chain`, затем
   `anchor_tenant_audit`/`anchor_vendor_audit`, затем проверяет якорь.
   Повреждение цепочки останавливает задание и уходит в retry/DLQ.
5. **TTL и retention.** Истекшие `idempotency_keys`, OTP/magic-link и сессии
   удаляются. Сессии suspended/deleted пользователей удаляются; активный
   tenant suspended/archived очищается; device-токены отзываются. Сырые
   `heartbeats` старше retention удаляются только через
   `retention_delete_heartbeats`, принадлежащую отдельной роли
   `partner_coder_retention`; прямой DELETE для остальных ролей запрещен
   append-only триггером.
6. **Наблюдаемость.** API и worker пишут pino-логи с редакцией токенов в
   query/path и заголовках. API отдает Prometheus-метрики; worker — метрики
   заданий на отдельном порту. Correlation id — `x-request-id`. OTel и Sentry
   включаются переменными окружения и не являются обязательными для старта.
7. **Контракт.** OpenAPI 3.1 генерируется из Zod-схем (`z.toJSONSchema`),
   отдается на `/openapi.json`; из него генерируются TypeScript-типы клиента.
   JSON-схемы — источник истины для документации, рантайм-валидация остается
   в существующих Zod-парсерах.

## Последствия

- Для managed PostgreSQL нужен runbook: роли, `pgboss`, `AUTH_DATABASE_URL`,
  права на схему и retention-функцию.
- Метрики `/metrics` по умолчанию открыты в local/staging; в prod задается
  `METRICS_TOKEN` и/или `METRICS_IP_ALLOWLIST` (CIDR; проверка по verified
  client IP).
- OTel auto-instrumentation включается только при заданном endpoint; Sentry
  не обязателен.
- Retention heartbeat удаляет сырые события; агрегированные интервалы,
  дневные записи и аудит остаются append-only.
