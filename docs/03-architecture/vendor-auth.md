# Аутентификация вендорской консоли

| Поле      | Значение                                                   |
| --------- | ---------------------------------------------------------- |
| Статус    | реализовано в PR A; passkeys/UI — PR B                     |
| Дата      | 2026-11-16                                                 |
| Связанные | ADR-0006, ADR-0009, ADR-0010, ADR-0012, ADR-0013, M3, R-45 |

Документ описывает отдельный контур входа в вендорскую консоль (M3). Он не
меняет tenant-аутентификацию директора и разработчика: email-OTP, magic-link,
приглашения и device-токены остаются как есть.

**Статус реализации PR A.** Работают password + TOTP для всех вендорских
ролей, приглашения/reset, блокировка, step-up, origin guard, rate limit,
worker TTL, bootstrap CLI и E2E. Таблица `vendor_auth_passkeys` создана, но
плагин passkey и UI не подключены (PR B). Фактические коды ошибок и события
аудита уточнены в §8–§9: step-up с неверным паролем отвечает
400 `invalid_password`, отказ роли пишет `vendor.auth.role_denied`.

## 1. Зачем отдельный контур

В системе два несвязанных мира идентичности:

- tenant-пользователи — `users` + `auth_accounts` / `auth_sessions` /
  `auth_verifications` / `auth_two_factors` / `auth_passkeys`;
- вендорские пользователи — `vendor_users` с ролями `superadmin`, `finance`,
  `support`, `readonly` и статусами `invited`, `active`, `suspended`,
  `disabled`.

`auth_two_factors` и `auth_passkeys` ссылаются на `users`, а не на
`vendor_users`; смешивать контуры нельзя. Роли БД тоже разделены:
`partner_coder_auth` видит tenant-секреты, `partner_coder_vendor` — только
вендорские данные. Отдельный контур сохраняет эту границу и позволяет
применять к вендорской консоли более строгие правила: пароль, обязательный
TOTP, короткая сессия, аудит каждого действия.

## 2. Рассмотренные варианты

| Вариант                                         | Итог                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Отдельный контур на Better Auth** (выбран) | Второй инстанс Better Auth, таблицы `vendor_auth_*`, роли `partner_coder_vendor` (данные) и `partner_coder_vendor_auth` (секреты). Переиспользуются проверенные сессии, TOTP, passkeys, lockout и rate limit. Tenant-auth не меняется. |
| B. Единая identity                              | Вендор = строка `users` + профиль `vendor_users`, один Better Auth. Меньше таблиц, но контуры смешиваются, password становится глобальным, возможны пересечения email и членств. Отклонён.                                             |
| C. Свой auth-сервис                             | Свои сессии, TOTP и WebAuthn. Полный контроль ценой самостоятельной реализации криптографии, ротации сессий, CSRF и lockout; противоречит ADR-0010. Отклонён.                                                                          |
| D. Passkey-only                                 | Только passkey, без пароля и TOTP. Максимальная phishing-resistance, но тяжёлое восстановление доступа и зависимость от оборудования. Отклонён как единственный способ; passkey поддерживается дополнительно.                          |

Внутри варианта A рассмотрены способы первого фактора:

- **email + password + TOTP** (выбран): нативный сценарий плагина `twoFactor`
  Better Auth; пароль задаётся одноразовой ссылкой, TOTP обязателен;
- email-OTP + собственный TOTP-хук: плагин `twoFactor` не перехватывает
  `/sign-in/email-otp`, поэтому пришлось бы вводить собственное состояние
  «сессия прошла второй фактор» и защищать его от обхода;
- passkey-only: отклонён как единственный способ по причинам варианта D.

## 3. Решение

1. **Второй инстанс Better Auth** `vendorAuth` с `basePath`
   `/api/vendor-auth`, отдельным `VENDOR_AUTH_SECRET`, cookie-префиксом
   `pc-vendor` и доверенным origin `VENDOR_BASE_URL`.
2. **Пользователи — `vendor_users`.** Better Auth маппится на эту таблицу:
   `user → vendor_users`, `session → vendor_auth_sessions`,
   `account → vendor_auth_accounts`, `verification → vendor_auth_verifications`,
   `twoFactor → vendor_auth_two_factors`, `passkey → vendor_auth_passkeys`,
   `rateLimit → vendor_auth_rate_limits`.
3. **Вход email + password.** Пароль задаётся только по одноразовой ссылке
   сброса; открытая регистрация и HTTP-маршрут `/sign-up/*` запрещены.
   Пользователей создаёт суперадминистратор из консоли.
4. **TOTP обязателен для всех вендорских ролей.** Пока
   `two_factor_enabled = false`, сессия считается сессией первичной настройки:
   доступны только `/v1/vendor/auth/me` и маршруты включения TOTP. Отключение
   TOTP через `/two-factor/disable` запрещено.
5. **Passkey — дополнительный способ входа.** Пользователь регистрирует
   passkey после включения TOTP. Passkey-вход создаёт полноценную сессию
   (passkey сам по себе MFA: владение + user verification), но TOTP остаётся
   обязательным резервным фактором. Passkey не заменяет TOTP.
6. **Короткая сессия.** TTL по умолчанию 8 часов, `updateAge` 15 минут;
   cookie `HttpOnly`, `SameSite=Lax`, `Secure` вне local.
7. **Step-up для опасных действий.** Повторный ввод пароля через
   `auth.api.verifyPassword`; успех выставляет `step_up_until` на 5 минут.
   Guard `requireVendorStepUp` используется первым опасным действием M3
   (счёт, платёж, смена статуса).
8. **Аудит.** Создание/изменение вендорского пользователя, приглашение, вход,
   сброс пароля, включение/сброс TOTP, passkey, отзыв сессий пишутся в
   `vendor_audit_events` с хеш-цепочкой. Секреты, пароли, TOTP-коды и токены
   в аудит не попадают.
