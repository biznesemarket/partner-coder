# Окружения

| Окружение | Домен                           | БД                             | Назначение      |
| --------- | ------------------------------- | ------------------------------ | --------------- |
| local     | localhost                       | compose PostgreSQL             | разработка      |
| staging   | staging.partnercoder.ru         | managed PostgreSQL (отдельная) | приемка и демо  |
| prod      | app./admin./api.partnercoder.ru | managed PostgreSQL + PITR      | пилот и продажи |

Требования: TLS обязателен, секреты — в secret manager, миграции — до старта
новых инстансов, откат — предыдущий образ + совместимая схема.

Staging-конфигурация, роли БД и smoke-чек-лист: `staging/README.md`. Деплой
заблокирован выбором хостинга/региона и managed PostgreSQL (§14 мега-плана).
