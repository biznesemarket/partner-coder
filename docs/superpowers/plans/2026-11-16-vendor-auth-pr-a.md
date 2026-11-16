# Vendor Auth PR A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать отдельный контур входа вендорской консоли: email + password + обязательный TOTP, отдельные таблицы и роли БД, guard, аудит, rate limit, TTL и bootstrap первого суперадминистратора.

**Architecture:** Второй инстанс Better Auth 1.7.25 работает под ролью `partner_coder_vendor_auth` и маппится на `vendor_users` и таблицы `vendor_auth_*`. Tenant-auth не меняется. Вендорские маршруты `/v1/vendor/*` используют отдельный пул `partner_coder_vendor`; прокси `/api/vendor-auth/*` отдаёт Better Auth. Passkeys и UI — отдельный PR B.

**Tech Stack:** TypeScript strict, pnpm 10.33.2, Node.js ≥ 22.12, Better Auth 1.7.25, Drizzle ORM/Kit, PostgreSQL 17, Fastify 5, Vitest 4.

**Spec:** `docs/03-architecture/vendor-auth.md` (детальный дизайн), `docs/adr/0013-vendor-auth-contour.md` (решение).

## Global Constraints

- Node.js ≥ 22.12, pnpm 10.33.2; версии не поднимать без отдельной задачи.
- Better Auth остаётся 1.7.25; `@better-auth/passkey` и `VENDOR_WEBAUTHN_RP_ID` в PR A **не** добавляются — это PR B.
- Tenant-auth (`/api/auth/*`, `users`, `auth_*`, `resolveIdentity`, tenant-guard) не меняется.
- Секреты, пароли, TOTP-коды, backup-коды и reset-токены не попадают в код, логи, аудит и фикстуры.
- Вендорские таблицы — без RLS; изоляция только грантами и раздельными логинами.
- Миграции генерируются `drizzle-kit`, роль/гранты/функция `vendor_audit()` дописываются в сгенерированный SQL вручную.
- `apps/api/openapi.json` и `apps/api/src/generated/openapi.d.ts` не редактируются вручную.
- Конвенциональные коммиты, ветка + PR, squash-merge; каждый task заканчивается коммитом.
- Все существующие 642 теста остаются зелёными; `pnpm check` обязателен перед PR.

## Review Focus

1. **Suspended/disabled с уже выданной сессией или reset-ссылкой.** Не должен получить новую сессию, доступ к данным или реактивацию; reset-письмо не уходит.
2. **Пользователь без TOTP на вендорских данных.** Любой `/v1/vendor/*`, кроме `/v1/vendor/auth/me` и шагов настройки, должен вернуть 403 `vendor_mfa_required`.
3. **Аудит admin/auth-действий.** Запись должна быть атомарной с изменением, а auth-роль не должна читать журнал; сбой аудита не должен молча терять событие административного действия.
4. **Дубли и bootstrap.** Повторное создание того же email не плодит пользователей; первый суперадминистратор создаётся на чистой staging/prod БД без пароля в миграции.
5. **Reset-токены и несколько инстансов.** Повторное/просроченное использование токена отклоняется; per-email лимит общий для двух API-инстансов.

---

### Task 0: Ветка и базовый прогон

**Files:** нет изменений.

**Interfaces:**

- Consumes: `main` = `c184513`, локальные PostgreSQL/Mailpit/SILO.
- Produces: ветка `feat/m3-vendor-auth`, зелёный baseline.

- [ ] **Step 1: Обновить main и создать ветку**

```bash
git switch main
git pull --ff-only
git switch -c feat/m3-vendor-auth
```

Ожидается: `main` на `c184513`, новая ветка создана.

- [ ] **Step 2: Установить зависимости и прогнать baseline**

```bash
pnpm install --frozen-lockfile
pnpm check
```

Ожидается: `642 passed`, format/lint/typecheck зелёные.

- [ ] **Step 3: Закоммитить утверждённый дизайн и план в ветку**

```bash
git add docs/03-architecture/vendor-auth.md docs/adr/0013-vendor-auth-contour.md \
  docs/adr/README.md docs/index.md docs/superpowers/plans/2026-11-16-vendor-auth-pr-a.md
git commit -m "docs: add vendor auth design and plan"
```

Ожидается: спецификация и план доступны исполнителю в этой же ветке.

---

### Task 1: Env для vendor-auth

**Files:**

- Modify: `packages/config/src/env.ts`
- Test: `packages/config/src/env.test.ts`

**Interfaces:**

- Consumes: `optionalString`, `envSchema.superRefine`.
- Produces: поля `VENDOR_DATABASE_URL`, `VENDOR_AUTH_DATABASE_URL`, `VENDOR_AUTH_SECRET`, `VENDOR_SESSION_TTL_HOURS`, `VENDOR_PASSWORD_RESET_TTL_MINUTES`, `VENDOR_PASSWORD_MIN_LENGTH`; тип `Env` с этими полями.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `env.test.ts`:

```ts
it("применяет дефолты vendor-auth", () => {
  const env = parseEnv(validEnv);
  expect(env.VENDOR_SESSION_TTL_HOURS).toBe(8);
  expect(env.VENDOR_PASSWORD_RESET_TTL_MINUTES).toBe(30);
  expect(env.VENDOR_PASSWORD_MIN_LENGTH).toBe(12);
  expect(env.VENDOR_AUTH_SECRET).toBeUndefined();
});

it("вне local требует vendor URL и секрет", () => {
  expect(() =>
    parseEnv({
      ...validEnv,
      APP_ENV: "staging",
      AUTH_DATABASE_URL: "postgres://auth@localhost/partner_coder",
    }),
  ).toThrow(/VENDOR_DATABASE_URL/);
});

it("запрещает VENDOR_AUTH_SECRET === AUTH_SECRET вне local", () => {
  expect(() =>
    parseEnv({
      ...validEnv,
      APP_ENV: "staging",
      AUTH_DATABASE_URL: "postgres://auth@localhost/partner_coder",
      VENDOR_DATABASE_URL: "postgres://vendor@localhost/partner_coder",
      VENDOR_AUTH_DATABASE_URL: "postgres://vendor_auth@localhost/partner_coder",
      VENDOR_AUTH_SECRET: validEnv.AUTH_SECRET,
    }),
  ).toThrow(/VENDOR_AUTH_SECRET/);
});

it("ограничивает длину пароля и TTL", () => {
  expect(() => parseEnv({ ...validEnv, VENDOR_PASSWORD_MIN_LENGTH: "8" })).toThrow(
    /VENDOR_PASSWORD_MIN_LENGTH/,
  );
  expect(() => parseEnv({ ...validEnv, VENDOR_SESSION_TTL_HOURS: "25" })).toThrow(
    /VENDOR_SESSION_TTL_HOURS/,
  );
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run packages/config/src/env.test.ts`
Expected: FAIL — поля отсутствуют / нет проверок.

