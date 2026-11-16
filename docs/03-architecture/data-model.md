# Данные: схема, изоляция, аудит

| Поле      | Значение                                         |
| --------- | ------------------------------------------------ |
| Код       | ARCH-DATA                                        |
| Версия    | 1.1                                              |
| Статус    | реализовано в M2.1; вендорский auth — M3 PR A    |
| Связанные | ADR-0002, ADR-0006, ADR-0007, ADR-0009, ADR-0013 |

## 1. Контуры

| Контур      | Таблицы                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Вендор      | `vendor_users`, `customers`, `plans`, `contracts`, `subscriptions`, `invoices`, `payments`, `provisioning_packages`, `onboarding_sessions`, `vendor_audit_events`, `vendor_audit_anchors`                                                                                                                                                                                                                                                                                                              |
| Вендор-auth | `vendor_auth_accounts`, `vendor_auth_sessions`, `vendor_auth_verifications`, `vendor_auth_two_factors`, `vendor_auth_passkeys`, `vendor_auth_rate_limits`, `vendor_auth_email_limits` (доступ только у `partner_coder_vendor_auth`)                                                                                                                                                                                                                                                                    |
| Tenant      | `users`, `auth_sessions`, `tenants`, `memberships`, `projects`, `project_members`, `policies`, `rate_versions`, `valuation_versions`, `work_sessions`, `heartbeats`, `intervals`, `day_records`, `day_adjustments`, `day_flags`, `disputes`, `payout_batches`, `payout_items`, `devices`, `device_tokens`, `invitations`, `git_integrations`, `connector_events`, `repo_facts`, `notifications`, `digest_runs`, `monthly_snapshots`, `tenant_audit_events`, `tenant_audit_anchors`, `idempotency_keys` |
| Auth        | `auth_accounts`, `auth_verifications`, `auth_two_factors`, `auth_passkeys`, `auth_rate_limits` (глобальные, доступ только у `partner_coder_auth`)                                                                                                                                                                                                                                                                                                                                                      |
| Rate limit  | `email_rate_limits` (глобальная, доступ у `partner_coder_api` и worker)                                                                                                                                                                                                                                                                                                                                                                                                                                |

Схема и миграции — `packages/db/src/schema` и `packages/db/drizzle`.
Домен не зависит от БД; `packages/db` импортирует `@partner-coder/domain`.

## 2. Деньги, время, версии

- Деньги — `bigint` в копейках, проценты — целые bp, доля дня — целые
  единицы 1e-6 (`share_bp`). Float в деньгах и долях отсутствует.
- Время — `timestamptz` (UTC) в БД; локальная дата дня — `date_local` и
  `timezone` проекта.
- `day_records` хранит базу начисления, cash/equity, долю, использование пула,
  `pending`, версии политики/ставки/оценки, `input_hash` и дерево объяснения.
- Закрытый день неизменяем; изменение оформляется `day_adjustments` с
  детерминированным `input_hash` и уникальностью `(day_record_id, input_hash)`.

## 3. Изоляция tenant

- Все тенантские таблицы содержат `tenant_id NOT NULL`; дочерние таблицы
  дублируют `tenant_id`, чтобы RLS-политика не зависела от JOIN.
- Дочерние внешние ключи составные: `(tenant_id, parent_id)` ссылается на
  `(tenant_id, id)` родителя. Ссылка на родителя другого tenant невозможна
  даже при обходе RLS.
- RLS включается и форсируется для `partner_coder_api`; контекст задается
  `SET LOCAL app.tenant_id` (helper `withTenantContext`).
- `tenants`: `id = app.tenant_id`; `users`: членство в текущем tenant или
  собственный `app.user_id`; `auth_sessions`: только `app.user_id`.
- `users` INSERT разрешен только с `id = app.user_id`; для входа и выбора
  tenant API использует `SECURITY DEFINER` функции `auth_user_by_email`,
  `auth_user_memberships`, `auth_device_by_token_hash` и
  `auth_invitation_by_token_hash` (минимум полей, владелец — worker).
