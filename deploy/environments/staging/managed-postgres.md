# Managed PostgreSQL: роли и запуск

Статус: runbook подготовлен, на реальном managed PostgreSQL **не выполнялся**.
Использовать как чек-лист при выборе провайдера и первого staging-деплоя
(мега-план §14, открытый вопрос хостинга).

## 1. Модель

Одна логическая БД `partner_coder` на окружение. Роли PostgreSQL
кластерные, поэтому окружения не должны делить один кластер: имена
`partner_coder_*` фиксированы и совпадут между staging и prod.

| Логин                  | Членство                                          | Атрибуты                        | Куда идёт                      |
| ---------------------- | ------------------------------------------------- | ------------------------------- | ------------------------------ |
| `pc_api_login`         | `partner_coder_api`                               | без superuser и `BYPASSRLS`     | API `DATABASE_URL`             |
| `pc_auth_login`        | `partner_coder_auth`                              | без superuser и `BYPASSRLS`     | API `AUTH_DATABASE_URL`        |
| `pc_vendor_login`      | `partner_coder_vendor`                            | без superuser и `BYPASSRLS`     | API `VENDOR_DATABASE_URL`      |
| `pc_vendor_auth_login` | `partner_coder_vendor_auth`                       | без superuser и `BYPASSRLS`     | API `VENDOR_AUTH_DATABASE_URL` |
| `pc_worker_login`      | `partner_coder_worker`                            | **сам login имеет `BYPASSRLS`** | worker `DATABASE_URL`          |
| `pc_migrator`          | `partner_coder_worker`, `partner_coder_retention` | `CREATEROLE`; см. §3            | `pnpm db:migrate` / `db:check` |

Групповые роли `partner_coder_api`, `partner_coder_auth`,
`partner_coder_vendor`, `partner_coder_vendor_auth`,
`partner_coder_worker` (`BYPASSRLS`) и `partner_coder_retention` создаются
миграциями `0001`, `0003`, `0004`, `0006` как `NOLOGIN`.

**`BYPASSRLS` не наследуется через членство.** Проверено на PostgreSQL 17:
login, который только входит в `partner_coder_worker`, видит 0 строк
tenant-таблиц, потому что атрибут остаётся у текущего пользователя. Worker
не делает `SET ROLE`, поэтому `pc_worker_login` должен иметь `BYPASSRLS`
собственным атрибутом. Старт worker вне local теперь это проверяет.

## 2. Требования к провайдеру

До оплаты тарифа проверить:

1. PostgreSQL 17 (или совместимый managed PG 17).
2. Роль администратора умеет:
   - `CREATE ROLE` / `GRANT` / `ALTER ROLE ... BYPASSRLS`;
   - `ALTER FUNCTION ... OWNER TO` (нужно `SET ROLE` в целевую роль и
     `CREATE` на схему `public`);
   - `CREATE` на БД и схему `public`;
   - `CREATE EXTENSION pgcrypto` (миграция `0008` включает HMAC для аудита).
3. **`ALTER ROLE ... BYPASSRLS` требует superuser.** `CREATEROLE` сам по себе
   недостаточен (проверено на PG 17). Если тариф не даёт superuser или
   эквивалент (`rds_superuser`, `cloudsqlsuperuser`, `azure_pg_admin` — надо
   проверить именно `BYPASSRLS`), миграция `0001` упадёт на
   `ALTER ROLE partner_coder_worker BYPASSRLS`. Это блокер выбора провайдера,
   а не повод ослаблять worker.
4. Worker и миграции подключаются напрямую или через session pooling.
   Transaction pooling (PgBouncer) может ломать session-scoped advisory locks
   и настройки соединения; для worker нужен direct/session endpoint.
5. Managed PG даёт PITR и daily backup; `VENDOR_AUTH_SECRET`, `AUTH_SECRET`,
   `AUDIT_HMAC_KEY` (64 hex) хранятся в секрет-менеджере и входят в тот же
   контур восстановления. Потеря `AUDIT_HMAC_KEY` делает старые цепочки
   аудита непроверяемыми — хранить две копии.

