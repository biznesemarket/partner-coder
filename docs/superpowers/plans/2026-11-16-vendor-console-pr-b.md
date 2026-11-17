# Vendor Console PR B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить passkeys к вендорскому Better Auth и собрать same-origin Next.js-консоль с экранами входа, сброса пароля, включения TOTP, управления passkeys и `/me`, покрытую Playwright E2E.

**Architecture:** Браузер ходит только в `VENDOR_BASE_URL`; Next route handlers проксируют `/api/vendor-auth/*` и `/v1/vendor/*` в Fastify, поэтому cookie first-party. Защищённые страницы используют серверный `ConsoleGuard` с явным `returnTo`; Better Auth client и WebAuthn работают на origin консоли. TOTP остаётся обязательным, passkey — дополнительным фактором.

**Tech Stack:** TypeScript strict, pnpm 10.33.2, Node.js ≥ 22.12, Better Auth 1.7.25, `@better-auth/passkey` 1.7.25, Next.js 16.4.6, React 19.3.1, Tailwind 4.3.5, Drizzle/PostgreSQL 17, Fastify 5, Vitest 4, Playwright 1.65.1.

**Spec:** `docs/superpowers/specs/2026-11-16-vendor-console-pr-b-design.md`

## Global Constraints

- Node.js ≥ 22.12, pnpm 10.33.2; версии из Spec не поднимать без отдельной задачи.
- Better Auth и `@better-auth/passkey` остаются 1.7.25; TypeScript остаётся 5.7.x, не 7.x.
- PR B не добавляет миграций: `vendor_auth_passkeys` уже создана в `0006`.
- Tenant-auth (`/api/auth/*`, `users`, `auth_*`, tenant-guard) не меняется.
- Пароли, TOTP-секреты, backup-коды, reset-токены и session-токены не попадают в код, логи, аудит, фикстуры и `localStorage`.
- Вендорские таблицы без RLS; изоляция — гранты и раздельные логины.
- API остаётся единственным энфорсером авторизации; BFF не ослабляет guard.
- BFF forward whitelist: `cookie`, `content-type`, `accept`, `origin`, `user-agent`, `x-request-id`, `idempotency-key`; все `Set-Cookie` передаются.
- Русский UI; строки — в типизированном каталоге, не в разметке.
- `apps/api/openapi.json` и `apps/api/src/generated/openapi.d.ts` не редактируются вручную.
- Conventional commits, ветка + PR, squash-merge; каждый task заканчивается коммитом.
- Новые версии в `apps/web` и `apps/api` фиксировать без caret (`--save-exact`).
- Существующие 776 тестов остаются зелёными; `pnpm check` обязателен.

## Review Focus

1. **Password-only сессия пытается сменить пароль, отозвать сессии или управлять passkeys.** Ожидание: 403 `vendor_mfa_required`; `sign-out` и passkey-вход работают. Тесты — Task 3.
2. **Non-resident passkey-credential не выбирается usernameless-входом.** Ожидание: регистрация требует `residentKey: "required"`. Тесты — Task 2 (options) и Task 13 (E2E).
3. **BFF теряет часть `Set-Cookie` или пересылает опасные заголовки.** Ожидание: несколько cookie сохраняются, `host`/`referer`/`x-forwarded-*` не уходят. Тесты — Task 6.
4. **Недоступный API на защищённой странице даёт редирект-цикл или ложный logout.** Ожидание: `ServiceUnavailable`, без редиректа. Тесты — Task 6 (502) и Task 7 (`guardAction`).
5. **`returnTo` становится open redirect или теряется между шагами.** Ожидание: только внутренний pathname, переживает password → TOTP → passkey → setup-mfa. Тесты — Task 7 и Task 8.

---

### Task 0: Ветка, baseline и коммит дизайна/плана

**Files:**

- Modify: `docs/superpowers/specs/2026-11-16-vendor-console-pr-b-design.md`
- Create: `docs/superpowers/plans/2026-11-16-vendor-console-pr-b.md`

**Interfaces:**

- Consumes: `main` = `607492a`, локальные PostgreSQL/Mailpit/SILO.
- Produces: ветка `feat/m3-vendor-console`, зелёный baseline, дизайн и план в ветке.

- [ ] **Step 1: Создать ветку от актуального main**

```bash
git switch main
git pull --ff-only
git switch -c feat/m3-vendor-console
```

Ожидается: `main` на `607492a`, ветка создана.

- [ ] **Step 2: Прогнать baseline**

```bash
pnpm install --frozen-lockfile
pnpm check
```

Ожидается: `776 passed` / 40 файлов, format/lint/typecheck зелёные.

- [ ] **Step 3: Закоммитить дизайн и план**

```bash
git add docs/superpowers/specs/2026-11-16-vendor-console-pr-b-design.md \
  docs/superpowers/plans/2026-11-16-vendor-console-pr-b.md
git commit -m "docs: add vendor console PR B design and plan"
```

Ожидается: оба документа в ветке.

---

### Task 1: `VENDOR_WEBAUTHN_RP_ID` в конфигурации

**Files:**

- Modify: `packages/config/src/env.ts`
- Test: `packages/config/src/env.test.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: `optionalString`, `envSchema.superRefine`, `validEnv`, `validStagingEnv`.
- Produces: поле `VENDOR_WEBAUTHN_RP_ID?: string`; `resolveVendorWebauthnRpId(env): string`.

- [ ] **Step 1: Написать падающие тесты**

Добавить `VENDOR_WEBAUTHN_RP_ID: "vendor.example.test"` в `validStagingEnv` (иначе существующие успешные staging-тесты начнут падать), затем добавить в `env.test.ts`:

```ts
it("применяет localhost как rpID по умолчанию", () => {
  const env = parseEnv(validEnv);
  expect(env.VENDOR_WEBAUTHN_RP_ID).toBeUndefined();
  expect(resolveVendorWebauthnRpId(env)).toBe("localhost");
});

it("вне local требует VENDOR_WEBAUTHN_RP_ID", () => {
  const { VENDOR_WEBAUTHN_RP_ID: _omitted, ...rest } = validStagingEnv;
  expect(() => parseEnv(rest)).toThrow(/VENDOR_WEBAUTHN_RP_ID/);
  expect(() =>
    resolveVendorWebauthnRpId({
      APP_ENV: "staging",
      VENDOR_BASE_URL: "https://vendor.example.test",
    }),
  ).toThrow(/VENDOR_WEBAUTHN_RP_ID/);
});

