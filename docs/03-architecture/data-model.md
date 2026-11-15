# Данные: схема, изоляция, аудит

| Поле      | Значение                               |
| --------- | -------------------------------------- |
| Код       | ARCH-DATA                              |
| Версия    | 1.0                                    |
| Статус    | реализовано в M2.1                     |
| Связанные | ADR-0002, ADR-0006, ADR-0007, ADR-0009 |

## 1. Контуры

| Контур | Таблицы                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Вендор | `vendor_users`, `customers`, `plans`, `contracts`, `subscriptions`, `invoices`, `payments`, `provisioning_packages`, `onboarding_sessions`, `vendor_audit_events`, `vendor_audit_anchors`                                                                                                                                                                                                                                                                                             |
| Tenant | `users`, `auth_sessions`, `tenants`, `memberships`, `projects`, `project_members`, `policies`, `rate_versions`, `valuation_versions`, `work_sessions`, `heartbeats`, `intervals`, `day_records`, `day_adjustments`, `day_flags`, `disputes`, `payout_batches`, `payout_items`, `devices`, `invitations`, `git_integrations`, `connector_events`, `repo_facts`, `notifications`, `digest_runs`, `monthly_snapshots`, `tenant_audit_events`, `tenant_audit_anchors`, `idempotency_keys` |

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
- `users` INSERT разрешен только с `id = app.user_id`; логин/сессия
  разрешаются через `SECURITY DEFINER` функции `auth_user_by_email` и
  `auth_session_by_token` (минимум полей, владелец — worker).
- Аудит пишется через `app_audit()`; actor берется из `app.user_id`, прямой
  INSERT в `tenant_audit_events` у API-роли отсутствует.
- `idempotency_keys`: tenant-ключи через `app.tenant_id`, vendor-ключи
  (`tenant_id IS NULL`) — только вендорской роли.
- `partner_coder_vendor` не имеет доступа к тенантским таблицам и сырым
  heartbeat. `partner_coder_worker` — доверенный процесс с `BYPASSRLS`.
- Тесты: чтение/запись/вставка чужого tenant по каждому ресурсу, составные
  FK, каталог RLS/грантов, auth-функции.

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