- [ ] **Step 3: Реализовать поля и superRefine**

В `envSchema` добавить:

```ts
VENDOR_DATABASE_URL: optionalString,
VENDOR_AUTH_DATABASE_URL: optionalString,
VENDOR_AUTH_SECRET: optionalString.pipe(z.string().min(32).optional()),
VENDOR_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
VENDOR_PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
VENDOR_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(12).max(64).default(12),
```

В `superRefine` при `APP_ENV !== "local"` добавить три ошибки: отсутствие
`VENDOR_DATABASE_URL`, `VENDOR_AUTH_DATABASE_URL`, `VENDOR_AUTH_SECRET`;
если `VENDOR_AUTH_SECRET` задан и равен `AUTH_SECRET` — отдельная ошибка.
Локально отсутствие `VENDOR_AUTH_SECRET` допустимо (fallback в `main.ts`).

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run packages/config/src/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add packages/config/src/env.ts packages/config/src/env.test.ts
git commit -m "feat(config): add vendor auth environment"
```

---

### Task 2: Схема vendor-auth и переименование MFA-поля

**Files:**

- Create: `packages/db/src/schema/vendor-auth.ts`
- Create (generated): `packages/db/drizzle/0006_*.sql`, `packages/db/drizzle/meta/*`
- Modify: `packages/db/src/schema/vendor.ts:49-66` (колонки `email_verified`, `image`; `mfaEnabled` → `twoFactorEnabled`)
- Modify: `packages/db/src/schema/index.ts`
- Modify: `tools/seed/src/seed.ts:123-133`
- Modify: `packages/db/test/fixtures.ts` (все `mfaEnabled`)
- Test: `packages/db/test/vendor-auth-schema.test.ts`, `packages/db/test/schema.test.ts`, `tools/seed/test/seed.test.ts`

**Interfaces:**

- Consumes: `uuidPk`, `createdAt`, `updatedAt`, `inetAddress`, `bigint`, `text`, `boolean`, `integer`, `timestamp`, `uuid`, `pgTable`, `uniqueIndex`, `index`, `check`.
- Produces: Drizzle-таблицы `vendorAuthAccounts`, `vendorAuthSessions`, `vendorAuthVerifications`, `vendorAuthTwoFactors`, `vendorAuthPasskeys`, `vendorAuthRateLimits`, `vendorAuthEmailLimits`; `vendorUsers.twoFactorEnabled`.

- [ ] **Step 1: Написать падающие тесты схемы**

В `vendor-auth-schema.test.ts`:

```ts
it("создаёт таблицы vendor_auth_*", async () => {
  const names = await tableNames(testDb.pool);
  expect(names).toEqual(
    expect.arrayContaining([
      "vendor_auth_accounts",
      "vendor_auth_sessions",
      "vendor_auth_verifications",
      "vendor_auth_two_factors",
      "vendor_auth_passkeys",
      "vendor_auth_rate_limits",
      "vendor_auth_email_limits",
    ]),
  );
});

it("расширяет vendor_users под Better Auth", async () => {
  const columns = await columnNames(testDb.pool, "vendor_users");
  expect(columns).toEqual(expect.arrayContaining(["email_verified", "image", "mfa_enabled"]));
  expect(columns).not.toContain("two_factor_enabled");
  expect(vendorUsers.twoFactorEnabled).toBeDefined();
});

it("держит FK и уникальность вендорских auth-таблиц", async () => {
  expect(await foreignKeys(testDb.pool, "vendor_auth_passkeys")).toContainEqual(
    expect.objectContaining({ column: "user_id", table: "vendor_users" }),
  );
  expect(await uniqueIndexes(testDb.pool, "vendor_auth_passkeys")).toContain("credential_id");
  expect(await uniqueIndexes(testDb.pool, "vendor_auth_sessions")).toContain("token");
});
```

Использовать существующие SQL-хелперы из `packages/db/test/helpers.ts` или добавить
локальные `tableNames`/`columnNames`/`foreignKeys`/`uniqueIndexes` через
`information_schema` и `pg_indexes`.

В `schema.test.ts` добавить семь имён в ожидаемый список таблиц.
В `seed.test.ts` проверить, что демо-вендор имеет `twoFactorEnabled === false`.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run packages/db/test/vendor-auth-schema.test.ts packages/db/test/schema.test.ts tools/seed/test/seed.test.ts`
Expected: FAIL — таблиц и поля нет.

- [ ] **Step 3: Реализовать схему**

Создать `vendor-auth.ts` по таблицам из §4.2 дизайна. Обязательные детали:

- `vendorAuthSessions.ipAddress = inetAddress("ip_address")`;
- `vendorAuthSessions.stepUpUntil = timestamp("step_up_until", { withTimezone: true, precision: 3 })`;
- `vendorAuthTwoFactors.failedVerificationCount` и `lockedUntil`;
- `vendorAuthPasskeys.credentialID = text("credential_id")`;
- `vendorAuthRateLimits.lastRequest = bigint("last_request", { mode: "number" })`;
- FK `user_id` → `vendorUsers.id`, `onDelete: "restrict"`;
- checks: `counter >= 0`, `failed_verification_count >= 0`, `count >= 0`.

В `vendor.ts` добавить `emailVerified: boolean("email_verified").notNull().default(false)`,
`image: text("image")`, переименовать свойство `mfaEnabled` в `twoFactorEnabled`
(колонка остаётся `mfa_enabled`). Обновить seed/фикстуры/все ссылки.
В `schema/index.ts` добавить `export * from "./vendor-auth.js";`.

Сгенерировать миграцию `0006`:

```bash
pnpm --filter @partner-coder/db db:generate
```

Ожидается: `packages/db/drizzle/0006_*.sql` создаёт таблицы и колонки
`vendor_users`; роль/гранты/функция добавляются в Task 3.

- [ ] **Step 4: Прогнать тесты и drift-check**

Run: `pnpm vitest run packages/db/test/vendor-auth-schema.test.ts packages/db/test/schema.test.ts tools/seed/test/seed.test.ts`
Expected: PASS.
Run: `pnpm db:check`
Expected: drift не найден.

- [ ] **Step 5: Коммит**

```bash
git add packages/db/src/schema packages/db/test tools/seed
git commit -m "feat(db): add vendor auth schema"
```

---

### Task 3: Миграция 0006, роли, гранты и vendor_audit()

**Files:**

- Modify: `packages/db/drizzle/0006_*.sql` (сгенерирован в Task 2)
- Test: `packages/db/test/vendor-auth-roles.test.ts`

**Interfaces:**

- Consumes: таблицы и миграция Task 2, `createTestDatabase`, `asRole`, `VENDOR_ROLE`.
- Produces: роль `partner_coder_vendor_auth`, гранты, `vendor_audit(...)`.

- [ ] **Step 1: Проверить сгенерированную миграцию**

Открыть `packages/db/drizzle/0006_*.sql`, убедиться, что она создаёт семь
таблиц `vendor_auth_*`, добавляет `vendor_users.email_verified`/`image`.
Новые schema-изменения здесь не генерировать.

- [ ] **Step 2: Дописать роль, гранты и функцию**

В конец сгенерированного SQL добавить (через `--> statement-breakpoint`):

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_coder_vendor_auth') THEN
    CREATE ROLE partner_coder_vendor_auth NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO partner_coder_vendor_auth;
GRANT SELECT, INSERT, UPDATE ON TABLE vendor_users TO partner_coder_vendor_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  vendor_auth_accounts, vendor_auth_sessions, vendor_auth_verifications,
  vendor_auth_two_factors, vendor_auth_passkeys, vendor_auth_rate_limits,
  vendor_auth_email_limits
TO partner_coder_vendor_auth;
GRANT SELECT, DELETE ON TABLE
  vendor_auth_sessions, vendor_auth_verifications,
  vendor_auth_rate_limits, vendor_auth_email_limits
TO partner_coder_worker;

CREATE OR REPLACE FUNCTION vendor_audit(
  p_actor_id uuid, p_customer_id uuid, p_action text, p_entity text,
  p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL, p_ip inet DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO vendor_audit_events (actor_id, customer_id, action, entity, before, after, ip)
  VALUES (p_actor_id, p_customer_id, p_action, p_entity, p_before, p_after, p_ip)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE EXECUTE ON FUNCTION vendor_audit(uuid, uuid, text, text, jsonb, jsonb, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_audit(uuid, uuid, text, text, jsonb, jsonb, inet)
  TO partner_coder_vendor, partner_coder_vendor_auth;
ALTER FUNCTION vendor_audit(uuid, uuid, text, text, jsonb, jsonb, inet)
  OWNER TO partner_coder_worker;
```

Порядок `GRANT`/`ALTER OWNER` должен сохранить владельца worker; гранты
выполняются после создания функции.

- [ ] **Step 3: Написать каталожные тесты**

`vendor-auth-roles.test.ts` (новый `createTestDatabase` + `seedVendorBase`):

- `asRole(pool, "partner_coder_vendor_auth", ...)` читает `vendor_users`,
  вставляет `vendor_auth_rate_limits`, вызывает `vendor_audit(...)`;
- `asRole(..., "partner_coder_vendor_auth", ...)` получает `42501` на
  `select from customers`, `select from users`, `select from vendor_audit_events`;
- `asRole(pool, "partner_coder_vendor", ...)` получает `42501` на
  `select from vendor_auth_accounts`;
- `asRole(pool, "partner_coder_api", ...)` получает `42501` на
  `select from vendor_users` и `vendor_auth_sessions`;
- `select verify_vendor_audit_chain()` возвращает `true` после `vendor_audit`;
- worker может `delete from vendor_auth_sessions`.

- [ ] **Step 4: Прогнать тесты и drift-check**

Run: `pnpm vitest run packages/db/test/vendor-auth-roles.test.ts`
Expected: PASS.
Run: `pnpm db:check`
Expected: drift не найден.

- [ ] **Step 5: Коммит**

```bash
git add packages/db/drizzle packages/db/test/vendor-auth-roles.test.ts
git commit -m "feat(db): add vendor auth migration and roles"
```

---

### Task 4: DB-сервисы вендорских пользователей, аудита и сессий

**Files:**

- Create: `packages/db/src/vendor-auth/types.ts`, `audit.ts`, `users.ts`, `sessions.ts`, `index.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/vendor-auth-service.test.ts`

**Interfaces:**

- Consumes: `Database`, `DbTransaction`, таблицы Task 2, `vendor_audit()` Task 3.
- Produces:
  - `VendorRole`, `VendorUserStatus`, `VendorUser`;
  - `writeVendorAudit(db, event): Promise<string>`;
  - `getVendorUserByEmail`, `getVendorUserById`, `listVendorUsers`, `updateVendorUser`, `markVendorLogin`, `activateAfterPasswordReset`;
  - `revokeVendorSessions`, `resetVendorMfa`.

- [ ] **Step 1: Написать падающие сервисные тесты**

`vendor-auth-service.test.ts`:

```ts
it("пишет событие в vendor_audit_events и цепочка валидна", async () => {
  const id = await writeVendorAudit(db, {
    actorId: vendor.vendorUserId,
    action: "vendor.test.event",
    entity: "vendor_user",
    after: { ok: true },
  });
  expect(id).toMatch(uuidRe);
  expect(await verifyVendorChain(pool)).toBe(true);
});

it("markVendorLogin переводит invited в active, но не реактивирует suspended", async () => {
  await markVendorLogin(db, vendor.vendorUserId);
  expect((await getVendorUserById(db, vendor.vendorUserId))?.status).toBe("active");
  await updateVendorUser(db, vendor.vendorUserId, { status: "suspended" });
  await markVendorLogin(db, vendor.vendorUserId);
  expect((await getVendorUserById(db, vendor.vendorUserId))?.status).toBe("suspended");
});

it("activateAfterPasswordReset не реактивирует suspended", async () => {
  await updateVendorUser(db, vendor.vendorUserId, { status: "suspended" });
  const user = await activateAfterPasswordReset(db, vendor.vendorUserId);
  expect(user.status).toBe("suspended");
  expect(user.emailVerified).toBe(true);
});

it("resetVendorMfa удаляет TOTP, passkeys и сессии и пишет аудит", async () => {
  // insert two_factor, passkey, session
  const result = await resetVendorMfa(db, vendor.vendorUserId, {
    actorId: vendor.vendorUserId,
    ip: "127.0.0.1",
  });
  expect(result).toEqual({ twoFactors: 1, passkeys: 1, sessions: 1 });
  expect((await getVendorUserById(db, vendor.vendorUserId))?.twoFactorEnabled).toBe(false);
});

it("getVendorUserByEmail ищет без учёта регистра", async () => {
  expect(await getVendorUserByEmail(db, "VENDOR@DEMO.PARTNERCODER.LOCAL")).not.toBeNull();
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run packages/db/test/vendor-auth-service.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Реализовать сервисы**

- `types.ts`: `VendorRole`/`VendorUserStatus` из `vendorRole.enumValues` /
  `vendorUserStatus.enumValues`; `VendorUser` — select-тип `vendorUsers`.
- `audit.ts`: `writeVendorAudit` вызывает
  `select vendor_audit(${actorId}, ${customerId}, ${action}, ${entity}, ${before}::jsonb, ${after}::jsonb, ${ip})`;
  `undefined` → `null`; возвращает `id`.
- `users.ts`: SQL через Drizzle `db.select/update` или `db.execute`;
  `markVendorLogin` обновляет `last_login_at` и `status` только для
  `invited`/`active`; `activateAfterPasswordReset` ставит
  `email_verified=true` и `status='active'` только из `invited`;
  `updateVendorUser` — только `role`/`status`.
- `sessions.ts`: `revokeVendorSessions` — `delete from vendor_auth_sessions where user_id=...`;
  `resetVendorMfa` — одна транзакция: удалить TOTP/passkeys/сессии,
  `two_factor_enabled=false`, `writeVendorAudit`.
- `index.ts` экспортирует всё; `packages/db/src/index.ts` добавляет
  `export * from "./vendor-auth/index.js";`.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run packages/db/test/vendor-auth-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add packages/db/src/vendor-auth packages/db/src/index.ts packages/db/test/vendor-auth-service.test.ts
git commit -m "feat(db): add vendor auth services"
```

---

### Task 5: Письмо сброса пароля и per-email store для вендора

**Files:**

- Modify: `apps/api/src/auth/mailer.ts`
- Modify: `apps/api/src/auth/email-rate-limit.ts`
- Test: `apps/api/src/auth/mailer.test.ts`, `apps/api/src/auth/email-rate-limit.test.ts`

**Interfaces:**

- Consumes: `AuthMailer`, `DatabaseEmailRateLimiter`, `createTestDatabase`.
- Produces: `AuthMailer.sendVendorPasswordReset({ email, url })`; опция
  `DatabaseEmailRateLimiterOptions.table?: "email_rate_limits" | "vendor_auth_email_limits"`.

- [ ] **Step 1: Написать падающие тесты**

В `mailer.test.ts`:

```ts
it("MemoryMailer запоминает письмо сброса пароля вендора", async () => {
  const mailer = new MemoryMailer();
  await mailer.sendVendorPasswordReset({
    email: "ops@example.com",
    url: "https://x/reset?token=t",
  });
  expect(mailer.vendorPasswordResets).toEqual([
    { email: "ops@example.com", url: "https://x/reset?token=t" },
  ]);
});
```

В `email-rate-limit.test.ts`:

```ts
it("DatabaseEmailRateLimiter пишет в vendor_auth_email_limits", async () => {
  const limiter = new DatabaseEmailRateLimiter(db, {
    table: "vendor_auth_email_limits",
    limit: 1,
    windowMs: 60_000,
  });
  expect(await limiter.consume("ops@example.com")).toBe(true);
  expect(await limiter.consume("ops@example.com")).toBe(false);
  const rows = await pool.query("select key, count from vendor_auth_email_limits");
  expect(rows.rows).toEqual([{ key: "ops@example.com", count: 2 }]);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/auth/mailer.test.ts apps/api/src/auth/email-rate-limit.test.ts`
Expected: FAIL — метода/опции нет.

- [ ] **Step 3: Реализовать**

- `AuthMailer` добавить `sendVendorPasswordReset(mail: { email: string; url: string }): Promise<void>`.
- `MemoryMailer` — массив `vendorPasswordResets`.
- `SmtpMailer` — письмо «Доступ к консоли вендора», тело с URL, TTL 30 минут,
  без токена в логах.
- `DatabaseEmailRateLimiterOptions` — `table?: "email_rate_limits" | "vendor_auth_email_limits"`;
  в SQL использовать `sql.raw(this.table)`; значение по умолчанию `email_rate_limits`.
  Таблица — только из union, не из пользовательского ввода.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/auth/mailer.test.ts apps/api/src/auth/email-rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/auth/mailer.ts apps/api/src/auth/email-rate-limit.ts apps/api/src/auth/*.test.ts
git commit -m "feat(api): add vendor reset mail and limiter table"
```

---

### Task 6: Vendor Auth — password, reset и активация

**Files:**

- Create: `apps/api/src/vendor-auth/config.ts`
- Test: `apps/api/src/vendor-auth/better-auth.test.ts`

**Interfaces:**

- Consumes: `createTestDatabase`, `MemoryMailer`, DB-сервисы Task 4, `vendorUsers`, `vendorAuth*`.
- Produces: `createVendorAuth(options): VendorAuth`; `VendorAuth = ReturnType<typeof createVendorAuth>`; `CreateVendorAuthOptions`.

- [ ] **Step 1: Написать падающие тесты password/reset**

`better-auth.test.ts`:

```ts
it("создаёт vendor_users и credential-account без открытого пароля", async () => {
  const auth = createVendorAuth({ ...baseOptions });
  const result = await auth.api.signUpEmail({
    body: { email: "ops@example.com", name: "Ops", password: "correct horse battery staple" },
  });
  expect(result.user.email).toBe("ops@example.com");
  const user = await pool.query(
    "select role, status, mfa_enabled from vendor_users where email=$1",
    ["ops@example.com"],
  );
  expect(user.rows[0]).toEqual({ role: "support", status: "invited", mfa_enabled: false });
  const account = await pool.query("select password from vendor_auth_accounts where user_id=$1", [
    result.user.id,
  ]);
  expect(account.rows[0].password).not.toBe("correct horse battery staple");
  expect(account.rows[0].password.length).toBeGreaterThan(20);
});

it("reset-password активирует invited, отзывает сессии и пишет аудит", async () => {
  // signUp + signIn (session), requestPasswordReset
  expect(mailer.vendorPasswordResets).toHaveLength(1);
  const token = new URL(mailer.vendorPasswordResets[0]!.url).searchParams.get("token")!;
  await auth.api.resetPassword({ body: { token, newPassword: "new correct horse battery" } });
  const user = await getVendorUserById(db, userId);
  expect(user).toMatchObject({ status: "active", emailVerified: true });
  expect(await countSessions(pool, userId)).toBe(0);
  expect(await hasAudit(pool, "vendor.auth.password_reset_completed")).toBe(true);
});

it("reset-токен одноразовый и истекает", async () => {
  // reuse -> error; update auth_verifications expires_at to past -> error
});

it("не отправляет reset suspended/disabled и не реактивирует", async () => {
  await updateVendorUser(db, userId, { status: "suspended" });
  mailer.vendorPasswordResets.length = 0;
  await auth.api.requestPasswordReset({
    body: { email: "ops@example.com", redirectTo: "http://localhost:3001/reset-password" },
  });
  expect(mailer.vendorPasswordResets).toHaveLength(0);
  expect((await getVendorUserById(db, userId))?.status).toBe("suspended");
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/vendor-auth/better-auth.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать config без TOTP-плагина**

`createVendorAuth`:

- `betterAuth` с `basePath: "/api/vendor-auth"`, `secret`, `trustedOrigins: [vendorBaseURL, baseURL]`;
- `drizzleAdapter` schema: `user: vendorUsers`, `session: vendorAuthSessions`,
  `account: vendorAuthAccounts`, `verification: vendorAuthVerifications`,
  `rateLimit: vendorAuthRateLimits` (только при `rateLimitStorage === "database"`);
- `advanced.database.generateId = () => randomUUID()`,
  `advanced.cookiePrefix = "pc-vendor"`, IP-настройки как в tenant-auth;
- `user.additionalFields`: `role`, `status` (`input: false`);
- `session.expiresIn`, `updateAge: 900`, `stepUpUntil` (`type: "date"`, `input: false`);
- `emailAndPassword`: `enabled: true`, `disableSignUp: false`, `autoSignIn: false`,
  `minPasswordLength`, `maxPasswordLength: 128`, `requireEmailVerification: false`,
  `resetPasswordTokenExpiresIn`, `revokeSessionsOnPasswordReset: true`,
  `sendResetPassword` → `mailer.sendVendorPasswordReset`,
  `onPasswordReset` → `onPasswordReset(user.id)`;
- `rateLimit`: `enabled`, `window`, `max`, database storage при необходимости.

В `sendResetPassword` проверять статус через `getVendorStatus(user.id)`:
для `suspended`/`disabled` не отправлять письмо (return без ошибки).
`onPasswordReset` в тесте — обёртка над `activateAfterPasswordReset` + аудит.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/vendor-auth/better-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/vendor-auth/config.ts apps/api/src/vendor-auth/better-auth.test.ts
git commit -m "feat(api): add vendor password reset auth"
```

---

### Task 7: Vendor Auth — TOTP и блокировка suspended

**Files:**

- Modify: `apps/api/src/vendor-auth/config.ts`
- Modify: `apps/api/src/vendor-auth/better-auth.test.ts`

**Interfaces:**

- Consumes: Task 6.
- Produces: плагин `twoFactor`, `databaseHooks.session.create.before/after`,
  `hooks.before` для `/sign-in/email`; `two_factor_enabled` invariant.

- [ ] **Step 1: Написать падающие тесты TOTP**

```ts
it("включает TOTP, шифрует секрет и требует второй фактор при входе", async () => {
  // signIn password -> session; enableTwoFactor({ password }) -> totpURI, backupCodes
  // select secret, backup_codes from vendor_auth_two_factors
  expect(secret).not.toBe(plainSecretFromUri);
  expect(secret).not.toMatch(/^[A-Z2-7]+=*$/);
  expect(backupCodesStored).not.toBe(backupCodes.join(","));
  // verifyTOTP(code) -> user.twoFactorEnabled true
  // signIn password -> twoFactorRedirect true, no session
  // verifyTOTP(code, twoFactorCookie) -> session
});

it("неверный TOTP увеличивает счетчик и блокирует после лимита", async () => {
  // wrong code 5 times -> ACCOUNT_TEMPORARILY_LOCKED
  // failed_verification_count/locked_until in DB
});

it("backup-код принимается и не повторяется", async () => {
  // verifyBackupCode(codes[0]) -> session; repeat -> error
});

it("suspended не создаёт сессию и не проходит passkey/session hook", async () => {
  await updateVendorUser(db, userId, { status: "suspended" });
  expect(() => signInEmail(...)).rejects.toMatchObject({ status: 403 });
  // session.create.before returns false
});
```

Для TOTP-кода добавить локальный helper `totpCode(secret, now)`:
HMAC-SHA1, 6 цифр, 30 секунд (RFC 6238); secret извлечь из `totpURI`
(`secret` query) и декодировать base32. Временную 2FA-cookie для
`verifyTOTP` брать из `set-cookie` ответа `auth.handler` на
`/sign-in/email` (как в HTTP-потоке), а не из публичного API-метода.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/vendor-auth/better-auth.test.ts`
Expected: FAIL — TOTP не включён.

- [ ] **Step 3: Реализовать плагин и хуки**

- `plugins: [twoFactor({ issuer: "Партнер кодер (вендор)", backupCodeOptions: { amount: 10, storeBackupCodes: "encrypted" } })]`.
- `databaseHooks.session.create.before` — `getVendorStatus(session.userId)`;
  `suspended`/`disabled` → `false`.
- `databaseHooks.session.create.after` — `onSessionCreated(session.userId)`
  (best-effort, не бросать).
- `hooks.before` для `ctx.path === "/sign-in/email"` — статус по email;
  `suspended`/`disabled` → `throw new APIError("FORBIDDEN", { message, code: "VENDOR_INACTIVE" })`
  (`APIError` из `better-auth/api`).

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/vendor-auth/better-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/vendor-auth
git commit -m "feat(api): enforce vendor TOTP and suspension"
```

---

### Task 8: Vendor identity и guard

**Files:**

- Create: `apps/api/src/vendor-auth/runtime.ts`, `apps/api/src/vendor-auth/guard.ts`
- Test: `apps/api/src/vendor-auth/runtime.test.ts`, `apps/api/src/vendor-auth/guard.test.ts`

**Interfaces:**

- Consumes: `VendorAuth` (Task 6/7), DB-сервисы Task 4.
- Produces:
  - `VendorIdentity { userId, email, name, role, status, twoFactorEnabled, sessionId, sessionExpiresAt, stepUpUntil }`;
  - `resolveVendorIdentity(runtime, headers): Promise<VendorIdentity | null>`;
  - `createVendorGuards(runtime): { authenticateVendor, requireVendorMfa, requireVendorRole, requireVendorStepUp }`;
  - `VendorAuthRuntime` с `auth`, `db`, `authDb`, `vendorBaseUrl`, `stepUpMinutes`.

- [ ] **Step 1: Написать падающие тесты**

`runtime.test.ts` (fake auth с `api.getSession`):

```ts
it("возвращает identity с ролью, статусом и mfa-флагом", async () => {
  const identity = await resolveVendorIdentity(fakeRuntime, headers);
  expect(identity).toMatchObject({ role: "superadmin", twoFactorEnabled: true, status: "active" });
});

it("suspended/disabled возвращает inactive-identity", async () => {
  const identity = await resolveVendorIdentity(fakeSuspendedRuntime, headers);
  expect(identity).toMatchObject({ status: "suspended" });
});
```

`guard.test.ts`:

```ts
it("без сессии — 401 vendor_unauthenticated", async () => { ... });
it("suspended — 403 vendor_inactive", async () => { ... });
it("без TOTP — 403 vendor_mfa_required", async () => { ... });
it("чужая роль — 403 vendor_role_denied и аудит", async () => { ... });
it("step-up истек — 403 vendor_step_up_required", async () => { ... });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/vendor-auth/runtime.test.ts apps/api/src/vendor-auth/guard.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Реализовать runtime и guard**

`resolveVendorIdentity`:

- `auth.api.getSession({ headers: fromNodeHeaders(headers) })`;
- нет сессии → `null`;
- статус `suspended`/`disabled` → identity с этим статусом (guard вернёт 403);
- `stepUpUntil` из session additional field (Date | null);
- `mfaEnrollmentRequired = !twoFactorEnabled`.

Guard:

- `authenticateVendor` — identity есть и статус `invited`/`active`, иначе
  401/403; при inactive — best-effort `revokeVendorSessions` и 403
  `vendor_inactive`;
- `requireVendorMfa` — `twoFactorEnabled === true`;
- `requireVendorRole(roles)` — `roles.includes(identity.role)`, иначе 403 +
  `writeVendorAudit` (actor identity.userId);
- `requireVendorStepUp` — `stepUpUntil > now()`, иначе 403.

Fastify augmentation: `request.vendorAuth?: VendorIdentity` в
`apps/api/src/vendor-auth/guard.ts`.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/vendor-auth/runtime.test.ts apps/api/src/vendor-auth/guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/vendor-auth
git commit -m "feat(api): add vendor identity and guards"
```

---

### Task 9: Прокси /api/vendor-auth/*

**Files:**

- Create: `apps/api/src/routes/vendor-auth.ts`
- Modify: `apps/api/src/server.ts` (BuildServerOptions + registration)
- Test: `apps/api/src/vendor-auth/proxy.test.ts`

**Interfaces:**

- Consumes: `VendorAuthRuntime`, `EmailRateLimitStore`.
- Produces: `registerVendorAuthRoutes(server, runtime, options)`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("блокирует открытую регистрацию и отключение TOTP", async () => {
  expect(
    (await app.inject({ method: "POST", url: "/api/vendor-auth/sign-up/email" })).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ method: "POST", url: "/api/vendor-auth/two-factor/disable" })).statusCode,
  ).toBe(403);
});

it("пробрасывает разрешенный sign-in и set-cookie", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/vendor-auth/sign-in/email",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["set-cookie"]).toBeDefined();
});

it("применяет per-email лимит 5/60", async () => {
  // 6-й запрос -> 429 email_rate_limited
});

it("не пропускает чужой Origin на мутациях", async () => {
  // Origin: https://evil.example -> 403
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/vendor-auth/proxy.test.ts`
Expected: FAIL — маршрута нет.

- [ ] **Step 3: Реализовать прокси**

Копировать паттерн `registerAuthRoutes`:

- `/api/vendor-auth/*`, GET/POST;
- deny-list: `/sign-up`, `/sign-up/email`, `/two-factor/disable`,
  `/two-factor/send-otp`, `/two-factor/verify-otp`, `/admin/*`,
  `/delete-user`, `/change-email`, `/link-social`, `/unlink-account`,
  `/sign-in/social`, `/callback/*`;
- per-email limiter для `/sign-in/email` и `/request-password-reset`;
- Origin-проверка для небезопасных методов: `vendorBaseUrl`/`apiBaseUrl`;
- `runtime.auth.handler(fetchRequest)`, проброс `set-cookie`, body;
- `BuildServerOptions.vendorRuntime` + `vendorEmailRateLimitStore`;
- `server.ts` регистрирует прокси/маршруты при наличии runtime.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/vendor-auth/proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/routes/vendor-auth.ts apps/api/src/server.ts apps/api/src/vendor-auth/proxy.test.ts
git commit -m "feat(api): add vendor auth proxy"
```

---

### Task 10: Маршруты /v1/vendor/auth/* и /v1/vendor/users/*

**Files:**

- Create: `apps/api/src/routes/vendor.ts`
- Modify: `apps/api/src/openapi/schemas.ts`, `apps/api/src/openapi/index.ts`
- Test: `apps/api/src/vendor-auth/routes.test.ts`

**Interfaces:**

- Consumes: guard/runtime Task 8, DB-сервисы Task 4, `vendorAuth.api` Task 6/7.
- Produces: `/v1/vendor/auth/me`, `/v1/vendor/auth/step-up`,
  `/v1/vendor/users` (GET/POST), `/v1/vendor/users/:id` (PATCH),
  `/v1/vendor/users/:id/reset-password`, `/v1/vendor/users/:id/reset-mfa`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("GET /v1/vendor/auth/me возвращает mfaEnrollmentRequired", async () => {
  // user without TOTP -> 200 { user, mfaEnrollmentRequired: true }
});

it("закрывает vendor data routes без TOTP", async () => {
  // GET /v1/vendor/users -> 403 vendor_mfa_required
});

it("создаёт пользователя, отправляет ссылку и идемпотентен для invited", async () => {
  // POST /v1/vendor/users -> 201, Mailpit/MemoryMailer, audit vendor.user.invited
  // repeat -> 200, no duplicate, second mail
});

it("не даёт создать второго superadmin без confirmSuperadmin", async () => {
  // role superadmin without flag -> 400
});

it("PATCH suspended отзывает сессии и не даёт менять себя", async () => {
  // self -> 409 vendor_self_change_denied
  // other -> 200, sessions deleted, audit
});

it("reset-mfa удаляет TOTP/passkeys и аудирует", async () => { ... });

it("step-up проверяет пароль и выставляет stepUpUntil", async () => { ... });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/vendor-auth/routes.test.ts`
Expected: FAIL — маршрутов нет.

- [ ] **Step 3: Реализовать маршруты и OpenAPI-схемы**

- `/me` — `authenticateVendor` без MFA; возвращает identity + флаг.
- `/step-up` — `authenticateVendor` + `requireVendorMfa`; `verifyPassword`
  с заголовками сессии; при успехе `update vendor_auth_sessions set step_up_until=now()+interval '5 minutes'`;
  лимит 5/5 мин через `vendor_auth_email_limits` (ключ `stepup:<userId>`);
  аудит success/failed.
- `/users` — `authenticateVendor` + `requireVendorMfa` + `requireVendorRole(["superadmin"])`.
  Создание: нормализовать email, проверить существующего.
  - `invited` — не вызывать `signUpEmail`, только `requestPasswordReset`
    и вернуть 200;
  - `active` — 409 `vendor_user_exists`; `suspended`/`disabled` — 409
    `vendor_user_inactive`;
  - нового — `signUpEmail` с `randomBytes(32).toString("base64url")`,
    `updateVendorUser`, `requestPasswordReset`;
  - `confirmSuperadmin` обязателен для роли superadmin.
    Список — `listVendorUsers`.
- `PATCH` — нельзя менять себя; update + аудит в одной транзакции; при
  `suspended`/`disabled` — `revokeVendorSessions` + аудит; role change
  аудируется.
- `reset-password` — только superadmin; suspended/disabled → 409
  `vendor_user_inactive`; иначе `requestPasswordReset`.
- `reset-mfa` — только superadmin; `resetVendorMfa` с actor/IP; аудит.
- Zod-схемы и paths в OpenAPI; ошибки через `ApiError`.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/vendor-auth/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/routes/vendor.ts apps/api/src/openapi apps/api/src/vendor-auth/routes.test.ts
git commit -m "feat(api): add vendor auth and user routes"
```

---

### Task 11: Композиция, роли БД и регистрация в server

**Files:**

- Modify: `apps/api/src/main.ts`, `apps/api/src/server.ts`, `apps/api/src/auth/db-roles.ts`
- Test: `apps/api/src/auth/db-roles.test.ts`, `apps/api/src/vendor-auth/server.test.ts`

**Interfaces:**

- Consumes: all previous tasks.
- Produces: `DbRoleScope = "api" | "auth" | "vendor" | "vendor_auth"`; vendor pools in `main.ts`; `buildServer` registers vendor routes.

- [ ] **Step 1: Написать падающие тесты**

`db-roles.test.ts`:

```ts
it("vendor-логин не должен быть в api/auth/worker/vendor_auth", () => {
  expect(
    roleSeparationErrors("vendor", facts({ vendorMember: true, apiMember: true })),
  ).toHaveLength(1);
});
it("vendor_auth-логин не должен быть в api/auth/worker/vendor", () => {
  expect(
    roleSeparationErrors("vendor_auth", facts({ vendorAuthMember: true, workerMember: true })),
  ).toHaveLength(1);
});
```

`server.test.ts`: при `vendorRuntime` `/v1/vendor/auth/me` → 401, без runtime → 404.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/auth/db-roles.test.ts apps/api/src/vendor-auth/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

- `db-roles.ts`: `vendorAuthMember`, SQL `pg_has_role(..., 'partner_coder_vendor_auth', 'member')`,
  ветки для `vendor`/`vendor_auth`, запрет пересечений.
- `main.ts`: `vendorPool`/`vendorAuthPool` (fallback `DATABASE_URL` локально),
  `vendorDb`/`vendorAuthDb`, role checks вне local, `createVendorAuth` с
  колбэками `onSessionCreated → markVendorLogin(vendorDb, id)`,
  `onPasswordReset → activateAfterPasswordReset(vendorDb, id) + аудит`,
  `getVendorStatus → getVendorUserById(vendorAuthDb, id)?.status`,
  `DatabaseEmailRateLimiter` с `vendor_auth_email_limits`, `VendorAuthRuntime`,
  `buildServer({ vendorRuntime })`, закрытие пулов.
- `server.ts`: `BuildServerOptions.vendorRuntime`, `vendorEmailRateLimitStore`;
  `registerVendorAuthRoutes` + `registerVendorRoutes` при наличии runtime.

- [ ] **Step 4: Прогнать тесты и typecheck**

Run: `pnpm vitest run apps/api/src/auth/db-roles.test.ts apps/api/src/vendor-auth/server.test.ts`
Expected: PASS.
Run: `pnpm --filter @partner-coder/api typecheck`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/main.ts apps/api/src/server.ts apps/api/src/auth/db-roles.ts apps/api/src/**/*.test.ts
git commit -m "feat(api): wire vendor auth into server"
```

---

### Task 12: TTL-очистка вендорских auth-таблиц

**Files:**

- Modify: `apps/worker/src/jobs/ttl-cleanup.ts`
- Test: `apps/worker/src/jobs/ttl-cleanup.test.ts`

**Interfaces:**

- Consumes: таблицы `vendor_auth_sessions`, `vendor_auth_verifications`,
  `vendor_auth_rate_limits`, `vendor_auth_email_limits`.
- Produces: новые поля `TtlCleanupResult`: `vendorAuthSessions`,
  `vendorAuthVerifications`, `vendorAuthRateLimits`, `vendorAuthEmailLimits`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("чистит просроченные vendor-auth сессии, проверки и окна", async () => {
  // insert expired/fresh rows in all four tables
  const result = await runTtlCleanup(db, options);
  expect(result.vendorAuthSessions).toBe(1);
  expect(result.vendorAuthVerifications).toBe(1);
  expect(result.vendorAuthRateLimits).toBe(1);
  expect(result.vendorAuthEmailLimits).toBe(1);
  expect(await count(pool, "vendor_auth_two_factors")).toBe(1);
  expect(await count(pool, "vendor_auth_passkeys")).toBe(1);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm vitest run apps/worker/src/jobs/ttl-cleanup.test.ts`