- Better Auth работает под ролью `partner_coder_auth`, которая видит только
  `users`, `auth_sessions`, `auth_accounts`, `auth_verifications` и будущие
  таблицы 2FA/passkeys. API-роль имеет RLS-доступ к своим `users`/
  `auth_sessions`, но не имеет грантов на `auth_accounts`,
  `auth_verifications`, `auth_two_factors`, `auth_passkeys`.
- `auth_sessions.token` хранит токен Better Auth (дизайн библиотеки),
  `token_hash` — устаревшая колонка для совместимости. OTP и magic-link
  токены хранятся хешами в `auth_verifications`.
- `auth_rate_limits` — общий лимит Better Auth (`key`, `count`,
  `last_request`); `email_rate_limits` — общий per-email лимит OTP/magic-link
  (`key`, `count`, `window_started_at`). Таблицы не tenant-ские; worker
  удаляет окна старше суток (ADR-0012).
- `device_tokens` — тенантская таблица: SHA-256-хеш секрета, scope, TTL,
  отзыв и `rotated_from`; сырой токен показывается один раз при выпуске.
- `invitations.token_hash` — SHA-256, TTL и одна активация; принятие
  проверяет email аутентифицированного пользователя и создает членство.
- `auth_sessions.active_tenant_id` — выбранное пространство; API принимает
  tenant только из сессии/токена и проверяет активное членство.
- `auth_user_memberships` возвращает статус tenant; `suspended`/`archived`
  не дают активного контекста. `auth_device_by_token_hash` проверяет статус
  пользователя, членства, tenant и (если задан) активного устройства.
- Приглашение выдает роль по правилу: director — любую, support — только
  developer; повторная активация существующего членства запрещена.
- Аудит пишется через `app_audit()`; actor берется из `app.user_id`, прямой
  INSERT в `tenant_audit_events` у API-роли отсутствует.
- `idempotency_keys`: tenant-ключи через `app.tenant_id`, vendor-ключи
  (`tenant_id IS NULL`) — только вендорской роли.
- `partner_coder_vendor` не имеет доступа к тенантским таблицам и сырым
  heartbeat. `partner_coder_worker` — доверенный процесс с `BYPASSRLS`.
- Тесты: чтение/запись/вставка чужого tenant по каждому ресурсу, составные
  FK, каталог RLS/грантов, auth-функции.

### 3.1 Вендорский auth-контур (M3 PR A)

- `vendor_users` — единственная точка идентичности вендора: роли
  `superadmin`, `finance`, `support`, `readonly`, статусы `invited`, `active`,
  `suspended`, `disabled`. `email` уникален по `lower(email)`.
- Better Auth маппится на `vendor_users` и семь `vendor_auth_*` таблиц.
  `vendor_users.mfa_enabled` — колонка плагина `twoFactor`; в Drizzle она
  называется `twoFactorEnabled`, DDL не меняется.
- Вендорские таблицы **без `tenant_id` и без RLS**: контур глобальный,
  изоляция — гранты и раздельные логины. `partner_coder_vendor_auth` видит
  `vendor_users` и `vendor_auth_*`; `partner_coder_vendor` видит вендорские
  данные, но не секреты; API/auth не видят вендорский контур; worker получает
  `SELECT, DELETE` только на TTL-таблицы.
- `partner_coder_vendor_auth` создаётся миграцией `0006` как `NOLOGIN`-роль.
  Логины `VENDOR_DATABASE_URL`/`VENDOR_AUTH_DATABASE_URL` провижинятся
  отдельно; вне local API проверяет разделение ролей при старте.
- Аудит пишется через `SECURITY DEFINER` функцию `vendor_audit(...)`:
  `REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE` вендорским ролям, функция
  только вставляет событие и возвращает `uuid`. Прямой `INSERT` в
  `vendor_audit_events` у `partner_coder_vendor` остаётся, auth-роль получает
  только функцию.
- `vendor_auth_passkeys` создана заранее, но плагин passkey и UI в PR A не
  подключены (PR B). Сброс MFA удаляет и TOTP, и passkey-строки.