Проверка прав администратора:

```sql
select current_user,
       r.rolsuper,
       r.rolcreaterole,
       r.rolbypassrls
  from pg_roles r
 where r.rolname = current_user;
```

## 3. Bootstrap ролей

### Вариант A: администратор провайдера может `BYPASSRLS`

Рекомендуемый путь. Миграции выполняются администратором провайдера (или
ролью с теми же правами на `BYPASSRLS`), затем создаются login-роли.

```sql
-- 1. Прогнать миграции от администратора провайдера:
--    DATABASE_URL=postgres://admin:...@host:5432/partner_coder pnpm db:migrate

-- 2. Login-роли и членство (пароли — из секрет-менеджера).
create role pc_api_login login password :'api_password';
create role pc_auth_login login password :'auth_password';
create role pc_vendor_login login password :'vendor_password';
create role pc_vendor_auth_login login password :'vendor_auth_password';
create role pc_worker_login login bypassrls password :'worker_password';

grant partner_coder_api to pc_api_login;
grant partner_coder_auth to pc_auth_login;
grant partner_coder_vendor to pc_vendor_login;
grant partner_coder_vendor_auth to pc_vendor_auth_login;
grant partner_coder_worker to pc_worker_login;

-- 3. pg-boss: схема создаётся worker-ом или администратором.
grant create on database partner_coder to pc_worker_login;
-- либо: create schema pgboss authorization pc_worker_login;

-- 4. Проверить, что чужих членств нет.
select r.rolname as member, g.rolname as granted_role
  from pg_auth_members m
  join pg_roles r on r.oid = m.member
  join pg_roles g on g.oid = m.roleid
 where r.rolname like 'pc_%'
 order by 1, 2;
```

### Вариант B: администратор не может `BYPASSRLS`

Если провайдер не даёт `BYPASSRLS`, **остановиться**: worker не сможет
работать с tenant-данными без ослабления RLS. Не выдавать `pc_worker_login`
superuser и не отключать RLS. Сменить провайдера/тариф или принять отдельное
решение об изменении миграции и контура worker.

### Вариант C: миграции отдельной ролью `pc_migrator`

Если провайдер даёт отдельную роль для миграций, а `BYPASSRLS` доступен
только администратору:

```sql
-- До миграций: создать групповые роли вручную (иначе ALTER FUNCTION OWNER
-- не сможет SET ROLE), дать мигратору членство и CREATE на схему.
create role partner_coder_api nologin;
create role partner_coder_auth nologin;
create role partner_coder_vendor nologin;
create role partner_coder_vendor_auth nologin;
create role partner_coder_worker nologin bypassrls;
create role partner_coder_retention nologin;

create role pc_migrator login createrole password :'migrator_password';
grant partner_coder_worker, partner_coder_retention to pc_migrator;
grant create on schema public to partner_coder_worker, partner_coder_retention;
grant create on database partner_coder to pc_migrator;
grant create on schema public to pc_migrator;

-- Отдельно от администратора: alter role partner_coder_worker bypassrls;
```

Миграции `CREATE ROLE` пропустят существующие роли (`IF NOT EXISTS`), но
`ALTER ROLE partner_coder_worker BYPASSRLS` всё равно выполнится. Если эту
строку не может выполнить никто, кроме superuser, вариант C не подходит.

## 4. Переменные окружения

```env
APP_ENV=staging

# API: четыре независимых логина, все на одну БД.
DATABASE_URL=postgres://pc_api_login:...@host:5432/partner_coder?sslmode=require
AUTH_DATABASE_URL=postgres://pc_auth_login:...@host:5432/partner_coder?sslmode=require
VENDOR_DATABASE_URL=postgres://pc_vendor_login:...@host:5432/partner_coder?sslmode=require
VENDOR_AUTH_DATABASE_URL=postgres://pc_vendor_auth_login:...@host:5432/partner_coder?sslmode=require

# Worker — отдельный деплой с worker-логином.
DATABASE_URL=postgres://pc_worker_login:...@host:5432/partner_coder?sslmode=require
PG_BOSS_SCHEMA=pgboss
```