Expected: FAIL — полей нет.

- [ ] **Step 3: Реализовать SQL**

Добавить четыре `delete` по аналогии с auth-таблицами:

- sessions по `expires_at` + `sessionRetentionDays`;
- verifications по `expires_at` + `verificationRetentionDays`;
- rate limits по `last_request` старше суток;
- email limits по `window_started_at` старше суток.
  TOTP/passkeys не трогать.

- [ ] **Step 4: Прогнать тест**

Run: `pnpm vitest run apps/worker/src/jobs/ttl-cleanup.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/worker/src/jobs/ttl-cleanup.ts apps/worker/src/jobs/ttl-cleanup.test.ts
git commit -m "feat(worker): clean vendor auth ttl"
```

---

### Task 13: Bootstrap CLI и локальный seed

**Files:**

- Create: `apps/api/src/cli/provision-vendor-admin.ts`
- Modify: `apps/api/package.json` (script `vendor:admin`)
- Modify: `tools/seed/src/seed.ts` (статус `invited`, `twoFactorEnabled: false`)
- Modify: `docs/00-start/quickstart.md`
- Test: `apps/api/src/cli/provision-vendor-admin.test.ts`, `tools/seed/test/seed.test.ts`

**Interfaces:**

- Consumes: `parseEnv`, `createVendorAuth`, DB-сервисы Task 4.
- Produces: `provisionVendorAdmin(deps: { db; authDb; auth; mailer; vendorBaseUrl }, input: { email; name; force }): Promise<{ userId; invited: boolean }>`; CLI entry запускается только при прямом запуске.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("создаёт первого superadmin и отправляет ссылку", async () => {
  const result = await provisionVendorAdmin(deps, {
    email: "ops@example.com",
    name: "Ops",
    force: false,
  });
  expect(result.invited).toBe(true);
  expect(await getVendorUserByEmail(db, "ops@example.com")).toMatchObject({
    role: "superadmin",
    status: "invited",
  });
  expect(mailer.vendorPasswordResets).toHaveLength(1);
  expect(await hasAudit(pool, "vendor.user.bootstrap_admin")).toBe(true);
});

