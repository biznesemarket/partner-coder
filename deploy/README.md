# Деплой

| Каталог         | Назначение                                              |
| --------------- | ------------------------------------------------------- |
| `compose/`      | локальная инфраструктура: PostgreSQL 17, Mailpit, MinIO |
| `scripts/`      | вспомогательные скрипты (бэкап, миграции, smoke)        |
| `environments/` | описания окружений local / staging / prod               |

## Локально

```bash
docker compose -f deploy/compose/docker-compose.yml up -d
docker compose -f deploy/compose/docker-compose.yml ps
```

| Сервис        | Порт                  | Учетные данные                            |
| ------------- | --------------------- | ----------------------------------------- |
| PostgreSQL    | 5432                  | `partner` / `partner`, БД `partner_coder` |
| Mailpit SMTP  | 1025                  | без авторизации                           |
| Mailpit UI    | http://localhost:8025 | —                                         |
| MinIO S3      | 9000                  | `partner` / `partner-secret`              |
| MinIO Console | http://localhost:9001 | `partner` / `partner-secret`              |

Bucket `partner-coder` создается автоматически сервисом `minio-init`.

## Окружения (M2+)

| Окружение | Назначение     | Данные                                                     |
| --------- | -------------- | ---------------------------------------------------------- |
| local     | разработка     | compose, seed                                              |
| staging   | приемка и демо | отдельная БД, синтетический tenant                         |
| prod      | пилот          | managed PostgreSQL с PITR, 2 API-инстанса, worker, S3, WAF |

Секреты — в GitHub Environments и облачном secret manager. В репозитории
только `.env.example`.