Миграции запускаются с `DATABASE_URL` мигратора/администратора, а не с
runtime-логином. `sslmode=verify-full` предпочтителен, если провайдер даёт CA.

## 5. Проверки после старта

API вне local проверяет каждый контур: не superuser, не `BYPASSRLS`,
правильное членство и отсутствие чужих ролей. Worker проверяет: не superuser,
**есть `BYPASSRLS`**, членство в `partner_coder_worker`, отсутствие членства в
API/auth.

```bash
pnpm db:migrate
pnpm db:check
pnpm build
pnpm --filter @partner-coder/seed seed   # только синтетический tenant
pnpm --filter @partner-coder/api start
pnpm --filter @partner-coder/worker start
pnpm --filter @partner-coder/web start
```

Ожидаемо: API и worker стартуют без `role_separation_failed` /
`worker_role_separation_failed`; `/readyz` зелёный; в `pg_stat_activity` нет
соединений под superuser.

## 6. Rate limit, retention и pg-boss

| Объект                        | Владелец/грант                                        |
| ----------------------------- | ----------------------------------------------------- |
| `auth_rate_limits`            | `SELECT/INSERT/UPDATE/DELETE` — `partner_coder_auth`  |
| `email_rate_limits`           | API-роль; worker — `DELETE` для TTL                   |
| `vendor_auth_rate_limits`     | `partner_coder_vendor_auth`; worker — `DELETE`        |
| `vendor_auth_email_limits`    | `partner_coder_vendor_auth`; worker — `DELETE`        |
| `retention_delete_heartbeats` | owner `partner_coder_retention`; worker — `EXECUTE`   |
| `vendor_audit(...)`           | owner `partner_coder_worker`; vendor-роли — `EXECUTE` |
| схема `pgboss`                | создаёт/владеет worker login                          |

Проверка грантов и владельцев:

```sql
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_name in (
   'auth_rate_limits', 'email_rate_limits',
   'vendor_auth_rate_limits', 'vendor_auth_email_limits'
 )
 order by 1, 2, 3;

select p.proname, r.rolname as owner
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
 where p.proname in ('retention_delete_heartbeats', 'vendor_audit');
```

pg-boss создаёт схему `pgboss` при первом старте. Если worker-логин не имеет
`CREATE` на БД, схему создаёт администратор:
`CREATE SCHEMA pgboss AUTHORIZATION pc_worker_login;`. Не переносить
`pgboss` в `public` и не выдавать worker-логину лишние права на tenant-таблицы.

## 7. Бэкапы и восстановление

- PITR + daily backup на стороне провайдера; проверить restore drill до
  пилота (RPO/RTO — решение §14).
- В секрет-менеджере и backup-контуре: `AUTH_SECRET`, `VENDOR_AUTH_SECRET`
  (без него TOTP/backup-коды вендоров не расшифровываются), SMTP/S3-секреты.
- После восстановления: `verify_tenant_audit_chain()` и
  `verify_vendor_audit_chain()`; smoke API/worker/web.

## 8. Известные ограничения

- Runbook не прогонялся на реальном managed PG: провайдерские ограничения
  `BYPASSRLS`, `CREATEROLE`, `ALTER FUNCTION OWNER`, `CREATE` и pooler нужно
  проверять на выбранном тарифе.
- Миграция `0001` всегда выполняет `ALTER ROLE partner_coder_worker BYPASSRLS`;
  без права на этот шаг staging не поднимется.
- Serverless-пулы с transaction pooling не подходят для worker без проверки
  advisory locks; для worker — direct/session endpoint.
- Глобальный Fastify-лимит остаётся per-instance; edge/WAF — после выбора
  хостинга.