- TTL: worker удаляет просроченные `vendor_auth_sessions`,
  `vendor_auth_verifications`, окна `vendor_auth_rate_limits` и
  `vendor_auth_email_limits`. TOTP-секреты и passkeys по TTL не удаляются.
- `verify_vendor_audit_chain()` проверяет целостность вендорской хеш-цепочки;
  `verify_tenant_audit_chain(uuid)` остаётся для tenant-контура.

## 4. Append-only и аудит

- Append-only таблицы: `heartbeats`, `intervals`, `day_records`,
  `day_adjustments`, `day_flags`, `connector_events`, `repo_facts`,
  `monthly_snapshots`, `tenant_audit_events`, `vendor_audit_events`.
- UPDATE/DELETE/TRUNCATE запрещены триггером и правами БД.
- Аудит: `chain_seq` + `prev_hash` + `hash` (SHA-256) в BEFORE INSERT
  триггере; цепочка сериализуется advisory lock. Канонизация версионирована,
  поля кодируются с префиксами длин; вендорская цепочка включает `customer_id`.
  `verify_*_audit_chain` проверяет целостность и порядок.
- Дневной якорь (UTC) — `anchor_*_audit`; якоря производные, допускают
  пересчет (upsert) и проверяются `verify_tenant_audit_anchor`. Цепочка при
  этом остается неизменяемой.
- Хранение аудита — не менее 3 лет (см. мега-план §6.4).

## 5. Идемпотентность

- `idempotency_keys` уникальны по `(coalesce(tenant_id, zero_uuid), scope, key)`.
- `withIdempotency` пишет ключ, выполняет операцию и сохраняет ответ в одной
  транзакции; повтор возвращает тот же ответ, другое тело — 409.
- Истекший ключ удаляется и используется заново; плановая очистка — worker
  M2.3.
- `event_id` heartbeat, `(session_id, seq)`, `(provider, delivery_id)` вебхука
  и `(day_record_id, input_hash)` — отдельные естественные ключи дедупликации.

## 6. Миграции и проверки

```bash
pnpm db:migrate
pnpm db:check
pnpm test:db
```

- `db:generate` создает следующую миграцию из Drizzle-схемы.
- `db:check` проверяет журнал и генерирует миграцию во временный каталог:
  появление нового SQL означает дрейф схемы.
- RLS, роли, триггеры и функции добавляются кастомной SQL-миграцией.
- Миграция `0003` добавляет Better Auth-таблицы, `device_tokens`, роль
  `partner_coder_auth`, auth-функции и RLS. Роли `NOLOGIN`; логины создаются
  при провижининге окружения.
- Миграция `0005` добавляет `auth_rate_limits` и `email_rate_limits` с
  раздельными грантами и RLS (ADR-0012); worker получил DELETE для чистки
  просроченных окон.
- Миграция `0006` добавляет `vendor_users.email_verified/image`, семь
  `vendor_auth_*` таблиц, роль `partner_coder_vendor_auth`, гранты,
  `vendor_audit()` и `EXECUTE` для вендорских ролей, права worker на TTL;
  RLS на вендорских таблицах не включается (ADR-0013).
- CI поднимает PostgreSQL 17, применяет миграции на чистой БД, проверяет
  журнал и запускает интеграционные тесты.
- Интеграционные тесты создают отдельные БД, поэтому `vitest` запускает
  файлы последовательно (`fileParallelism: false`).

## 7. Ретенция (план)

| Данные          | Хранение                             |
| --------------- | ------------------------------------ |
| Сырые heartbeat | 90 дней, затем агрегируются          |
| Интервалы и дни | Бессрочно, пока действует договор    |
| Аудит           | Не менее 3 лет                       |
| Счета и платежи | По налоговому/договорному сроку      |
| Пакеты          | 30 дней после активации/истечения    |
| PII             | Минимум; экспорт/удаление по запросу |

Сырые heartbeat append-only: удаление по ретенции требует партиционирования
или отдельной retention-роли. Это задача M2.3/M6; до нее политика хранения
остается декларацией.