9. **Rate limit.** Better Auth использует общий store
   `vendor_auth_rate_limits` вне local; per-email лимитер входа и сброса
   пароля — `vendor_auth_email_limits` (5/60 секунд на email). Глобальный
   Fastify-лимит остаётся per-instance.
10. **Отдельные роли БД.** `partner_coder_vendor` — данные вендорского
    контура; `partner_coder_vendor_auth` — только `vendor_users` (чтение и
    обновление) и `vendor_auth_*` (секреты). API/auth/worker не получают
    доступ к вендорским секретам.

## 4. Схема БД

Все таблицы — в схеме `public`, без `tenant_id`: вендорский контур глобальный.
RLS на вендорских таблицах не включается (как и на существующих вендорских
таблицах); изоляция обеспечивается грантами и раздельными логинами. Это
осознанное решение: вендорская команда видит всех клиентов, tenant-изоляция
здесь не применяется. Каталожные тесты фиксируют отсутствие доступа у чужих
ролей.

### 4.1 Расширение `vendor_users`

| Колонка          | Тип                              | Примечание                                                                     |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `email_verified` | `boolean not null default false` | Core-поле Better Auth; выставляется в `true` после установки пароля по ссылке. |
| `image`          | `text`                           | Core-поле Better Auth; не используется в UI M3, но требуется схемой.           |

Drizzle-свойство `mfaEnabled` переименовывается в `twoFactorEnabled`;
колонка остаётся `mfa_enabled`. Это нужно, чтобы поле совпало с полем
`twoFactorEnabled`, которое добавляет плагин `twoFactor`. Данные и DDL не
меняются; обновляются seed, фикстуры и тесты.

Существующие `role`, `status`, `last_login_at` остаются. `role` и `status`
передаются в Better Auth как `additionalFields` с `input: false` — клиент не
может выставить себе роль или статус.

### 4.2 Новые таблицы

