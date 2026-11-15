# @partner-coder/db — схема, миграции, RLS, аудит

Пакет реализует платформенное ядро M2.1–M2.2: PostgreSQL-схему вендорского,
тенантского и auth-контуров, RLS, append-only журналы, хеш-цепочку аудита,
идемпотентность, приглашения и device-токены.

## Команды

```bash
pnpm db:migrate   # применить миграции к DATABASE_URL
pnpm db:generate  # сгенерировать миграцию из схемы
pnpm db:check     # журнал миграций + проверка дрейфа схемы
pnpm db:studio    # Drizzle Studio
pnpm test:db      # интеграционные тесты схемы, RLS, аудита, seed
```

`db:migrate` и `db:generate` читают `DATABASE_URL` из окружения или `.env`
в корне репозитория. Для локального запуска:

```bash
docker compose -f deploy/compose/docker-compose.yml up -d postgres
pnpm db:migrate
pnpm seed
```

## Структура

```text
src/schema/
  enums.ts        pgEnum для закрытых доменных множеств
  vendor.ts       vendor_users … onboarding_sessions, vendor_audit_events
  identity.ts     users, auth_sessions, tenants, memberships, devices, device_tokens, invitations
  auth.ts         Better Auth: auth_accounts, auth_verifications, 2FA/passkeys, rate limit
  rate-limit.ts   email_rate_limits: общий per-email лимит OTP/magic-link
  projects.ts     projects, политика, версии, сессии, дни, споры, выплаты
  ops.ts          git-интеграции, вебхуки, уведомления, дайджесты
  audit.ts        tenant_audit_events, tenant_audit_anchors
  idempotency.ts  idempotency_keys
src/client.ts     пул, Drizzle, tenant-контекст транзакции
src/idempotency.ts withIdempotency()
src/auth/         приглашения, device-токены, членства, tenant-данные
drizzle/          SQL-миграции и снапшоты
test/             интеграционные тесты на реальном PostgreSQL
```

Домен (`@partner-coder/domain`) не зависит от БД: зависимость только
`db → domain`.

## Роли БД

| Роль                      | Назначение                                   | RLS                    |
| ------------------------- | -------------------------------------------- | ---------------------- |
| `partner_coder_api`       | API тенантского контура                      | включен                |
| `partner_coder_vendor`    | вендорская консоль, только вендорский контур | не нужен               |
| `partner_coder_worker`    | доверенные задания (закрытие дня, якоря)     | `BYPASSRLS`            |
| `partner_coder_auth`      | Better Auth: users, сессии, OTP/аккаунты     | включен                |
| `partner_coder_retention` | удаление старых heartbeat через функцию      | политика DELETE/SELECT |

Роли создаются миграцией как `NOLOGIN`-группы. Логин для приложения
провижинится отдельно и получает членство в нужной роли. Пароли и секреты в
миграциях не хранятся.

## Изоляция tenant

- Все тенантские таблицы содержат `tenant_id NOT NULL`; дочерние таблицы
  дублируют его, чтобы политика была одинаковой и не зависела от JOIN.
- Дочерние FK составные: `(tenant_id, parent_id)` → `(tenant_id, id)`
  родителя; сослаться на родителя другого tenant нельзя даже без RLS.
- API-роль видит строки только при `app.tenant_id`, выставленном в транзакции:

```ts
await withTenantContext(db, { tenantId, userId }, async (tx) => {
  // запросы выполняются под RLS
});
```

- `tenants` использует `id = app.tenant_id`; `users` — членство в текущем
  tenant и `app.user_id`; `auth_sessions` — только `app.user_id`. Вход и
  выбор tenant используют `SECURITY DEFINER` функции `auth_user_by_email`,
  `auth_user_memberships`, `auth_device_by_token_hash`,
  `auth_invitation_by_token_hash`.
- `device_tokens` — тенантская таблица с теми же политиками и составными FK,
  что и остальные дочерние таблицы.
- Better Auth-таблицы не видны API-роли; `partner_coder_auth` не видит
  тенантские данные.