it.each([
  "https://vendor.example.test",
  "vendor.example.test:3001",
  "vendor.example.test/x",
  "Vendor.Example.Test",
])("отклоняет невалидный rpID %s", (rpId) => {
  expect(() => parseEnv({ ...validStagingEnv, VENDOR_WEBAUTHN_RP_ID: rpId })).toThrow(
    /VENDOR_WEBAUTHN_RP_ID/,
  );
});

it("требует, чтобы rpID был хостом или суффиксом VENDOR_BASE_URL", () => {
  const ok = parseEnv({ ...validStagingEnv, VENDOR_WEBAUTHN_RP_ID: "example.test" });
  expect(resolveVendorWebauthnRpId(ok)).toBe("example.test");
  expect(() => parseEnv({ ...validStagingEnv, VENDOR_WEBAUTHN_RP_ID: "other.test" })).toThrow(
    /VENDOR_WEBAUTHN_RP_ID/,
  );
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run packages/config/src/env.test.ts`
Expected: FAIL — `resolveVendorWebauthnRpId` не экспортирован, валидация отсутствует.

- [ ] **Step 3: Реализовать схему и resolver**

В `env.ts`:

- `rpIdSchema`: lowercase hostname, метки 1–63, без схемы/порта/пути, максимум 253 символа.
- Поле `VENDOR_WEBAUTHN_RP_ID: optionalString.pipe(rpIdSchema.optional())`.
- В `superRefine`: вне local значение обязательно; при наличии `VENDOR_BASE_URL` hostname равен rpID или заканчивается на `.${rpID}`.
- `resolveVendorWebauthnRpId(env): string` возвращает rpID, localhost для local или бросает `EnvValidationError`.

В `.env.example` добавить:

```dotenv
# WebAuthn: localhost локально; вне local — хост консоли без схемы/порта.
VENDOR_WEBAUTHN_RP_ID=localhost
```

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm vitest run packages/config/src/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add packages/config/src/env.ts packages/config/src/env.test.ts .env.example
git commit -m "feat(config): add vendor webauthn rp id"
```

---

### Task 2: Passkey-плагин в вендорском Better Auth

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/api/src/vendor-auth/config.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/cli/provision-vendor-admin.ts`
- Test: `apps/api/src/vendor-auth/better-auth.test.ts`
- Modify: `apps/api/src/cli/provision-vendor-admin.test.ts`
- Modify: `apps/api/src/vendor-auth/*.test.ts` (все вызовы `createVendorAuth`)

**Interfaces:**

- Consumes: `resolveVendorWebauthnRpId(env)`, `vendorAuthPasskeys`, `twoFactor`.
- Produces: `CreateVendorAuthOptions.webauthnRpId: string`; `createVendorAuth` с плагином `passkey`.

- [ ] **Step 1: Добавить зависимость**

```powershell
pnpm --filter @partner-coder/api add @better-auth/passkey@1.7.25 --save-exact --registry=https://registry.npmjs.org
```

Ожидается: `apps/api/package.json` и `pnpm-lock.yaml` обновлены, версия ровно `1.7.25` (без caret).

- [ ] **Step 2: Написать падающий тест**

В `better-auth.test.ts` добавить проверку options регистрации:

```ts
it("passkey-плагин использует rpID, origin и обязательный resident key", async () => {
  const auth = buildAuth();
  const email = uniqueEmail("passkey");
  const userId = await signUp(auth, email);
  await updateVendorUser(database.db, userId, { role: "superadmin", status: "active" });
  const signedIn = await signInThroughHandler(auth, email);
  const options = await auth.api.generatePasskeyRegistrationOptions({
    headers: new Headers({ cookie: signedIn.cookie }),
  });
  expect(options.rp.id).toBe("localhost");
  expect(options.rp.name).toBe("Партнер кодер (вендор)");
  expect(options.authenticatorSelection).toMatchObject({
    residentKey: "required",
    userVerification: "required",
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `pnpm vitest run apps/api/src/vendor-auth/better-auth.test.ts`
Expected: FAIL — passkey plugin отсутствует / `webauthnRpId` не передан.

- [ ] **Step 4: Реализовать**

- В `config.ts` импортировать `passkey` из `@better-auth/passkey`.
- Добавить `passkey: vendorAuthPasskeys` в schema adapter.
- Добавить обязательное `webauthnRpId` в `CreateVendorAuthOptions`.
- В `plugins` после `twoFactor` добавить:

```ts
passkey({
  rpID: options.webauthnRpId,
  rpName: "Партнер кодер (вендор)",
  origin: [vendorBaseURL],
  authenticatorSelection: { userVerification: "required", residentKey: "required" },
  advanced: { webAuthnChallengeCookie: "pc-vendor-passkey" },
}),
```

- В `main.ts` и `cli/provision-vendor-admin.ts` импортировать `resolveVendorWebauthnRpId` и передать `webauthnRpId: resolveVendorWebauthnRpId(env)`.
- Во всех тестовых вызовах `createVendorAuth` (`better-auth`, `e2e`, `role-limited`, `routes`, `provision-vendor-admin`) добавить `webauthnRpId: "localhost"`.

- [ ] **Step 5: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/vendor-auth/better-auth.test.ts apps/api/src/vendor-auth/role-limited.test.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/vendor-auth/config.ts \
  apps/api/src/main.ts apps/api/src/vendor-auth/*.test.ts
git commit -m "feat(auth): enable vendor passkey plugin"
```

---

### Task 3: MFA/status gate и аудит passkey в прокси

**Files:**

- Modify: `apps/api/src/routes/vendor-auth.ts`
- Modify: `apps/api/src/vendor-auth/audit-actions.ts`
- Test: `apps/api/src/vendor-auth/proxy.test.ts`
- Test: `apps/api/src/vendor-auth/passkey-proxy-audit.test.ts` (новый)
- Test: `apps/api/src/vendor-auth/e2e.test.ts` (если нужен chain assert)

**Interfaces:**

- Consumes: `resolveVendorIdentity(runtime, headers, log)`, `writeVendorAudit`, `createTestDatabase`.
- Produces: `isMfaRequiredPath(path: string): boolean`; новые audit actions; gate до проксирования.

- [ ] **Step 1: Написать падающие proxy-тесты**

В `proxy.test.ts` расширить `createAuth(requests, session?)`: `api.getSession` возвращает сессию с `user { id, email, name, role, status, twoFactorEnabled }` и `session { id, expiresAt, stepUpUntil }`.

```ts
it.each([
  ["POST", "/change-password"],
  ["POST", "/revoke-session"],
  ["POST", "/revoke-other-sessions"],
  ["GET", "/passkey/generate-register-options"],
  ["POST", "/passkey/verify-registration"],
  ["GET", "/passkey/list-user-passkeys"],
  ["POST", "/passkey/delete-passkey"],
  ["POST", "/passkey/update-passkey"],
])("требует TOTP для %s %s", async (method, path) => {
  const { app, requests } = createApp({ session: sessionWith({ twoFactorEnabled: false }) });
  const response = await app.inject({ method, url: `/api/vendor-auth${path}` });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ error: { code: "vendor_mfa_required" } });
  expect(requests).toHaveLength(0);
});

it("не гейтит passkey-вход", async () => {
  const { app, requests } = createApp({ session: null });
  for (const path of ["/passkey/generate-authenticate-options", "/passkey/verify-authentication"]) {
    const response = await app.inject({
      method: path.includes("generate") ? "GET" : "POST",
      url: `/api/vendor-auth${path}`,
    });
    expect(response.statusCode).toBe(200);
  }
  expect(requests).toHaveLength(2);
});

it("блокирует управление passkey и смену пароля для suspended", async () => {
  const { app } = createApp({
    session: sessionWith({ status: "suspended", twoFactorEnabled: true }),
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/vendor-auth/passkey/delete-passkey",
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ error: { code: "vendor_inactive" } });
});

it("пропускает управление после TOTP", async () => {
  const { app, requests } = createApp({ session: sessionWith({ twoFactorEnabled: true }) });
  const response = await app.inject({
    method: "POST",
    url: "/api/vendor-auth/passkey/verify-registration",
  });
  expect(response.statusCode).toBe(200);
  expect(requests).toHaveLength(1);
});
```

- [ ] **Step 2: Написать падающий audit-тест**

Новый `passkey-proxy-audit.test.ts`:

```ts
it("аудирует добавление passkey", async () => {
  // createTestDatabase + insert vendor user (superadmin, active)
  // fake auth: getSession -> identity; handler -> 200
  // inject POST /api/vendor-auth/passkey/verify-registration
  const rows = await database.pool.query(
    "select action from vendor_audit_events where action = 'vendor.passkey.added'",
  );
  expect(rows.rowCount).toBe(1);
  const chain = await database.pool.query("select verify_vendor_audit_chain() as ok");
  expect(chain.rows[0]?.ok).toBe(true);
});
```

Аналогично `it("аудирует удаление passkey")` для `delete-passkey` → `vendor.passkey.removed`.

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/api/src/vendor-auth/proxy.test.ts apps/api/src/vendor-auth/passkey-proxy-audit.test.ts`
Expected: FAIL — gate и события отсутствуют.

- [ ] **Step 4: Реализовать gate**

В `routes/vendor-auth.ts`:

```ts
const MFA_REQUIRED_PATHS = new Set([
  "/change-password",
  "/revoke-session",
  "/revoke-other-sessions",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/register",
  "/passkey/list-user-passkeys",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
]);

export function isMfaRequiredPath(path: string): boolean {
  return MFA_REQUIRED_PATHS.has(path);
}
```

Перед проксированием для таких путей:

1. `resolveVendorIdentity(...)`; `null` → 401 `vendor_unauthenticated`.
2. status не `invited`/`active` → 403 `vendor_inactive`.
3. `!twoFactorEnabled` → 403 `vendor_mfa_required`.

`sign-out` и passkey-auth пути в набор не входят.

- [ ] **Step 5: Реализовать аудит**

В `audit-actions.ts` добавить:

```ts
passkeyAdded: "vendor.passkey.added",
passkeyRemoved: "vendor.passkey.removed",
passkeyRenamed: "vendor.passkey.renamed",
```

В `IDENTITY_PATHS` добавить `/passkey/verify-registration`, `/passkey/delete-passkey`, `/passkey/update-passkey`. В `auditResponse` для 200 + identity:

- `verify-registration` → `passkeyAdded`, `entity: "vendor_passkey"`, `after: { userId, sessionId }`;
- `delete-passkey` → `passkeyRemoved`;
- `update-passkey` → `passkeyRenamed`.

Секреты, credential ID и public key не писать.

- [ ] **Step 6: Прогнать тесты**

Run: `pnpm vitest run apps/api/src/vendor-auth/proxy.test.ts apps/api/src/vendor-auth/passkey-proxy-audit.test.ts`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add apps/api/src/routes/vendor-auth.ts apps/api/src/vendor-auth/audit-actions.ts \
  apps/api/src/vendor-auth/proxy.test.ts apps/api/src/vendor-auth/passkey-proxy-audit.test.ts
git commit -m "feat(auth): gate and audit vendor passkey management"
```

---

### Task 4: `packages/ui` — фундамент и примитивы

**Files:**

- Modify: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/components/{button,input,label,field,card,alert,badge,spinner,skeleton,separator}.tsx`
- Test: `packages/ui/src/lib/cn.test.ts`

**Interfaces:**

- Consumes: React 19.3.1, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `@radix-ui/react-slot` 1.5.0, `@radix-ui/react-label` 2.1.17, `@radix-ui/react-separator` 1.2.0.
- Produces: `cn(...inputs): string`; `Button`, `Input`, `Label`, `Field`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`, `Alert`, `Badge`, `Spinner`, `Skeleton`, `Separator`.

- [ ] **Step 1: Настроить пакет**

`package.json`: `type: "module"`, exports `dist`, scripts `build`, `typecheck`, `clean`; `react`/`react-dom` в `peerDependencies` и `devDependencies`; добавить зависимости из Interfaces.

`tsconfig.json`: extends `../../tsconfig.base.json`; `jsx: "react-jsx"`, `lib: ["ES2023","DOM","DOM.Iterable"]`, `rootDir: "src"`, `outDir: "dist"`, `noEmit: false`, `declaration: true`, `declarationMap: true`, `sourceMap: true`, include `src/**/*.ts(x)`.

- [ ] **Step 2: Написать падающий тест `cn`**

```ts
it("объединяет классы и убирает конфликты tailwind", () => {
  expect(cn("px-2", false && "hidden", ["py-1", { "px-4": true }])).toBe("py-1 px-4");
});
```

Run: `pnpm vitest run packages/ui/src/lib/cn.test.ts`
Expected: FAIL — `cn` не существует.

- [ ] **Step 3: Реализовать `cn` и примитивы**

`cn` — `twMerge(clsx(inputs))`. Компоненты — shadcn-подобные, с `forwardRef`, semantic Tailwind-классами и `data-slot`. `Button` — варианты `default | secondary | outline | ghost | destructive`, размеры `sm | md | lg`, поддержка `asChild` через Slot. `Field` принимает `label`, `htmlFor`, `hint?`, `error?`, `children`.

- [ ] **Step 4: Собрать и прогнать тест**

Run: `pnpm vitest run packages/ui/src/lib/cn.test.ts && pnpm --filter @partner-coder/ui build`
Expected: PASS, `dist` создан.

- [ ] **Step 5: Коммит**

```bash
git add packages/ui
git commit -m "feat(ui): add shared primitives"
```

---

### Task 5: `packages/ui` — интерактивные компоненты

**Files:**

- Modify: `packages/ui/package.json`
- Create: `packages/ui/src/components/{dialog,alert-dialog,dropdown-menu,checkbox,password-input,code-input,copy-button,theme-toggle,toaster,brand-mark,page-header,empty-state}.tsx`
- Create: `packages/ui/src/lib/code.ts`
- Test: `packages/ui/src/lib/code.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**

- Consumes: Radix dialog/dropdown/checkbox 1.3.1/2.2.1/1.4.1, `sonner` 2.0.8, `next-themes` 0.4.6, `lucide-react` 1.73.0.
- Produces: `Dialog`, `AlertDialog`, `DropdownMenu`, `Checkbox`, `PasswordInput`, `CodeInput`, `CopyButton`, `ThemeToggle`, `Toaster`, `BrandMark`, `PageHeader`, `EmptyState`; `normalizeOtp(value): string`, `normalizeBackupCode(value): string`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("оставляет в OTP только цифры и ограничивает шесть", () => {
  expect(normalizeOtp("12 34-56 78")).toBe("123456");
  expect(normalizeOtp("abc")).toBe("");
});

it("нормализует резервный код без смены регистра", () => {
  expect(normalizeBackupCode("  ab-cd  ")).toBe("ab-cd");
});
```

Run: `pnpm vitest run packages/ui/src/lib/code.test.ts`
Expected: FAIL.

- [ ] **Step 2: Реализовать helpers и компоненты**

- `CodeInput`: 6 боксов, paste, Backspace/Arrow, `autoFocus`, `aria-label`, `inputMode="numeric"`, `autoComplete="one-time-code"`.
- `PasswordInput`: show/hide, `aria-pressed`, `autoComplete` пропсом.
- `CopyButton`: clipboard, success-state, accessible label.
- `ThemeToggle`: `next-themes`, system/light/dark.
- `Toaster`: sonner с темой.
- Интерактивные файлы помечены `"use client"`; `BrandMark`, `PageHeader`, `EmptyState` — без директивы.

- [ ] **Step 3: Прогнать тесты и build**

Run: `pnpm vitest run packages/ui/src/lib/code.test.ts && pnpm --filter @partner-coder/ui build`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add packages/ui
git commit -m "feat(ui): add interactive components"
```

---

### Task 6: Next.js scaffold, тема и BFF

**Files:**

- Modify: `apps/web/package.json`
- Create: `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/tsconfig.json`, `apps/web/next-env.d.ts`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/theme-provider.tsx`
- Create: `apps/web/src/lib/proxy.ts`
- Create: `apps/web/src/app/api/vendor-auth/[...path]/route.ts`
- Create: `apps/web/src/app/v1/vendor/[...path]/route.ts`
- Test: `apps/web/src/lib/proxy.test.ts`
- Modify: `eslint.config.js`

**Interfaces:**

- Consumes: `@partner-coder/ui`, Next 16.4.6, React 19.3.1, Tailwind 4.3.5; `API_BASE_URL`.
- Produces: `proxyVendorRequest(request, pathSegments, options): Promise<Response>`; BFF routes; базовый layout/тема.

- [ ] **Step 1: Установить зависимости**

Добавить в `apps/web`: `next@16.4.6`, `react@19.3.1`, `react-dom@19.3.1`, `better-auth@1.7.25`, `@better-auth/passkey@1.7.25`, `@partner-coder/ui@workspace:*`, `tailwindcss@4.3.5`, `@tailwindcss/postcss@4.3.5`, `tw-animate-css@1.4.0`, `@fontsource-variable/inter@5.3.0`, `next-themes@0.4.6`, `sonner@2.0.8`, `qrcode.react@4.2.0`, `react-hook-form@7.92.0`, `@hookform/resolvers@7.0.6`, `zod@4.6.7`; dev: `@playwright/test@1.65.1`, `@axe-core/playwright@4.14.0`, `otpauth@9.6.0`, `pg@8.23.1`, `@types/pg@8.23.1`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`. В корневые devDependencies добавить `@next/eslint-plugin-next@16.4.6`, `eslint-plugin-react-hooks@7.1.1`.

- [ ] **Step 2: Написать падающие тесты BFF**

```ts
it("сохраняет несколько Set-Cookie", async () => {
  const response = await proxyVendorRequest(request, ["sign-in", "email"], {
    apiBaseUrl: "http://localhost:4000",
    targetPathPrefix: "/api/vendor-auth",
    fetchImpl: async () =>
      new Response("{}", {
        status: 200,
        headers: [
          ["set-cookie", "pc-vendor.session_token=a; Path=/; HttpOnly"],
          ["set-cookie", "pc-vendor-passkey=b; Path=/; HttpOnly"],
        ],
      }),
  });
  expect(response.headers.getSetCookie()).toHaveLength(2);
});

it("не пересылает host, referer и x-forwarded-for", async () => {
  /* capture headers */
});
it("отклоняет path traversal и пустой сегмент", async () => {
  /* ["..","x"] -> 400 */
});
it("ограничивает тело 64 KiB", async () => {
  /* content-length 70000 -> 413 */
});
it("отклоняет чужой Origin для POST", async () => {
  /* origin evil -> 403 */
});
it("возвращает 502 при недоступном API", async () => {
  /* fetch throws -> 502 upstream_unavailable */
});
```

Run: `pnpm vitest run apps/web/src/lib/proxy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать BFF**

`proxyVendorRequest`:

- проверяет сегменты `^[A-Za-z0-9._~-]+$`, не `.`/`..`;
- unsafe-метод с `Origin` не равным `process.env.VENDOR_BASE_URL ?? new URL(request.url).origin` → 403;
- body limit 64 KiB;
- собирает target `${apiBaseUrl}${targetPathPrefix}/${segments.join("/")}${search}`;
- forward headers из whitelist, добавляет `x-request-id`;
- `fetch` с `redirect: "manual"`, `signal: AbortSignal.timeout(15_000)`;
- копирует `content-type`, `content-disposition`, `x-request-id`, все `set-cookie`; ставит `cache-control: no-store`; не копирует `content-encoding`/`content-length`;
- сеть/таймаут → 502 `upstream_unavailable`.

`API_BASE_URL` проверять лениво внутри handler, не на module scope, чтобы `next build` в CI без env проходил. Route handlers экспортируют `runtime = "nodejs"`, `dynamic = "force-dynamic"` и методы по Spec.

- [ ] **Step 4: Реализовать layout, тему и токены**

`globals.css`: `@import "tailwindcss";`, `@source "../../../../packages/ui/src";` (файл лежит в `apps/web/src/app`, до корня четыре уровня), `@custom-variant dark (&:is(.dark *));`, CSS-переменные светлой/тёмной темы и `@theme inline` mapping на `--color-*`, базовые стили, focus-visible. `layout.tsx`: Inter Variable, `ThemeProvider`/`Toaster`, `metadata`, `lang="ru"`. `next.config.ts`: `poweredByHeader: false`, `reactStrictMode: true`, security headers из Spec, HSTS только при `APP_ENV` staging/prod. ESLint: добавить `@next/eslint-plugin-next` для `apps/web/**` и `eslint-plugin-react-hooks` flat-правила для `apps/web/**` + `packages/ui/**`; `no-console` не запрещать в `apps/web` (BFF/диагностика).

- [ ] **Step 5: Прогнать тесты и build**

Run: `pnpm vitest run apps/web/src/lib/proxy.test.ts && pnpm --filter @partner-coder/web typecheck && pnpm --filter @partner-coder/web build`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/web eslint.config.js package.json pnpm-lock.yaml
git commit -m "feat(web): scaffold vendor console and BFF"
```

---

### Task 7: Auth client, серверный guard, шелл и чистые helpers

**Files:**

- Create: `apps/web/src/lib/auth-client.ts`, `vendor-types.ts`, `vendor-api.ts`, `vendor-api-client.ts`, `return-to.ts`, `errors.ts`, `format.ts`, `messages.ts`
- Create: `apps/web/src/components/console/console-guard.tsx`, `mfa-setup-guard.tsx`, `service-unavailable.tsx`, `console-shell.tsx`, `logout-button.tsx`
- Create: `apps/web/src/app/(console)/layout.tsx`, `apps/web/src/app/(auth)/layout.tsx`
- Test: `apps/web/src/lib/return-to.test.ts`, `errors.test.ts`, `guard.test.ts`, `format.test.ts`

**Interfaces:**

- Consumes: `cookies()` from `next/headers`, `cache()` from React, `API_BASE_URL`, `@partner-coder/ui`.
- Produces: `VendorMe`/`VendorMeResult` types; `getVendorMe(): Promise<VendorMeResult>`; `fetchVendorMe(): Promise<VendorMeResult>`; `guardAction(result): GuardAction`; `ConsoleGuard`, `MfaSetupGuard`, `ConsoleShell`; `sanitizeReturnTo`, `mapAuthError`, `formatDateTime`; `authClient`.

- [ ] **Step 1: Написать падающие тесты helpers**

```ts
it.each([
  ["/me/security", "/me/security"],
  ["//evil.example", "/me"],
  ["https://evil.example", "/me"],
  ["\\\\evil.example", "/me"],
  ["/me?token=secret", "/me"],
  [undefined, "/me"],
])("sanitizeReturnTo(%s) -> %s", (input, expected) => {
  expect(sanitizeReturnTo(input)).toBe(expected);
});

it("маппит коды Better Auth в русские тексты", () => {
  expect(mapAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" })).toMatch(/Неверный email/);
  expect(mapAuthError({ status: 429 })).toMatch(/Слишком много/);
  expect(mapAuthError({ code: "VENDOR_INACTIVE" })).toMatch(/заблокирована/);
  expect(mapAuthError({ code: "UNKNOWN" })).toMatch(/Не удалось/);
});

it("ошибка API не превращается в login/logout", () => {
  expect(guardAction({ kind: "error" })).toBe("error");
  expect(guardAction({ kind: "unauthenticated" })).toBe("login");
  expect(guardAction({ kind: "inactive" })).toBe("inactive");
  expect(guardAction({ kind: "ok", me: meWith({ mfaEnrollmentRequired: true }) })).toBe("mfa");
  expect(guardAction({ kind: "ok", me: meWith({ mfaEnrollmentRequired: false }) })).toBe("render");
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm vitest run apps/web/src/lib/return-to.test.ts apps/web/src/lib/errors.test.ts apps/web/src/lib/guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать helpers**

- `sanitizeReturnTo`: `new URL(value, "http://local")`, только pathname, начинающийся с одного `/`, без `//`, `\`, схем; иначе `/me`.
- `mapAuthError`: таблица из Spec, fallback generic.
- `guardAction`: `render | login | inactive | mfa | error`.
- `formatDateTime`: `Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" })`.

- [ ] **Step 4: Реализовать auth client и серверный API**

```ts
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost:3001" : window.location.origin,
  basePath: "/api/vendor-auth",
  plugins: [twoFactorClient(), passkeyClient()],
});
```

`vendor-types.ts` — `VendorMe` и `VendorMeResult` без серверных импортов.
`getVendorMe` — `cache()` + `cookies()` + fetch `${API_BASE_URL}/v1/vendor/auth/me`, `cache: "no-store"`, таймаут 5 с. 200 → `ok`; 401 → `unauthenticated`; 403 `vendor_inactive` → `inactive`; остальное/исключение → `error`.
`fetchVendorMe` — тот же union через same-origin `/v1/vendor/auth/me` с `credentials: "include"`; используется login-формой после создания сессии, чтобы узнать `mfaEnrollmentRequired`.

- [ ] **Step 5: Реализовать guard-компоненты и шелл**

- `ConsoleGuard({ returnTo, children })`: `redirect` для login/inactive/mfa, `ServiceUnavailable` для error, `children(me)` для render.
- `MfaSetupGuard({ returnTo, children })`: без сессии → login; inactive → login; error → ServiceUnavailable; `!mfaEnrollmentRequired` → `/me`; иначе `children(me)`.
- `ConsoleShell`: header, sidebar «Профиль»/«Безопасность», user menu, logout, theme toggle; mobile sheet.
- `(console)/layout.tsx` — только шелл; страницы используют guard с явным `returnTo`.
- `(auth)/layout.tsx` — центрированная auth-рамка.
- `app/page.tsx` — `getVendorMe` + `guardAction`: `render` → `/me`, `mfa` → `/setup-mfa`, `login` → `/login`, `inactive` → `/login?reason=inactive`, `error` → `ServiceUnavailable`.

- [ ] **Step 6: Прогнать тесты и typecheck**

Run: `pnpm vitest run apps/web/src/lib/return-to.test.ts apps/web/src/lib/errors.test.ts apps/web/src/lib/guard.test.ts && pnpm --filter @partner-coder/web typecheck`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add apps/web/src/lib apps/web/src/components apps/web/src/app
git commit -m "feat(web): add vendor auth client and server guards"
```

---

### Task 8: Экран `/login`

**Files:**

- Create: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/components/auth/login-machine.ts`, `login-form.tsx`, `two-factor-form.tsx`, `forgot-password-form.tsx`
- Test: `apps/web/src/components/auth/login-machine.test.ts`

**Interfaces:**

- Consumes: `authClient`, `getVendorMe`, `guardAction`, `mapAuthError`, `sanitizeReturnTo`, `CodeInput`.
- Produces: login flow с inline TOTP/backup, passkey-кнопкой и forgot-password.

- [ ] **Step 1: Написать падающий тест state machine**

```ts
it("переводит в TOTP при twoFactorRedirect", () => {
  expect(afterPassword({ twoFactorRedirect: true }, "/me/security")).toEqual({
    kind: "totp",
    returnTo: "/me/security",
    useBackupCode: false,
  });
});

it("после второго фактора отправляет на enroll или done", () => {
  expect(afterSecondFactor("/me", true)).toEqual({ kind: "enroll", returnTo: "/me" });
  expect(afterSecondFactor("/me", false)).toEqual({ kind: "done", returnTo: "/me" });
});
```

- [ ] **Step 2: Реализовать экран**

- Server page: `getVendorMe`; `ok` → redirect по `mfaEnrollmentRequired`; `error` → форма + outage Alert; иначе форма.
- Credentials step: email/password, show/hide, `signIn.email`; `afterPassword`.
- После успеха без `twoFactorRedirect`: `fetchVendorMe()` → `afterSecondFactor(returnTo, me.mfaEnrollmentRequired)`; `enroll` → `/setup-mfa?returnTo=…`, `done` → `returnTo`.
- TOTP step: `CodeInput`, `verifyTotp`, backup-code toggle, `verifyBackupCode`, возврат; после успеха — `returnTo`.
- Passkey button: `signIn.passkey`; после успеха — `fetchVendorMe()` и та же развилка enroll/done; ошибки `AUTH_CANCELLED` без шума.
- Forgot password: inline email → `requestPasswordReset` с `redirectTo: ${window.location.origin}/reset-password`; всегда нейтральный успех.
- `reason=inactive|session_expired` → Alert.
- После успеха: `router.replace(returnTo)` или `/setup-mfa?returnTo=…`.

- [ ] **Step 3: Прогнать тест, typecheck, build**

Run: `pnpm vitest run apps/web/src/components/auth/login-machine.test.ts && pnpm --filter @partner-coder/web typecheck && pnpm --filter @partner-coder/web build`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add apps/web/src/app/\(auth\)/login apps/web/src/components/auth
git commit -m "feat(web): add vendor login screen"
```

---

### Task 9: Экран `/reset-password`

**Files:**

- Create: `apps/web/src/app/(auth)/reset-password/page.tsx`
- Create: `apps/web/src/components/auth/reset-password-form.tsx`
- Create: `apps/web/src/lib/password.ts`
- Test: `apps/web/src/lib/password.test.ts`

**Interfaces:**

- Consumes: `authClient.resetPassword`, `mapAuthError`, `normalizeBaseUrl`-совместимый origin страницы.
- Produces: `passwordError(password, minLength): string | null`; `passwordsMatchError(password, confirm): string | null`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("требует минимум 12 символов", () => {
  expect(passwordError("short", 12)).toMatch(/12/);
  expect(passwordError("correct horse battery", 12)).toBeNull();
});

it("требует совпадения паролей", () => {
  expect(passwordsMatchError("a", "b")).toMatch(/не совпадают/);
  expect(passwordsMatchError("a", "a")).toBeNull();
});
```

- [ ] **Step 2: Реализовать экран**

- Server page: `searchParams: Promise<{ token?: string }>`; без токена — состояние «ссылка неполная».
- Client form: new/confirm, show/hide, inline ошибки; `authClient.resetPassword({ token, newPassword })`.
- Успех → «Пароль установлен» + ссылка на `/login`; ошибка → «ссылка недействительна или истекла» + запрос новой.
- После монтирования `history.replaceState` убирает `token` из URL; `metadata.robots = { index: false }`.

- [ ] **Step 3: Прогнать тест, typecheck, build**

Run: `pnpm vitest run apps/web/src/lib/password.test.ts && pnpm --filter @partner-coder/web typecheck && pnpm --filter @partner-coder/web build`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add apps/web/src/app/\(auth\)/reset-password apps/web/src/components/auth/reset-password-form.tsx apps/web/src/lib/password.ts apps/web/src/lib/password.test.ts
git commit -m "feat(web): add vendor password reset screen"
```

---

### Task 10: Экран `/setup-mfa`

**Files:**

- Create: `apps/web/src/app/(auth)/setup-mfa/page.tsx`
- Create: `apps/web/src/components/auth/setup-mfa-form.tsx`
- Create: `apps/web/src/lib/totp.ts`
- Test: `apps/web/src/lib/totp.test.ts`

**Interfaces:**

- Consumes: `MfaSetupGuard`, `authClient.twoFactor.enable/verifyTotp`, `qrcode.react`, `normalizeOtp`.
- Produces: `parseTotpUri(uri): { secret: string; issuer: string | null; account: string | null }`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("извлекает secret и issuer из otpauth URI", () => {
  expect(
    parseTotpUri(
      "otpauth://totp/Партнер%20кодер:ops%40example.com?secret=ABC234&issuer=%D0%9F%D0%B0%D1%80%D1%82%D0%BD%D0%B5%D1%80",
    ),
  ).toEqual({ secret: "ABC234", issuer: "Партнер", account: "ops@example.com" });
});
```

- [ ] **Step 2: Реализовать экран**

- Server page: `MfaSetupGuard returnTo={sanitizeReturnTo(returnTo)}`.
- Step 1: объяснение + password → `twoFactor.enable({ password, method: "totp" })`.
- Step 2: QR `QRCodeSVG`, секрет, copy; backup-коды (10) с copy/download; обязательный checkbox.
- Step 3: CodeInput → `verifyTotp`; успех → `router.replace(`${returnTo}?enrolled=1`)`.
- Ошибки: `TOTP_ALREADY_ENABLED` → `/me`; `INVALID_CODE`, lockout, неверный пароль, сеть.
- Пароль очищается после `enable`.

- [ ] **Step 3: Прогнать тест, typecheck, build**

Run: `pnpm vitest run apps/web/src/lib/totp.test.ts && pnpm --filter @partner-coder/web typecheck && pnpm --filter @partner-coder/web build`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add apps/web/src/app/\(auth\)/setup-mfa apps/web/src/components/auth/setup-mfa-form.tsx apps/web/src/lib/totp.ts apps/web/src/lib/totp.test.ts
git commit -m "feat(web): add vendor totp enrollment screen"
```

---

### Task 11: `/me` и `/me/security`

**Files:**

- Create: `apps/web/src/app/(console)/me/page.tsx`
- Create: `apps/web/src/app/(console)/me/security/page.tsx`
- Create: `apps/web/src/components/console/{profile-card,session-card,security-card,passkey-list,change-password-form,revoke-sessions-button}.tsx`
- Create: `apps/web/src/lib/passkeys.ts`
- Test: `apps/web/src/lib/passkeys.test.ts`

**Interfaces:**

- Consumes: `ConsoleGuard`, `authClient.passkey.listUserPasskeys/addPasskey/deletePasskey`, `changePassword`, `revokeOtherSessions`, `formatDateTime`, `mapAuthError`.
- Produces: `passkeyLabel(passkey): string`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("берёт имя, затем AAGUID, затем Passkey", () => {
  expect(passkeyLabel({ name: "Ноутбук", aaguid: null })).toBe("Ноутбук");
  expect(passkeyLabel({ name: null, aaguid: "00000000-0000-0000-0000-000000000000" })).toBe(
    "Passkey",
  );
});
```

- [ ] **Step 2: Реализовать `/me`**

- Server page: `ConsoleGuard returnTo="/me"`.
- Profile card: имя, email, роль, статус; role/status labels из messages.
- Session card: `sessionExpiresAt`, `stepUpUntil` (если есть), logout.
- `enrolled=1` → success toast.

- [ ] **Step 3: Реализовать TOTP-карточку и passkeys**

- Server page: `ConsoleGuard returnTo="/me/security"`.
- TOTP status + текст про сброс суперадмином.
- Passkey list: `listUserPasskeys`; add dialog (name), delete AlertDialog; empty state.
- Ceremony-ошибки: отмена/уже зарегистрирован/не поддерживается.

- [ ] **Step 4: Реализовать смену пароля, отзыв сессий и ошибки**

- Change password form: current/new/confirm → `changePassword({ ..., revokeOtherSessions: true })`.
- Revoke other sessions button.
- Обработка 403 `vendor_mfa_required` → `/setup-mfa`; 403 `vendor_inactive` → `/login?reason=inactive`; 401 → `/login?reason=session_expired&returnTo=…`.

- [ ] **Step 5: Прогнать тест, typecheck, build**

Run: `pnpm vitest run apps/web/src/lib/passkeys.test.ts && pnpm --filter @partner-coder/web typecheck && pnpm --filter @partner-coder/web build`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/web/src/app/\(console\) apps/web/src/components/console apps/web/src/lib/passkeys.ts apps/web/src/lib/passkeys.test.ts
git commit -m "feat(web): add vendor profile and security screens"
```

---

### Task 12: Playwright infra и E2E reset → TOTP

**Files:**

- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/env.json`, `prepare.mjs`
- Create: `apps/web/e2e/helpers/{mailpit,totp}.ts`
- Create: `apps/web/e2e/auth.spec.ts`
- Modify: `apps/web/package.json`, root `package.json`
- Modify: `apps/web/tsconfig.json` (types Playwright)

**Interfaces:**

- Consumes: Playwright 1.65.1, Mailpit `:8025`, PostgreSQL `:5432`, `otpauth` 9.6.0.
- Produces: `pnpm test:e2e`, `pnpm test:e2e:full`; E2E БД `partner_coder_e2e`.

- [ ] **Step 1: Добавить скрипты**

Web: `"test:e2e": "playwright test"`.
Root:

```json
"test:e2e": "node apps/web/e2e/prepare.mjs && pnpm --filter @partner-coder/web test:e2e",
"test:e2e:full": "pnpm build && pnpm test:e2e"
```

- [ ] **Step 2: Реализовать prepare/env**

- `env.json`: `DATABASE_URL` e2e, `API_BASE_URL=http://localhost:4000`, `VENDOR_BASE_URL=http://localhost:3001`, `VENDOR_WEBAUTHN_RP_ID=localhost`, `AUTH_SECRET`, SMTP/S3 local defaults, `APP_ENV=local`. `prepare.mjs` читает его через `readFileSync`, `playwright.config.ts` импортирует JSON (`resolveJsonModule` уже включён).
- `prepare.mjs`: подключиться к `postgres`, пересоздать БД `partner_coder_e2e`; выполнить `drop schema if exists public/drizzle/pgboss cascade` + `create schema public`; запустить `pnpm --filter @partner-coder/db db:migrate` с e2e env; запустить `pnpm --filter @partner-coder/api vendor:admin -- --email e2e-superadmin@example.test --name "E2E Admin"`.

- [ ] **Step 3: Реализовать Playwright config**

`webServer`:

```ts
[
  {
    command: "node ../api/dist/main.js",
    url: "http://localhost:4000/healthz",
    env: e2eEnv,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  {
    command: "pnpm start",
    url: "http://localhost:3001/login",
    env: {
      API_BASE_URL: "http://localhost:4000",
      VENDOR_BASE_URL: "http://localhost:3001",
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
];
```

`fullyParallel: false`, `workers: 1`, trace on first retry, screenshot/video on failure.

- [ ] **Step 4: Реализовать helpers и spec**

- `latestResetToken(email)`: Mailpit `/api/v1/messages`, найти последнее письмо, извлечь `token` из ссылки.
- `totpFromUri(uri)`: `new OTPAuth.TOTP(...).generate()`.
- `auth.spec.ts`: reset → login → `/setup-mfa` → intercept `two-factor/enable` response → backup codes → verify TOTP → `/me`. Плюс тест неверного пароля.

- [ ] **Step 5: Прогнать E2E**

```powershell
pnpm build
pnpm --filter @partner-coder/web exec playwright install chromium
pnpm test:e2e
```

Expected: PASS, 2–3 теста.

- [ ] **Step 6: Коммит**

```bash
git add apps/web/e2e apps/web/playwright.config.ts apps/web/package.json package.json apps/web/tsconfig.json
git commit -m "test(web): add vendor auth e2e infrastructure"
```

---

### Task 13: Passkey E2E и accessibility

**Files:**

- Create: `apps/web/e2e/helpers/authenticator.ts`
- Create: `apps/web/e2e/helpers/auth.ts`
- Create: `apps/web/e2e/passkey.spec.ts`
- Create: `apps/web/e2e/a11y.spec.ts`

**Interfaces:**

- Consumes: `page.context().newCDPSession(page)`, CDP `WebAuthn.enable/addVirtualAuthenticator`, helpers Task 12, `@axe-core/playwright` 4.14.0.
- Produces: E2E passkey add/login; axe checks.

- [ ] **Step 1: Реализовать virtual authenticator**

```ts
const client = await page.context().newCDPSession(page);
await client.send("WebAuthn.enable");
const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
```

- [ ] **Step 2: Написать passkey spec**

- `helpers/auth.ts`: `loginWithTotp(page, email, password, secret)` — email/password → TOTP → `/me`.
- `/me/security` → «Добавить ключ доступа» → имя → список содержит имя.
- Logout → `/login` → «Войти с ключом доступа» → `/me`.

- [ ] **Step 3: Написать a11y spec**

`new AxeBuilder({ page }).analyze()` на `/login`, `/setup-mfa`, `/me/security`; ожидать `violations.filter(v => ["serious","critical"].includes(v.impact))` пустым.

- [ ] **Step 4: Прогнать E2E**

Run: `pnpm test:e2e`
Expected: PASS, включая passkey и axe.

- [ ] **Step 5: Коммит**

```bash
git add apps/web/e2e
git commit -m "test(web): cover vendor passkeys and accessibility"
```

---

### Task 14: CI job для E2E

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `pnpm test:e2e`, Postgres 17, Mailpit, Chromium.
- Produces: job `e2e` (не входит в 4 обязательных check на старте).

- [ ] **Step 1: Добавить job**

```yaml
e2e:
  name: Vendor console E2E
  runs-on: ubuntu-latest
  timeout-minutes: 30
  services:
    postgres:
      image: postgres:17-alpine
      env: { POSTGRES_USER: partner, POSTGRES_PASSWORD: partner, POSTGRES_DB: partner_coder }
      ports: ["5432:5432"]
      options: >-
        --health-cmd "pg_isready -U partner -d partner_coder"
        --health-interval 5s --health-timeout 5s --health-retries 10
    mailpit:
      image: axllent/mailpit:latest
      ports: ["1025:1025", "8025:8025"]
  steps:
    - uses: actions/checkout@v7
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v7
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm build
    - run: pnpm --filter @partner-coder/web exec playwright install --with-deps chromium
    - run: pnpm test:e2e
```

- [ ] **Step 2: Проверить YAML и локальный прогон**

Run: `pnpm format:check && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 3: Коммит**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add vendor console e2e job"
```

---

### Task 15: Документация, ADR и ledger

**Files:**

- Create: `docs/adr/0014-web-console-bff.md`
- Modify: `docs/adr/README.md`, `docs/index.md`
- Modify: `docs/03-architecture/vendor-auth.md`, `docs/03-architecture/api.md`
- Modify: `docs/04-security/threat-model.md`, `docs/04-security/authz.md`
- Modify: `docs/00-start/quickstart.md`, `docs/05-process/quality-gates.md`
- Modify: `deploy/environments/staging/README.md`
- Modify: `README.md`, `CHANGELOG.md`, `apps/web/README.md`, `packages/ui/README.md`
- Modify: `.superpowers/sdd/partner-coder-mega-plan/progress.md`

**Interfaces:**

- Consumes: реализованное поведение, env, команды.
- Produces: ADR-0014, обновлённая документация, ledger R-46.

- [ ] **Step 1: Написать ADR-0014**

Зафиксировать: same-origin BFF выбран; direct API и Vite SPA отклонены; first-party cookie/SSR; BFF whitelist; per-IP лимиты за BFF; CSP follow-up; passkey origin/rpID; resident key.

- [ ] **Step 2: Обновить документы**

- `vendor-auth.md`: статус PR B, passkey-поток, UI, rpID/origin, BFF, gate change-password/revoke, resident key.
- `api.md`: BFF и passkey proxy.
- `threat-model.md`: passkey, BFF, reset-токен, IP-лимиты и audit IP за BFF.
- `authz.md`: роли консоли, self-service.
- `quickstart.md`: `pnpm dev:web`, localhost:3001, Mailpit, TOTP, passkey, `pnpm test:e2e`.
- `quality-gates.md`: E2E команда/job.
- staging README: RP ID, VENDOR_BASE_URL, API_BASE_URL, BFF.
- README/CHANGELOG/web/UI README.
- Ledger: R-46 и статус PR B. `.superpowers/` в `.gitignore` — файл
  обновляется локально, в коммит не входит.

- [ ] **Step 3: Форматирование и проверка ссылок**

Run: `pnpm exec prettier --write "docs/**/*.md" "README.md" "CHANGELOG.md" "apps/web/README.md" "packages/ui/README.md"`
Expected: файлы отформатированы.

- [ ] **Step 4: Коммит**

```bash
git add docs README.md CHANGELOG.md apps/web/README.md packages/ui/README.md \
  deploy/environments/staging/README.md
git commit -m "docs: document vendor console PR B"
```

---

### Task 16: Финальная верификация и PR

**Files:** нет изменений (кроме исправлений по результатам).

**Interfaces:**

- Consumes: все предыдущие tasks.
- Produces: зелёный `pnpm check`, build, E2E, PR.

- [ ] **Step 1: Полный прогон**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:check
pnpm --filter @partner-coder/api openapi:emit
pnpm --filter @partner-coder/api openapi:types
git diff --exit-code -- apps/api/openapi.json apps/api/src/generated/openapi.d.ts
pnpm test:e2e
```

Expected: всё зелёное; OpenAPI без drift; E2E pass; tenant-тесты не сломаны.

- [ ] **Step 2: Ручной smoke**

- `pnpm seed` + `vendor:admin --force` на локальной БД.
- Mailpit → reset → TOTP → passkey → logout → passkey login.
- Проверить light/dark, 375 px, keyboard-only.
- Suspended login → понятная ошибка.

- [ ] **Step 3: Запушить и открыть PR**

```bash
git push -u origin feat/m3-vendor-console
gh pr create --base main --head feat/m3-vendor-console \
  --title "feat(web): add vendor console passkeys and UI" \
  --body "PR B: passkeys, same-origin BFF, vendor console screens, Playwright E2E. Spec: docs/superpowers/specs/2026-11-16-vendor-console-pr-b-design.md"
```

Ожидается: PR создан, 4 обязательных check запущены, E2E job зелёный.

- [ ] **Step 4: Squash-merge после зелёных check**

Дождаться required checks + CodeQL; устранить замечания; squash-merge по правилам репозитория. Не мержить при красных проверках.
