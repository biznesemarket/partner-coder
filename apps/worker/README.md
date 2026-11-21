# apps/worker — фоновые задания

pg-boss в схеме `pgboss`: закрытие дня, дневные якоря аудита, TTL-очистка и
отзыв доступов. Архитектурное решение — ADR-0011.

## Задания

| Очередь               | Расписание (`UTC`) | Что делает                                                    |
| --------------------- | ------------------ | ------------------------------------------------------------- |
| `day-close-scan`      | `*/15 * * * *`     | находит незакрытые локальные дни и ставит `day-close`         |
| `day-close`           | по scan            | `calculateDay` → неизменяемый `day_record`, компенсации       |
| `audit-anchor`        | `15 0 * * *`       | проверяет хеш-цепочки и ставит якоря за закрытые UTC-сутки    |
| `ttl-cleanup`         | `30 * * * *`       | истекшие ключи/OTP/сессии, device-токены, retention heartbeat |
| `billing-status-scan` | `5 * * * *`        | автопереходы подписок `trial/active/grace/expired`            |

У каждой очереди есть DLQ и retry с backoff. `day-close` дополнительно берет
advisory-lock по `(tenant, project, date)`; повтор с тем же `input_hash` не
создает записей, изменившийся расчет пишет `day_adjustments`.

## Команды

```bash
pnpm --filter @partner-coder/worker dev
pnpm --filter @partner-coder/worker build
pnpm --filter @partner-coder/worker start
pnpm vitest run apps/worker
```

Worker читает те же `.env`, что API. Метрики — на `WORKER_METRICS_PORT`
(`/metrics`), логи pino редактируют токены. Секреты и роли БД — см.
`deploy/environments/staging/README.md`.