| Таблица                     | Колонки                                                                                                                                                                                                                                                                                         | Ограничения                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `vendor_auth_accounts`      | `id text pk`, `account_id text not null`, `provider_id text not null`, `user_id uuid not null → vendor_users(id) on delete restrict`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password text`, `created_at`, `updated_at`  | `unique(provider_id, account_id)`, индекс `user_id`                  |
| `vendor_auth_sessions`      | `id uuid pk default gen_random_uuid()`, `token text not null`, `user_id uuid not null → vendor_users(id)`, `expires_at timestamptz not null`, `ip_address inet`, `user_agent text`, `step_up_until timestamptz`, `created_at`, `updated_at`                                                     | `unique(token)`, индекс `(user_id, expires_at)`, индекс `expires_at` |
| `vendor_auth_verifications` | `id text pk`, `identifier text not null`, `value text not null`, `expires_at timestamptz not null`, `created_at`, `updated_at`                                                                                                                                                                  | индексы `identifier`, `expires_at`                                   |
| `vendor_auth_two_factors`   | `id text pk`, `secret text not null`, `backup_codes text not null`, `user_id uuid not null → vendor_users(id)`, `verified boolean not null default true`, `failed_verification_count integer not null default 0`, `locked_until timestamptz`                                                    | индекс `user_id`, `check failed_verification_count >= 0`             |
| `vendor_auth_passkeys`      | `id text pk`, `name text`, `public_key text not null`, `user_id uuid not null → vendor_users(id)`, `credential_id text not null`, `counter integer not null default 0`, `device_type text not null`, `backed_up boolean not null default false`, `transports text`, `aaguid text`, `created_at` | `unique(credential_id)`, индекс `user_id`, `check counter >= 0`      |
| `vendor_auth_rate_limits`   | `id text pk default gen_random_uuid()::text`, `key text not null`, `count integer not null default 0`, `last_request bigint not null`                                                                                                                                                           | `unique(key)`, индекс `last_request`, `check count >= 0`             |
| `vendor_auth_email_limits`  | `key text pk`, `count integer not null default 0`, `window_started_at timestamptz not null`                                                                                                                                                                                                     | индекс `window_started_at`, `check count >= 0`                       |

Детали, важные для совместимости с Better Auth 1.7.25:

- `vendor_auth_sessions.ip_address` объявляется через `inetAddress("ip_address")`:
  Better Auth пишет пустую строку, когда нет доверенных заголовков IP;
  хелпер превращает её в `NULL` (как в `auth_sessions`).
- `vendor_auth_sessions.step_up_until` объявляется как session
  `additionalFields.stepUpUntil` с `type: "date"`, `input: false`.
- `vendor_auth_two_factors` повторяет поля плагина: `secret`, `backupCodes`,
  `userId`, `verified`, `failedVerificationCount`, `lockedUntil`. TOTP-секрет
  и backup-коды Better Auth хранит зашифрованными ключом, производным от
  `VENDOR_AUTH_SECRET`; открытых секретов в БД нет.
- `vendor_auth_passkeys` использует Drizzle-свойство `credentialID`
  (именно `ID`, не `Id`) — так его ожидает плагин passkey. Колонка остаётся
  `credential_id`. Существующая tenant-таблица `auth_passkeys` с `credentialId`
  не трогается: tenant-passkeys пока не включены.
- `vendor_auth_rate_limits` — модель `rateLimit` Better Auth; поля
  `key`, `count`, `last_request` совпадают с `auth_rate_limits`.
- `vendor_auth_email_limits` — не таблица Better Auth, а store per-email
  лимитера; структура совпадает с `email_rate_limits`.

### 4.3 Миграция

Следующая миграция — `0006`. Она:

1. добавляет `vendor_users.email_verified` и `vendor_users.image`;
2. создаёт семь таблиц `vendor_auth_*`;
3. создаёт роль `partner_coder_vendor_auth NOLOGIN` (если её нет) и гранты;
4. создаёт `SECURITY DEFINER` функцию `vendor_audit(...)` и выдаёт
   `EXECUTE` вендорским ролям;
5. выдаёт worker права на TTL-очистку новых таблиц;
6. не включает RLS на вендорских таблицах.

Миграция генерируется `drizzle-kit` для таблиц, затем в неё добавляются
роль и гранты в стиле `0003`/`0005`. `pnpm db:check` должен подтвердить
отсутствие дрейфа.

## 5. Роли БД и гранты

| Роль                                         | Доступ                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `partner_coder_vendor`                       | Существующие вендорские таблицы, включая `vendor_users` (CRUD). **Не видит** `vendor_auth_*`.                                                                                                                                                                                                                                  |
| `partner_coder_vendor_auth` (новая, NOLOGIN) | `USAGE` на схему `public`; `SELECT, INSERT, UPDATE` на `vendor_users`; `SELECT, INSERT, UPDATE, DELETE` на `vendor_auth_accounts`, `vendor_auth_sessions`, `vendor_auth_verifications`, `vendor_auth_two_factors`, `vendor_auth_passkeys`, `vendor_auth_rate_limits`, `vendor_auth_email_limits`. **Не видит** tenant-таблицы. |
| `partner_coder_worker`                       | Дополнительно `SELECT, DELETE` на `vendor_auth_sessions`, `vendor_auth_verifications`, `vendor_auth_rate_limits`, `vendor_auth_email_limits` для TTL. TOTP/passkeys не удаляются.                                                                                                                                              |
| `partner_coder_api` / `partner_coder_auth`   | Без грантов на `vendor_users` и `vendor_auth_*`; каталожный тест это фиксирует.                                                                                                                                                                                                                                                |

Аудит из auth-роли пишется через `SECURITY DEFINER` функцию
`vendor_audit(p_actor_id uuid, p_customer_id uuid, p_action text, p_entity text, p_before jsonb, p_after jsonb, p_ip inet)`,
созданную в `0006`:

- владелец — `partner_coder_worker` (имеет `INSERT` и `SELECT` на
  `vendor_audit_events`; триггер хеш-цепочки выполняется от владельца);
- `REVOKE EXECUTE … FROM PUBLIC`;
- `GRANT EXECUTE … TO partner_coder_vendor, partner_coder_vendor_auth`;
- функция только вставляет событие и возвращает `uuid`; читать журнал
  auth-роль не может;
- вызов из транзакции изменения (vendor-пул — для админских действий,
  vendor-auth-пул — для сессий/TOTP/passkeys) делает аудит атомарным.

Прямой `INSERT` в `vendor_audit_events` у `partner_coder_vendor` остаётся
(существующее поведение и тесты); новая auth-роль получает только функцию.

Логины провижинятся отдельно от миграций (как в ADR-0009):

- `VENDOR_DATABASE_URL` — логин, член только `partner_coder_vendor`;
- `VENDOR_AUTH_DATABASE_URL` — логин, член только
  `partner_coder_vendor_auth`.

Вне local API проверяет оба логина при старте: не суперпользователь, не
`BYPASSRLS`, нет пересечения с `partner_coder_api`, `partner_coder_auth`,
`partner_coder_vendor`, `partner_coder_worker` и между собой. Локально
разрешён fallback на `DATABASE_URL`, чтобы не усложнять dev-среду.

## 6. Конфигурация Better Auth

`apps/api/src/vendor-auth/config.ts` создаёт отдельный инстанс:

```ts
betterAuth({
  appName: "Партнер кодер — вендор",
  baseURL: env.API_BASE_URL,
  basePath: "/api/vendor-auth",
  secret: env.VENDOR_AUTH_SECRET,
  trustedOrigins: [env.VENDOR_BASE_URL, env.API_BASE_URL],
  database: drizzleAdapter(vendorAuthDb, {
    provider: "pg",
    schema: {
      user: vendorUsers,
      session: vendorAuthSessions,
      account: vendorAuthAccounts,
      verification: vendorAuthVerifications,
      twoFactor: vendorAuthTwoFactors,
      passkey: vendorAuthPasskeys,
      ...(rateLimitStorage === "database" ? { rateLimit: vendorAuthRateLimits } : {}),
    },
  }),
  advanced: {
    database: { generateId: () => randomUUID() },
    cookiePrefix: "pc-vendor",
    // ipAddress: AUTH_IP_HEADERS / AUTH_TRUSTED_PROXIES, как в tenant-auth
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, input: false },
      status: { type: "string", required: false, defaultValue: "invited", input: false },
    },
  },
  session: {
    expiresIn: env.VENDOR_SESSION_TTL_HOURS * 3600,
    updateAge: 15 * 60,
    additionalFields: {
      stepUpUntil: { type: "date", required: false, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    // HTTP sign-up блокируется прокси; серверный signUpEmail нужен для создания пользователя
    disableSignUp: false,
    autoSignIn: false,
    minPasswordLength: env.VENDOR_PASSWORD_MIN_LENGTH,
    maxPasswordLength: 128,
    requireEmailVerification: false,
    resetPasswordTokenExpiresIn: env.VENDOR_PASSWORD_RESET_TTL_MINUTES * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) =>
      mailer.sendVendorPasswordReset({ email: user.email, url }),
    onPasswordReset: async ({ user }) => vendorUsersService.activateAfterPasswordReset(user.id),
  },
  plugins: [
    twoFactor({
      issuer: "Партнер кодер (вендор)",
      backupCodeOptions: { amount: 10, storeBackupCodes: "encrypted" },
      // account lockout включён по умолчанию; точные лимиты — в тестах
    }),
    passkey({
      rpID: env.VENDOR_WEBAUTHN_RP_ID,
      rpName: "Партнер кодер (вендор)",
      origin: [env.VENDOR_BASE_URL],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
    }),
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
    ...(rateLimitStorage === "database"
      ? { storage: "database" as const, modelName: "rateLimit" }
      : {}),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const status = await vendorUsersService.getStatus(session.userId);
          if (status === "suspended" || status === "disabled") return false;
        },
        after: async (session) => {
          await vendorUsersService.markLogin(session.userId); // invited → active, best-effort
        },
      },
    },
  },
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/sign-in/email",
        handler: async (ctx) => {
          // email из тела; для suspended/disabled — APIError 403 VENDOR_INACTIVE
          // чтобы консоль показала понятное сообщение вместо общего 401.
        },
      },
    ],
  },
});
```

Требуется зависимость `@better-auth/passkey` (в 1.7 плагин passkey вынесен из
`better-auth/plugins`). Версия ставится в пару с `better-auth` 1.7.25 и
фиксируется в `pnpm-lock.yaml`.

Конфиг выше — целевой. В PR A плагин `passkey()` и зависимость
`@better-auth/passkey` не подключаются: PR A закрывает password + TOTP,
таблица `vendor_auth_passkeys` создаётся заранее. Плагин, регистрация,
вход и UI passkeys добавляются в PR B.

## 7. Потоки

### 7.1 Создание вендорского пользователя

1. Суперадминистратор: `POST /v1/vendor/users` с `{ email, name, role }`.
2. Проверка прав: только `superadmin`. Создание роли `superadmin` требует
   явного флага `confirmSuperadmin: true`; иначе 400. Это защита от
   случайного повышения прав через UI.
3. Нормализация email (`trim().toLowerCase()`), проверка существования
   `vendor_users` по `lower(email)`.
   - `invited` — повторная отправка ссылки, 200;
   - `active` — 409 `vendor_user_exists`;
   - `suspended`/`disabled` — 409 `vendor_user_inactive`.
4. Серверный `vendorAuth.api.signUpEmail({ email, name, password: randomBytes(32) })`
   с `autoSignIn: false`. Случайный пароль никому не сообщается и не
   логируется; он нужен только чтобы создать credential-account. Пользователь
   не сможет войти, пока не установит свой пароль.
5. `UPDATE vendor_users SET role = ..., status = 'invited', email_verified = false`
   (vendor auth pool).
6. `vendorAuth.api.requestPasswordReset({ email, redirectTo: "${VENDOR_BASE_URL}/reset-password" })`
   — письмо со ссылкой на установку пароля.
7. Аудит `vendor.user.invited` (actor — суперадминистратор, after — email
   masked, role, status).

Если письмо не отправилось, пользователь остаётся `invited`; повторный
`POST /v1/vendor/users` или `POST /v1/vendor/users/:id/reset-password`
переотправляет ссылку.

#### 7.1.1 Первичный суперадминистратор

На чистой staging/prod БД ещё нет ни одного суперадминистратора, поэтому
`POST /v1/vendor/users` вызвать некому. Для bootstrap добавляется
одноразовый ops-инструмент `apps/api/src/cli/provision-vendor-admin.ts`:

```powershell
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops"
```

Инструмент:

1. требует `VENDOR_AUTH_DATABASE_URL`/`VENDOR_DATABASE_URL` (или local
   fallback), подключается теми же ролями, что API;
2. отказывается работать, если в `vendor_users` уже есть `superadmin`
   (`--force` — явное подтверждение для аварийного случая);
3. создаёт пользователя через тот же сервис, что `POST /v1/vendor/users`
   (случайный пароль, `status = invited`, роль `superadmin`);
4. отправляет одноразовую ссылку установки пароля через SMTP;
5. пишет аудит `vendor.user.bootstrap_admin` с actor `NULL`;
6. не хранит и не печатает пароль; повторный запуск идемпотентен для
   `invited`-пользователя и переотправляет ссылку.

Пароль и TOTP в миграции, seed или переменных окружения не хранятся.
Локально демо-вендор создаётся `pnpm seed` в статусе `invited`; вход — через
«забыли пароль» и Mailpit. В staging/prod первый админ создаётся этим
инструментом по runbook из `deploy/environments/staging/README.md`.

### 7.2 Установка пароля и активация

1. Пользователь открывает ссылку из письма (`VENDOR_BASE_URL/reset-password?...`).
2. Консоль отправляет `POST /api/vendor-auth/reset-password` с `{ token, newPassword }`.
3. Better Auth обновляет credential-account и при `revokeSessionsOnPasswordReset`
   отзывает все сессии.
4. `onPasswordReset` вызывает `activateAfterPasswordReset`:
   - `invited → active`, `email_verified = true`;
   - `active` остаётся `active`;
   - `suspended`/`disabled` **не реактивируются**: пароль меняется, но
     статус сохраняется, сессии отозваны, доступ закрыт. Аудит фиксирует
     `vendor.auth.password_reset_completed` с фактическим статусом.
5. Пользователь входит с email и паролем, если статус позволяет.

Ссылка одноразовая, TTL 30 минут по умолчанию. Токен не логируется;
query-redaction pino уже покрывает `token`.

`sendResetPassword` перед отправкой проверяет `vendor_users.status`:
для `suspended`/`disabled` письмо не отправляется, а публичный запрос
возвращает обычный успешный ответ (без раскрытия статуса). Админский
`POST /v1/vendor/users/:id/reset-password` для неактивного пользователя
возвращает 409 `vendor_user_inactive`: сначала нужно активировать его
через `PATCH /v1/vendor/users/:id`.

### 7.3 Вход с TOTP

1. `POST /api/vendor-auth/sign-in/email` с email и паролем.
2. Если `two_factor_enabled = true`, Better Auth не создаёт сессию, а
   возвращает `twoFactorRedirect = true` и временную 2FA-cookie.
3. Консоль запрашивает код и вызывает
   `POST /api/vendor-auth/two-factor/verify-totp`.
4. Успех — полноценная сессия; guard пропускает данные.
5. Неверный код увеличивает счётчик; после лимита — `ACCOUNT_TEMPORARILY_LOCKED`
   (429). Backup-код принимается через `/two-factor/verify-backup-code`.
6. `session.create.after` обновляет `last_login_at` и переводит `invited` в
   `active` (best-effort).

### 7.4 Первый вход и включение TOTP

1. Пользователь вошёл по паролю, `two_factor_enabled = false`; Better Auth
   создал полноценную сессию.
2. `GET /v1/vendor/auth/me` возвращает `mfaEnrollmentRequired: true`.
3. Консоль показывает экран настройки: пользователь повторно вводит пароль
   (требование плагина) и вызывает `POST /api/vendor-auth/two-factor/enable`.
4. Ответ содержит TOTP-URI и backup-коды (показываются один раз; в БД лежат
   зашифрованными).
5. Пользователь добавляет аккаунт в authenticator и вызывает
   `POST /api/vendor-auth/two-factor/verify-totp`.
6. Плагин выставляет `two_factor_enabled = true`; guard снимает ограничение.
7. Аудит `vendor.user.mfa_enabled`.

Пока TOTP не включён, `/v1/vendor/*` отвечает 403 `vendor_mfa_required`;
доступны только `/v1/vendor/auth/me` и прокси `/api/vendor-auth/*`.
Отключение TOTP (`/two-factor/disable`) заблокировано на прокси.

### 7.5 Passkey

1. После включения TOTP пользователь вызывает
   `POST /api/vendor-auth/passkey/add-passkey` (нужна сессия).
2. Браузер выполняет WebAuthn-регистрацию; плагин сохраняет credential в
   `vendor_auth_passkeys`.
3. Вход: `POST /api/vendor-auth/passkey/...` (клиентский плагин
   `signIn.passkey`). Passkey создаёт полноценную сессию; при
   `two_factor_enabled = true` guard считает её MFA-сессией.
4. Если TOTP ещё не включён, passkey-сессия тоже упирается в
   `vendor_mfa_required`: passkey не заменяет обязательный TOTP.
5. Список и удаление passkey — штатные маршруты плагина
   (`list-user-passkeys`, `delete-passkey`); действия аудируются.
6. Восстановление: потерянный passkey не блокирует вход, пока есть пароль и
   TOTP/backup-коды. Сброс MFA суперадминистратором удаляет и TOTP, и
   passkeys.

### 7.6 Сброс пароля и смена пароля

- Публичный `POST /api/vendor-auth/request-password-reset` (per-email лимит
  5/60) отправляет ссылку. Ответ не раскрывает существование пользователя.
- Самостоятельная смена пароля — штатный `/change-password` Better Auth
  (требует текущий пароль и сессию).
- Сброс суперадминистратором — `POST /v1/vendor/users/:id/reset-password`;
  ссылка уходит на email пользователя, суперадминистратор пароль не видит.
- После сброса все сессии пользователя отзываются.

### 7.7 Приостановка, отключение и сброс MFA

- `PATCH /v1/vendor/users/:id` меняет `role`/`status`; только `superadmin`;
  нельзя менять себя (защита от самоблокировки). Смена роли пишет
  `vendor.user.role_changed` с before/after.
- `suspended`/`disabled`: удаляются все `vendor_auth_sessions` пользователя,
  аудит `vendor.user.suspended` / `vendor.user.disabled`.
- Создание новой сессии для `suspended`/`disabled` запрещено на уровне
  Better Auth `databaseHooks.session.create.before` (возврат `false`):
  удаление сессий — не единственная защита. Для password-входа
  дополнительный `hooks.before` на `/sign-in/email` возвращает 403
  `VENDOR_INACTIVE` с понятным сообщением; passkey-вход отсекается тем же
  session-hook-ом.
- Guard проверяет статус на каждом запросе: валидная сессия неактивного
  пользователя получает 403 `vendor_inactive`, а сессия отзывается
  best-effort.
- Повторная активация возвращает `active`; TOTP и passkeys сохраняются.
  `markLogin` переводит только `invited → active` и никогда не
  реактивирует `suspended`/`disabled`.
- `POST /v1/vendor/users/:id/reset-mfa`: в одной транзакции удаляет
  `vendor_auth_two_factors`, `vendor_auth_passkeys`, сбрасывает
  `two_factor_enabled = false`, отзывает сессии и пишет `vendor.user.mfa_reset`.
  Пользователь входит по паролю и заново включает TOTP.

### 7.8 Step-up

- `POST /v1/vendor/auth/step-up` с `{ password }`; сервер вызывает
  `vendorAuth.api.verifyPassword` с заголовками текущей сессии.
- Успех: `UPDATE vendor_auth_sessions SET step_up_until = now() + interval '5 minutes'`.
- Guard `requireVendorStepUp` требует `step_up_until > now()`; иначе 403
  `vendor_step_up_required`.
- Лимит попыток step-up — 5 за 5 минут на пользователя через
  `vendor_auth_email_limits` (ключ `stepup:<userId>`).
- Step-up используется первым опасным действием M3 (создание счёта,
  фиксация платежа, смена финансового статуса). До этого endpoint и guard
  существуют, но ни один маршрут их не требует.

## 8. API

### 8.1 Прокси Better Auth

`GET|POST /api/vendor-auth/*` — тонкий прокси, как `/api/auth/*`:

- пробрасывает заголовки, тело и `set-cookie`;
- per-email лимит для `/sign-in/email` и `/request-password-reset`;
- блокирует:
  - `/sign-up/*` — открытая регистрация запрещена;
  - `/two-factor/disable` — TOTP нельзя отключить;
  - `/two-factor/send-otp`, `/two-factor/verify-otp` — email-OTP как второй
    фактор не включён;
  - `/admin/*`, `/delete-user`, `/change-email`, `/link-social`,
    `/unlink-account`, `/sign-in/social`, `/callback/*` — не используются;
- ошибки Better Auth возвращаются в его формате (не `ErrorEnvelope`), как у
  tenant-auth; консоль использует Better Auth client.

### 8.2 Собственные маршруты

| Метод и путь                               | Доступ                           | Назначение                                                                                                            |
| ------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/vendor/auth/me`                   | любая валидная вендорская сессия | `{ user: { id, email, name, role, status, twoFactorEnabled }, mfaEnrollmentRequired, sessionExpiresAt, stepUpUntil }` |
| `POST /v1/vendor/auth/step-up`             | сессия + MFA                     | повторная проверка пароля, `stepUpUntil`                                                                              |
| `GET /v1/vendor/users`                     | `superadmin`                     | список вендорских пользователей                                                                                       |
| `POST /v1/vendor/users`                    | `superadmin`                     | create/invite (идемпотентно для `invited`)                                                                            |
| `PATCH /v1/vendor/users/:id`               | `superadmin`                     | роль/статус, отзыв сессий при блокировке                                                                              |
| `POST /v1/vendor/users/:id/reset-password` | `superadmin`                     | письмо со ссылкой                                                                                                     |
| `POST /v1/vendor/users/:id/reset-mfa`      | `superadmin`                     | сброс TOTP/passkeys и сессий                                                                                          |
| `DELETE /v1/vendor/users/:id`              | —                                | не делаем; используем `status = disabled`                                                                             |

Коды ошибок: `vendor_unauthenticated` (401 — сессии нет),
`vendor_inactive` (403 — сессия есть, статус `suspended`/`disabled`),
`vendor_mfa_required` (403), `vendor_role_denied` (403),
`vendor_step_up_required` (403), `invalid_password` (400 — неверный пароль
step-up), `superadmin_confirmation_required` (400),
`vendor_user_exists` (409), `vendor_user_inactive` (409 — сброс пароля для
suspended/disabled), `vendor_user_not_found` (404),
`vendor_self_change_denied` (409), `vendor_origin_denied` (403),
`vendor_auth_path_forbidden` (403), `email_rate_limited` (429). Все собственные
ошибки идут в общем `ErrorEnvelope` с `requestId`. Прокси возвращает ошибки
Better Auth в его формате; вход suspended/disabled — 403 `VENDOR_INACTIVE`.

OpenAPI: собственные маршруты описываются Zod-схемами и попадают в
`/openapi.json`, `openapi.json` и `openapi.d.ts`; прокси Better Auth
описывается в `docs/03-architecture/api.md`, а не как wildcard в OpenAPI.

### 8.3 Guard

`apps/api/src/vendor-auth/guard.ts`:

- `authenticateVendor` — `vendorAuth.api.getSession`; нет сессии → 401
  `vendor_unauthenticated`; статус `suspended` / `disabled` → 403
  `vendor_inactive` и best-effort отзыв сессии; `invited` / `active`
  допускаются;
- `requireVendorMfa` — `twoFactorEnabled === true`, иначе 403
  `vendor_mfa_required`;
- `requireVendorRole(roles)` — роль из `vendor_users.role`, иначе 403
  `vendor_role_denied` + аудит;
- `requireVendorStepUp` — `stepUpUntil > now()`, иначе 403
  `vendor_step_up_required`;
- проверка `Origin` для небезопасных методов `/v1/vendor/*` и
  `/api/vendor-auth/*` (cookie-аутентификация; origin должен входить в
  `VENDOR_BASE_URL`/`API_BASE_URL`). Better Auth проверяет origin сам;
  собственные мутации проверяют дополнительно.

Контекст запроса: `request.vendorAuth?: VendorIdentity` с полями
`userId`, `email`, `name`, `role`, `status`, `twoFactorEnabled`,
`sessionId`, `sessionExpiresAt`, `stepUpUntil`. Tenant-guard и
`resolveIdentity` не переиспользуются: у вендора нет членств и tenant-контекста.

## 9. Аудит

Пишем в `vendor_audit_events` (append-only, хеш-цепочка, дневной якорь
worker-а). Actor — `vendor_users.id`; для неуспешного входа без
аутентификации — `NULL`.

| Действие                                           | Когда                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `vendor.user.bootstrap_admin`                      | первичный суперадминистратор создан ops-инструментом                                   |
| `vendor.user.invited`                              | создан пользователь / отправлена ссылка                                                |
| `vendor.user.role_changed`                         | смена роли (before/after)                                                              |
| `vendor.user.password_reset_requested`             | запрошена ссылка (self-service или админ)                                              |
| `vendor.auth.password_reset_completed`             | пароль установлен; статус — фактический                                                |
| `vendor.auth.password_changed`                     | самостоятельная смена пароля через `/change-password`                                  |
| `vendor.auth.sign_in_succeeded`                    | создана сессия (session hook)                                                          |
| `vendor.auth.sign_in_failed`                       | 401 на `/sign-in/email`; email хешируется                                              |
| `vendor.auth.mfa_failed`                           | 401/429 на `/two-factor/verify-totp` или `verify-backup-code`; actor `NULL`, path + IP |
| `vendor.auth.signed_out`                           | выход через `/sign-out`                                                                |
| `vendor.user.mfa_enabled`                          | TOTP включён                                                                           |
| `vendor.user.mfa_reset`                            | админ сбросил TOTP/passkeys                                                            |
| `vendor.user.passkey_added` / `passkey_removed`    | регистрация/удаление passkey                                                           |
| `vendor.user.suspended` / `disabled` / `activated` | смена статуса                                                                          |
| `vendor.session.revoked`                           | отзыв сессий при блокировке/сбросе (actor — админ)                                     |
| `vendor.auth.session_revoked`                      | пользователь отозвал свою/другие сессии                                                |
| `vendor.auth.step_up_succeeded` / `step_up_failed` | повторная проверка пароля                                                              |
| `vendor.auth.role_denied`                          | роль вендора не прошла `requireVendorRole`                                             |

`after` содержит только безопасные поля: masked email, role, status,
user id, session id, причина. Пароли, TOTP-секреты, коды, backup-коды,
токены и passkey public keys не пишутся. Для неуспешного входа —
`sha256(normalizedEmail)` и IP; для неуспешного второго фактора actor
неизвестен (временная 2FA-cookie не даёт полноценной сессии), поэтому
пишутся path, IP и `reason` — корреляция через логи/метрики и lockout.

Сбой аудита не отменяет вход/сброс; ошибка логируется pino (как в tenant
guard). Для административных изменений аудит пишется в той же транзакции,
что и изменение, чтобы не потерять событие.

## 10. Rate limit

| Уровень              | Хранилище                                                            | Лимит                          |
| -------------------- | -------------------------------------------------------------------- | ------------------------------ |
| Fastify глобальный   | память инстанса                                                      | 300/мин (существующий)         |
| Better Auth vendor   | `vendor_auth_rate_limits` вне local, memory локально                 | 20/мин на IP+путь              |
| Per-email вход/сброс | `vendor_auth_email_limits`                                           | 5/60 секунд на email           |
| Step-up              | `vendor_auth_email_limits`                                           | 5/5 минут на `stepup:<userId>` |
| Account lockout 2FA  | `vendor_auth_two_factors.failed_verification_count` / `locked_until` | по умолчанию Better Auth       |

`DatabaseEmailRateLimiter` получает опцию `table: "vendor_auth_email_limits"`
(whitelist из двух имён) и переиспользуется для вендорского контура; SQL
остаётся атомарным `INSERT … ON CONFLICT DO UPDATE`.

## 11. Окружение

| Переменная                          | По умолчанию                    | Правило                                                                                       |
| ----------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `VENDOR_DATABASE_URL`               | —                               | Логин `partner_coder_vendor`; вне local обязателен, локально fallback на `DATABASE_URL`.      |
| `VENDOR_AUTH_DATABASE_URL`          | —                               | Логин `partner_coder_vendor_auth`; вне local обязателен, локально fallback на `DATABASE_URL`. |
| `VENDOR_AUTH_SECRET`                | fallback `AUTH_SECRET` локально | Минимум 32 символа; вне local обязателен и не равен `AUTH_SECRET`.                            |
| `VENDOR_SESSION_TTL_HOURS`          | 8                               | 1…24.                                                                                         |
| `VENDOR_PASSWORD_RESET_TTL_MINUTES` | 30                              | 5…120.                                                                                        |
| `VENDOR_PASSWORD_MIN_LENGTH`        | 12                              | 12…64.                                                                                        |
| `VENDOR_WEBAUTHN_RP_ID`             | hostname из `VENDOR_BASE_URL`   | Домен RP; в prod может быть родительским (`partnercoder.ru` для `admin.partnercoder.ru`).     |
| `VENDOR_BASE_URL`                   | `http://localhost:3001`         | Уже существует; используется как trusted origin и passkey origin.                             |

`resolveRateLimitStorage` переиспользуется: local — memory, staging/prod —
database. `AUTH_IP_HEADERS`/`AUTH_TRUSTED_PROXIES` применяются и к
вендорскому инстансу.

## 12. Worker TTL

`ttl-cleanup` дополнительно удаляет:

- `vendor_auth_sessions` с `expires_at < now() - AUTH_SESSION_RETENTION_DAYS`;
- `vendor_auth_verifications` с `expires_at < now() - AUTH_VERIFICATION_RETENTION_DAYS`;
- `vendor_auth_rate_limits` с `last_request` старше суток;
- `vendor_auth_email_limits` с `window_started_at` старше суток.

Счётчики добавляются в результат job. `vendor_auth_two_factors` и
`vendor_auth_passkeys` не чистятся по TTL: это учётные данные пользователя.

## 13. Тесты

1. **Схема и миграции** (`packages/db/test/vendor-auth-schema.test.ts`):
   таблицы, колонки, FK, индексы, checks; `mfa_enabled` и
   `two_factor_enabled`-совместимость; миграция на чистой БД.
2. **Роли и гранты**:
   `partner_coder_vendor_auth` видит `vendor_users` и `vendor_auth_*`, не
   видит tenant-таблицы; `partner_coder_vendor` не видит `vendor_auth_*`;
   API/auth не видят вендорский контур; worker чистит только TTL-таблицы.
3. **Better Auth vendor** (`apps/api/src/vendor-auth/better-auth.test.ts`):
   создание пользователя, credential-account, отсутствие открытого пароля;
   `twoFactorRedirect`; шифрование TOTP-секрета и backup-кодов; verify-totp;
   backup-код; lockout; reset-password TTL и отзыв сессий; `onPasswordReset`
   активирует только `invited → active` и не реактивирует
   `suspended`/`disabled`; письмо для неактивного пользователя не уходит.
4. **Passkey**: регистрация требует сессию; passkey-вход создаёт сессию;
   TOTP-инвариант; каталог и удаление. Полный WebAuthn-сценарий в браузере —
   Playwright в M3.1 (UI), не в unit-тестах.
5. **Прокси** (`apps/api/src/vendor-auth/routes.test.ts`):
   blocked paths, per-email 429, `set-cookie`, origin, ошибки Better Auth.
6. **Guard и API**: 401/403 (`vendor_unauthenticated` vs `vendor_inactive`),
   `mfaEnrollmentRequired`, роли, self-change, suspend/revoke, reset-mfa,
   step-up, аудит-события; suspended/disabled не создаёт новую сессию и не
   проходит passkey-вход.
7. **E2E** (`apps/api/src/vendor-auth/e2e.test.ts`): суперадминистратор
   создаёт пользователя → письмо → установка пароля → вход → включение TOTP →
   доступ → приостановка → сессия отозвана.
8. **Rate limit**: два пула/инстанса делят `vendor_auth_email_limits`;
   окно сбрасывается; fallback при сбое БД.
9. **Worker TTL**: сессии/verifications/лимиты чистятся, TOTP/passkeys — нет.
10. **Конфиг**: новые env, дефолты, запрет `VENDOR_AUTH_SECRET === AUTH_SECRET`
    вне local, обязательные URL.
11. **OpenAPI drift**: `openapi:emit`/`openapi:types`, CI drift-check.
12. **Полный `pnpm check`** — все существующие 642 теста остаются зелёными.

## 14. Этапы внедрения

**PR A — фундамент (этот дизайн):**

1. миграция `0006`, схема (включая `vendor_auth_passkeys`), роли/гранты,
   `vendor_audit()`, env;
2. `vendorAuth` (password + TOTP, без плагина passkey), прокси, identity,
   guard, `/me`, step-up;
3. управление вендорскими пользователями, приглашение, сброс пароля/MFA,
   аудит;
4. `apps/api/src/cli/provision-vendor-admin.ts` для первого суперадминистратора;
5. worker TTL, тесты, документация (ADR-0013, api/data-model/threat-model/
   quickstart/staging README, ledger).

**PR B — passkeys и UI:**

1. зависимость `@better-auth/passkey`, плагин, регистрация/вход/удаление;
2. экраны входа, сброса пароля, включения TOTP, passkeys в `apps/web`;
3. Playwright E2E с виртуальным authenticator;
4. step-up подключается к первым опасным действиям M3.1.

PR A можно смержить без UI: контракт проверяется тестами и runtime smoke
через Mailpit. PR B не блокирует M3.1-данные, но нужен для удобного входа
людей.

## 15. Риски и отложенные вопросы

- **Секрет `VENDOR_AUTH_SECRET` критичен.** Потеря секрета делает TOTP и
  passkey-сессии нечитаемыми; хранение — в секрет-менеджере, бэкап и
  ротация — до staging. Ротация потребует повторной регистрации TOTP.
- **Второй инстанс Better Auth** увеличивает поверхность обновлений:
  `better-auth` и `@better-auth/passkey` обновляются вместе, схема и
  маппинг полей проверяются тестами.
- **Письма зависят от SMTP/SPF/DKIM/DMARC** (§14). До настройки — Mailpit
  локально и staging SMTP; ссылки сброса не должны попадать в логи.
- **Нет RLS на вендорских таблицах.** Изоляция — гранты и отдельные логины;
  это соответствует текущему вендорскому контуру, но отличается от tenant.
  Каталожные тесты обязательны.
- **IP allowlist суперадминистратора** (ADR-0006) не реализуется до выбора
  хостинга/статического egress (§14).
- **Passkey-only и аппаратные ключи** не включаются: passkey дополнительный,
  TOTP обязателен. Если продукт захочет passkey-only, понадобится отдельное
  решение о восстановлении.
- **Полный WebAuthn E2E** — в браузере (Playwright), не в unit-тестах.
- **Open sign-up** заблокирован на прокси; тест должен проверять, что
  `/api/vendor-auth/sign-up/*` не проходит. Другие способы создать
  пользователя (passkey-first registration) не настраиваются.
- **Локальная демонстрация**: seed не хранит пароль и TOTP; вход —
  через «забыли пароль» и Mailpit, затем включение TOTP. Это документируется
  в quickstart. Отдельный seed-helper с dev-паролем не делаем, чтобы не
  плодить обходной путь.

## 16. Карта файлов

| Файл                                                       | Изменение                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/db/src/schema/vendor-auth.ts`                    | Новые таблицы `vendor_auth_*`.                                |
| `packages/db/src/schema/vendor.ts`                         | `email_verified`, `image`; `mfaEnabled` → `twoFactorEnabled`. |
| `packages/db/src/schema/index.ts`                          | Экспорт новых таблиц.                                         |
| `packages/db/drizzle/0006_*.sql`                           | Миграция, роль, гранты.                                       |
| `packages/db/src/vendor-auth/users.ts`                     | Создание/обновление/список, активация, аудит.                 |
| `packages/db/src/vendor-auth/audit.ts`                     | Вызов `vendor_audit()`.                                       |
| `packages/db/src/vendor-auth/sessions.ts`                  | Отзыв сессий, сброс MFA.                                      |
| `apps/api/src/cli/provision-vendor-admin.ts`               | Bootstrap первого суперадминистратора.                        |
| `apps/api/src/vendor-auth/config.ts`                       | Инстанс Better Auth.                                          |
| `apps/api/src/vendor-auth/runtime.ts`                      | `resolveVendorIdentity`.                                      |
| `apps/api/src/vendor-auth/guard.ts`                        | Guard-функции.                                                |
| `apps/api/src/routes/vendor-auth.ts`                       | Прокси `/api/vendor-auth/*`.                                  |
| `apps/api/src/routes/vendor.ts`                            | `/v1/vendor/auth/*`, `/v1/vendor/users/*`.                    |
| `apps/api/src/auth/mailer.ts`                              | `sendVendorPasswordReset`.                                    |
| `apps/api/src/auth/email-rate-limit.ts`                    | Опция `table` для вендорской таблицы.                         |
| `apps/api/src/main.ts`                                     | Пулы, роли, конфиг, закрытие.                                 |
| `apps/api/src/server.ts`                                   | Регистрация вендорских маршрутов.                             |
| `apps/api/src/openapi/*`                                   | Схемы и пути.                                                 |
| `packages/config/src/env.ts`                               | Новые env и проверки.                                         |
| `apps/worker/src/jobs/ttl-cleanup.ts`                      | TTL вендорских таблиц.                                        |
| `tools/seed/src/seed.ts`                                   | `twoFactorEnabled: false` у демо-вендора.                     |
| `packages/db/test/*`, `apps/api/src/vendor-auth/*.test.ts` | Тесты.                                                        |
| `docs/adr/0013-vendor-auth-contour.md`                     | ADR.                                                          |
| `docs/03-architecture/api.md`, `data-model.md`             | Маршруты и таблицы.                                           |
| `docs/04-security/threat-model.md`, `authz.md`             | Вендорские угрозы и роли.                                     |
| `docs/00-start/quickstart.md`                              | Локальный вход вендора.                                       |
| `deploy/environments/staging/README.md`                    | Роли и env staging.                                           |
| `.env.example`, `CHANGELOG.md`, `packages/db/README.md`    | Примеры и статус.                                             |
| `.superpowers/sdd/partner-coder-mega-plan/progress.md`     | R-45 и статус.                                                |