- Аудит пишется через `app_audit()`; actor берется из `app.user_id`.
- Без `app.tenant_id` политика не пропускает ни одной строки.
- Вендорская роль не читает тенантские таблицы; вендорский доступ к сырым
  heartbeat запрещен на уровне прав.

## Аутентификация и приглашения

- `src/auth/invitations.ts`: `createInvitation` (сырой токен возвращается один
  раз, в БД SHA-256; director выдает любую роль, support — только developer),
  `acceptInvitation` (проверка email, запрет повторной активации членства,
  аудит отказа отдельной транзакцией), `revokeInvitation`, `inspectInvitation`.
- `src/auth/device-tokens.ts`: выпуск, аутентификация, ротация и отзыв
  `pcd_…`-токенов; в БД только хеш, TTL по умолчанию 90 дней, ротация
  self-service с сохранением срока, каскадный отзыв по `rotated_from`,
  проверка статуса устройства и tenant.
- `src/auth/identity.ts`: членства пользователя через
  `auth_user_memberships`; `findUserByEmail`.
- `src/auth/tenant-data.ts`: активный tenant сессии, список приглашений и
  команды, сводка tenant для API.
- `src/auth/audit.ts`: единая запись через `app_audit()`.
- OTP/magic-link живут в `auth_verifications` только в виде хешей; сам вход
  настраивается в `apps/api/src/auth/config.ts`.
- Общий rate limit (ADR-0012): `auth_rate_limits` пишет auth-роль для Better
  Auth, `email_rate_limits` — API-роль для per-email лимита OTP/magic-link.
  Worker удаляет окна старше суток; таблицы не tenant-ские и не видны чужим
  контурам.

## Append-only и аудит

Append-only (запрет UPDATE/DELETE/TRUNCATE триггером и правами):

`heartbeats`, `intervals`, `day_records`, `day_adjustments`, `day_flags`,
`connector_events`, `repo_facts`, `monthly_snapshots`, `tenant_audit_events`,
`vendor_audit_events`.

- `tenant_audit_events` и `vendor_audit_events` получают `chain_seq`,
  `prev_hash` и `hash` в BEFORE INSERT триггере; цепочка сериализуется
  advisory lock. Канонизация версионирована и использует префиксы длин;
  вендорская цепочка включает `customer_id`.
- `verify_tenant_audit_chain(uuid)` и `verify_vendor_audit_chain()` проверяют
  цепочку; подмена события или перенос разделителя обнаруживается.
- `anchor_tenant_audit(uuid, date)` и `anchor_vendor_audit(date)` фиксируют
  дневной якорь (UTC). Якоря производные и пересчитываются upsert-ом;
  `verify_tenant_audit_anchor` проверяет снимок.
- Компенсация закрытого дня — новая строка `day_adjustments`, не UPDATE.
- `retention_delete_heartbeats(cutoff)` — единственный путь удаления сырых
  heartbeat: `SECURITY DEFINER`, владелец `partner_coder_retention`, прямой
  DELETE для остальных ролей блокирует append-only триггер.

## Идемпотентность

`withIdempotency(db, { tenantId, scope, key, requestHash }, operation)`
выполняет мутацию в транзакции с tenant-контекстом:

- повтор с тем же ключом и телом возвращает сохраненный ответ (`replayed: true`);
- тот же ключ с другим `requestHash` — `IdempotencyConflictError`;
- падение операции откатывает и ключ, и запись;
- истекший ключ удаляется и используется заново;
- tenant-ключи изолированы RLS, vendor-ключи (`tenantId: null`) доступны
  вендорской роли.

## Миграции

Схема генерируется `drizzle-kit`; RLS, роли, триггеры и функции живут в
кастомных SQL-миграциях. Каждая миграция применяется на чистой БД в
интеграционных тестах. Новые таблицы обязаны:

1. Иметь `tenant_id`, если относятся к тенантскому контуру.
2. Получить политику `tenant_isolation` (миграция RLS).
3. Получить гранты для нужных ролей.
4. Для журналов — триггер `reject_append_only_mutation`.