it("отказывается без --force, если superadmin уже есть", async () => {
  await expect(
    provisionVendorAdmin(deps, { email: "second@example.com", name: "Second", force: false }),
  ).rejects.toThrow(/superadmin/);
});

it("идемпотентен для invited", async () => {
  await provisionVendorAdmin(deps, { email: "ops@example.com", name: "Ops", force: false });
  const second = await provisionVendorAdmin(deps, {
    email: "ops@example.com",
    name: "Ops",
    force: false,
  });
  expect(second.invited).toBe(true);
  expect(await count(pool, "vendor_users")).toBe(1);
  expect(mailer.vendorPasswordResets).toHaveLength(2);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/cli/provision-vendor-admin.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать CLI и seed**

- CLI: парсинг `--email`, `--name`, `--force`; env; пулы; vendor auth;
  проверка существующего superadmin; `signUpEmail` (случайный пароль),
  `updateVendorUser` (superadmin/invited), `requestPasswordReset`,
  `writeVendorAudit` с actor `null`; не печатать пароль/токен.
- Если пользователь с этим email уже существует:
  - `invited` — не вызывать `signUpEmail`, только переотправить reset;
  - `active`/`suspended`/`disabled` — ошибка (кроме `--force` для явного
    восстановления доступа).
- CLI entry выполняется только при прямом запуске (`import.meta.url`),
  чтобы `provisionVendorAdmin` импортировался тестами без побочных эффектов.
- `apps/api/package.json`: `"vendor:admin": "tsx src/cli/provision-vendor-admin.ts"`.
- Seed: `status: "invited"`, `twoFactorEnabled: false`.
- Каждый тест создаёт свою `createTestDatabase`, чтобы порядок тестов не влиял
  на «первый superadmin».
- Quickstart: локальный вход вендора через «забыли пароль» → Mailpit →
  установка пароля → TOTP.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/cli/provision-vendor-admin.test.ts tools/seed/test/seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add apps/api/src/cli apps/api/package.json tools/seed docs/00-start/quickstart.md
git commit -m "feat(api): add vendor admin bootstrap"
```

---

### Task 14: E2E, OpenAPI, документация и финальная проверка

**Files:**

- Create: `apps/api/src/vendor-auth/e2e.test.ts`
- Modify: `docs/03-architecture/api.md`, `data-model.md`, `docs/04-security/threat-model.md`, `authz.md`, `docs/00-start/quickstart.md`, `deploy/environments/staging/README.md`, `.env.example`, `CHANGELOG.md`, `README.md`, `packages/db/README.md`, `.superpowers/sdd/partner-coder-mega-plan/progress.md`
- Generated: `apps/api/openapi.json`, `apps/api/src/generated/openapi.d.ts`

**Interfaces:**

- Consumes: all previous tasks.
- Produces: полный E2E, OpenAPI drift, обновлённый ledger (R-45), PR.

- [ ] **Step 1: Написать E2E**

`e2e.test.ts` (реальная БД + Fastify + MemoryMailer):

1. `provisionVendorAdmin` создаёт superadmin; ссылка из Mailpit/MemoryMailer;
2. установка пароля; вход; `twoFactorRedirect`; включение TOTP; вход с TOTP;
3. `POST /v1/vendor/users` создаёт `finance`; письмо; установка пароля;
4. новый пользователь без TOTP получает 403 на `/v1/vendor/users`;
5. включение TOTP; доступ;
6. `PATCH` suspended → сессии отозваны; вход → 403 `VENDOR_INACTIVE`;
7. reset-password для suspended → 409; reset-mfa → TOTP/passkeys удалены;
8. audit chain `verify_vendor_audit_chain()` = true.

- [ ] **Step 2: Сгенерировать OpenAPI и типы**

```bash
pnpm --filter @partner-coder/api openapi:emit
pnpm --filter @partner-coder/api openapi:types
```

Ожидается: только ожидаемый diff; руками не править.

- [ ] **Step 3: Обновить документацию и ledger**

- `api.md`: `/api/vendor-auth/*` (allow/deny), `/v1/vendor/*`.
- `data-model.md`: таблицы, роли, `vendor_audit()`, отсутствие RLS.
- `threat-model.md`: вендорские угрозы (credential stuffing, TOTP reset,
  session theft, reset-токены).
- `authz.md`: вендорские роли и guard.
- `quickstart.md`: локальный вход вендора.
- `staging/README.md`: `VENDOR_*` env, логины, bootstrap.
- `.env.example`, `CHANGELOG.md`, `README.md`, `packages/db/README.md`.
- Ledger: R-45 и статус «PR A vendor-auth».

- [ ] **Step 4: Финальная проверка**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm vitest run
pnpm build
pnpm db:check
pnpm install --frozen-lockfile
```

Ожидается: все тесты (642 + новые) зелёные, drift нет, build успешен.

- [ ] **Step 5: Коммит и PR**

```bash
git add -A
git commit -m "feat(auth): add vendor auth contour"
git push -u origin feat/m3-vendor-auth
gh pr create --fill --base main
```

Ожидается: PR создан, 4 обязательных check зелёные, CodeQL зелёный;
squash-merge после ревью.

---

## Self-Review

- **Spec coverage:** env (Task 1), schema/migration/roles/audit (Tasks 2–4),
  mailer/limiter (5), password/reset (6), TOTP/suspension (7), identity/guard
  (8), proxy (9), routes/step-up/users (10), composition/role checks (11),
  TTL (12), bootstrap/seed (13), E2E/OpenAPI/docs (14).
- **Type consistency:** `VendorRole`, `VendorUserStatus`, `VendorUser`,
  `VendorIdentity`, `VendorAuthRuntime`, `createVendorAuth`,
  `writeVendorAudit`, `resetVendorMfa` used consistently.
- **Review Focus tests:** suspended/reset (Tasks 4, 7, 10), no-TOTP (8, 10),
  audit (3, 4, 10), duplicates/bootstrap (10, 13), reset/limits (5, 6, 9).
- **Out of scope:** passkeys plugin/UI, Playwright WebAuthn, vendor console
  pages, IP allowlist, managed PG provisioning — PR B / §14.
