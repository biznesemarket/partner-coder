# Деплой

| Каталог         | Назначение                                                   |
| --------------- | ------------------------------------------------------------ |
| `compose/`      | локальная инфраструктура: PostgreSQL 17, Mailpit, S3         |
| `scripts/`      | вспомогательные скрипты (бэкап, миграции, smoke)             |
| `environments/` | окружения local / staging / prod, Caddyfile и systemd units; |

## Локально

```bash
docker compose -f deploy/compose/docker-compose.yml up -d
docker compose -f deploy/compose/docker-compose.yml ps
```

| Сервис       | Порт                  | Учетные данные                            |
| ------------ | --------------------- | ----------------------------------------- |
| PostgreSQL   | 5432                  | `partner` / `partner`, БД `partner_coder` |
| Mailpit SMTP | 1025                  | без авторизации                           |
| Mailpit UI   | http://localhost:8025 | —                                         |
| S3 API       | 9000                  | `partner` / `partner-secret`              |
| S3 Console   | http://localhost:9001 | `partner` / `partner-secret`              |

Bucket `partner-coder` создается автоматически сервисом `minio-init`.

Локальный S3 — SILO (`pgsty/silo`), поддерживаемый форк MinIO: официальные
образы `minio/minio` и `minio/mc` удалены из registry в 2026 году. Переменные
окружения, API и формат данных совместимы с MinIO. Для staging/prod выбор
managed S3 остается за хостингом (см. `environments/staging/README.md`).

## Окружения (M2+)

| Окружение | Назначение     | Данные                                                     |
| --------- | -------------- | ---------------------------------------------------------- |
| local     | разработка     | compose, seed                                              |
| staging   | приемка и демо | отдельная БД, синтетический tenant                         |
| prod      | пилот          | managed PostgreSQL с PITR, 2 API-инстанса, worker, S3, WAF |

Секреты — в GitHub Environments и облачном secret manager. В репозитории
только `.env.example`.
