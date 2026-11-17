# Design: вендорская консоль PR B — passkeys и UI

| Поле      | Значение                                                          |
| --------- | ----------------------------------------------------------------- |
| Статус    | на согласовании                                                   |
| Дата      | 2026-11-16                                                        |
| Автор     | session design                                                    |
| Связанные | ADR-0013, ADR-0014 (новая), `docs/03-architecture/vendor-auth.md` |
| База      | `main` = `607492a` (PR #19)                                       |

## 1. Контекст и цель

PR A закрыл вендорский auth-контур программно: отдельный Better Auth на
`/api/vendor-auth`, `password + TOTP`, роли, блокировки, сброс пароля/MFA,
аудит и step-up. Войти в консоль человеком пока нельзя: UI нет, reset-ссылка
ведёт на несуществующую страницу, токен приходится доставать из Mailpit.

PR B делает контур пригодным для внешних ролей (`finance`, `support`,
`readonly`) и суперадминистратора:

- подключает passkey-плагин Better Auth; TOTP остаётся обязательным;
- добавляет Next.js-консоль с экранами входа, сброса пароля, включения TOTP,
  управления passkeys и `/me`;
- строит same-origin BFF, чтобы cookie были first-party, а защищённые
  страницы могли рендериться на сервере;
- покрывает полный сценарий Playwright E2E с виртуальным authenticator.

Визуальный уровень — «аккуратная консоль для внешних сотрудников»: понятные
состояния, подсказки, доступность, светлая/тёмная тема и общий шелл, который
переживёт M3.1. Не минимальная техническая форма.

## 2. Границы

### 2.1 Goals

1. Passkey-регистрация, вход, список и удаление; passkey — дополнительный
   способ, TOTP обязателен.
2. Экраны: `/login`, `/reset-password`, `/setup-mfa`, `/me`,
   `/me/security`; общий шелл консоли.
3. Same-origin BFF: браузер ходит только в `VENDOR_BASE_URL`; Next route
   handlers проксируют `/api/vendor-auth/*` и `/v1/vendor/*` в Fastify.
4. Серверный guard защищённых страниц через `/v1/vendor/auth/me`; клиентский
   guard — только для интерактивных состояний.
5. Аудит успешных добавлений/удалений passkeys; вход через passkey уже
   покрывается `session.create.after`.
6. Playwright E2E на Chromium с CDP virtual authenticator, реальными
   PostgreSQL и Mailpit; отдельная команда и необязательный CI job.
7. Документация, ADR-0014, обновление ledger до R-46.

### 2.2 Non-goals

- Данные M3.1: клиенты, тарифы, договоры, счета, платежи, пакеты, воронка,
  дашборд.
- UI управления вендорскими пользователями (`/v1/vendor/users` остаётся
  API-only).
- Применение `requireVendorStepUp` к маршрутам — первое опасное действие
  M3.1.
- Passkey-only, аппаратные ключи как обязательный фактор, self-service
  сброс MFA, IP allowlist.
- Email/SMS OTP как второй фактор, social login, open sign-up.
- Кабинеты директора/разработчика M5.
- CSP с nonce, trusted client IP propagation, managed PostgreSQL/SMTP —
  §14/эксплуатационный backlog.

### 2.3 Anti-goals

- Ослабить TOTP: passkey не может быть единственным фактором.
- Хранить пароли, TOTP-секреты, backup-коды, reset-токены или session-токены
  в `localStorage`, логах, аудите, аналитике или URL после использования.
- Дублировать авторизацию в UI: клиентские проверки — только UX, не
  безопасность.
- Сделать BFF открытым прокси или точкой обхода API-проверок.
- Отправлять `totpURI` в сторонний QR-сервис или внешние запросы.
- Менять tenant-auth, tenant-таблицы, RLS или существующие маршруты PR A.

## 3. Текущее состояние и ограничения

- `apps/web` и `packages/ui` — пустые манифесты. Next.js App Router,
  Tailwind и shadcn-подход зафиксированы мега-планом (M3/M5).
- `apps/api` уже отдаёт `/api/vendor-auth/*` (прокси Better Auth) и
  `/v1/vendor/*` (guard: authenticate → MFA → role); `/v1/vendor/auth/me`
  возвращает `user`, `mfaEnrollmentRequired`, `sessionExpiresAt`,
  `stepUpUntil`.
- `vendor_auth_passkeys` создана в `0006`, но плагин не подключён;
  `reset-mfa` уже удаляет passkeys.
- `VENDOR_BASE_URL=http://localhost:3001`, `API_BASE_URL=http://localhost:4000`,
  `WEB_BASE_URL=http://localhost:3000`; CORS с `credentials: true` уже
  разрешает vendor origin.
- `VENDOR_WEBAUTHN_RP_ID` отсутствует.
- Baseline: 776 тестов / 40 файлов, golden 22, property 7; `pnpm check`
  зелёный.
- Версии (не поднимать без отдельной задачи): Node ≥ 22.12, pnpm 10.33.2,
  Better Auth 1.7.25, Drizzle 0.45.4, Fastify 5.2.1, Zod 4.6.7,
  TypeScript 5.7.x, Vitest 4.1.12. Добавляемые: Next 16.4.6,
  React 19.3.1, Tailwind 4.3.5, `@better-auth/passkey` 1.7.25,
  Playwright 1.65.1.
- Вендорские таблицы без RLS; изоляция — гранты и раздельные логины.
- Правила репозитория: ветка + PR, conventional commits, squash-merge,
  4 обязательных check, branch up-to-date.
- No DB migration в PR B: схема passkeys уже соответствует плагину.

## 4. Рассмотренные подходы

### A. Same-origin BFF в Next.js (выбран)

Браузер общается только с origin консоли. Next route handlers
проксируют auth и vendor API в Fastify; cookie становятся first-party;
защищённые layout-ы — серверные и читают сессию через API.

Плюсы: first-party cookie и SSR; не зависим от SameSite при выборе хостинга
(§14); passkey ceremony идёт с origin консоли, совпадающим с
`VENDOR_BASE_URL`; CORS для браузера не нужен; один origin для CSP и
security headers. Минусы: небольшой прокси-слой, аккуратная передача
нескольких `Set-Cookie`, per-IP лимиты API за BFF становятся
instance-global (см. §8.4).

### B. Прямой вызов API из браузера

Консоль на `3001` вызывает Fastify на `4000` с `credentials: include`.

Плюсы: минимум кода, уже настроенные CORS/`trustedOrigins`. Минусы: нет SSR
защищённых страниц; cookie привязаны к хосту API; если web и API окажутся на
разных сайтах, `SameSite=Lax` их сломает; CORS-заголовки нужно поддерживать.
Отклонён: выбранный визуальный уровень и открытый выбор хостинга делают
связку хрупкой.

### C. Vite SPA

Плюс: проще сборка. Минус: противоречит зафиксированному Next.js App Router,
который нужен для кабинетов M5; второй фронтенд-тулчейн. Отклонён.

### D. Только edge reverse proxy

Плюс: ноль кода BFF. Минус: требует инфраструктуры в каждом окружении,
локально всё равно нужен прокси, preview-среды ломаются. Отклонён.

## 5. Архитектура

### 5.1 Приложения и пакеты

```text
apps/web/                 Next.js App Router, порт 3001
  src/app/
    (auth)/               login, reset-password, setup-mfa
    (console)/            защищённый шелл: me, me/security
    api/vendor-auth/[...path]/route.ts
    v1/vendor/[...path]/route.ts
  src/components/         экраны и провайдеры
  src/lib/                auth-client, vendor-api, messages, errors, env
  e2e/                    Playwright specs, prepare, helpers
  next.config.ts
  postcss.config.mjs
  playwright.config.ts
packages/ui/              примитивы, токены, тема, layout-компоненты
```

`apps/web` зависит от `@partner-coder/ui`; UI собирается в `dist` по
конвенции R-07. Глобальный CSS и Tailwind-скан живут в `apps/web`;
`@source` включает `packages/ui/src`.

### 5.2 BFF-контракт

Два catch-all route handler:

| Next path                    | Target                                | Methods                  |
| ---------------------------- | ------------------------------------- | ------------------------ |
| `/api/vendor-auth/[...path]` | `${API_BASE_URL}/api/vendor-auth/...` | GET, POST                |
| `/v1/vendor/[...path]`       | `${API_BASE_URL}/v1/vendor/...`       | GET, POST, PATCH, DELETE |

Правила:

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `fetchCache = "force-no-store"`.
- Path segments валидируются: `^[A-Za-z0-9._~-]+$`, без `.`/`..`; иначе 400.
- Query строка пробрасывается как есть, максимум 8 KiB.
- Body — `arrayBuffer`, максимум 64 KiB; иначе 413.
- В API-forward уходят только: `cookie`, `content-type`, `accept`,
  `origin`, `user-agent`, `x-request-id`, `idempotency-key`. `host`,
  `content-length`, `connection`, `referer`, `x-forwarded-*` не уходят.
- `x-request-id` генерируется BFF, если его нет; возвращается браузеру.
- Небезопасные методы дополнительно проверяют `Origin` на равенство
  собственному origin BFF (defense in depth); несовпадение — 403.
- Ответ: копируются `content-type`, `content-disposition`, `x-request-id`
  и **все** `Set-Cookie` через `headers.getSetCookie()`; `content-encoding`
  и `content-length` не копируются. Для всех ответов ставится
  `cache-control: no-store`.
- `redirect: "manual"`, таймаут 15 с. Сеть/таймаут → 502
  `{ error: { code: "upstream_unavailable", message } }`; тело ошибки не
  содержит upstream-деталей.
- API остаётся единственной точкой авторизации; BFF не ослабляет guard и
  не добавляет прав.

### 5.3 Серверный guard и матрица доступа

`apps/web/src/lib/vendor-api.ts` (server-only) вызывает
`${API_BASE_URL}/v1/vendor/auth/me` с cookie из `cookies()`,
`cache: "no-store"`. Возвращает дискриминированный union:
`ok | unauthenticated | inactive | error`.

| Маршрут           | Поведение                                                                          |
| ----------------- | ---------------------------------------------------------------------------------- |
| `/`               | `ok` + MFA → `/me`; `ok` без MFA → `/setup-mfa`; иначе `/login`                    |
| `/login`          | `ok` + MFA → `/me`; `ok` без MFA → `/setup-mfa`; иначе форма входа                 |
| `/reset-password` | публично; токен из `searchParams` (Promise в Next 16)                              |
| `/setup-mfa`      | без сессии → `/login`; inactive → `/login?reason=inactive`; MFA есть → `/me`       |
| `/me`             | без сессии → `/login`; inactive → `/login?reason=inactive`; без MFA → `/setup-mfa` |
| `/me/security`    | то же, что `/me`                                                                   |
| `/api/*`, `/v1/*` | BFF; не редиректят                                                                 |

- Защита — на уровне страниц через server-компонент `ConsoleGuard` с
  явным `returnTo` (`/me`, `/me/security`, …): layout не знает pathname,
  поэтому не угадывает его. `ConsoleGuard` делает `redirect()` для
  login/inactive/mfa и рендерит `ServiceUnavailable` для error. Страницы
  `force-dynamic`; `getVendorMe` обёрнут в React `cache()` и дедуплицирует
  вызов в пределах запроса.
- `reason=inactive` и `reason=session_expired` показываются на `/login`
  безопасным текстом; query не влияет на авторизацию.
- `error` (таймаут/5xx API) **не** редиректит и **не** выглядит как выход:
  защищённые страницы и `/` рендерят `ServiceUnavailable` с текстом
  «Сервис временно недоступен» и кнопкой «Повторить»; `/login` показывает
  форму с неблокирующим Alert об outage; `/setup-mfa` — error-состояние с
  повтором. Так нет цикла редиректов при недоступном API.
- `returnTo` производит серверный guard при 401: текущий pathname (без
  query/hash). Он переживает шаг пароля → TOTP → passkey и передаётся в
  `/setup-mfa?returnTo=…`; после включения TOTP — переход на безопасный
  `returnTo`, по умолчанию `/me`.
- Клиентские 401 от vendor API переводят на
  `/login?reason=session_expired&returnTo=<pathname>`; 403
  `vendor_inactive` — на `/login?reason=inactive` (без returnTo).

### 5.4 Better Auth client и passkey-плагин

`apps/web/src/lib/auth-client.ts`:

```ts
createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost:3001" : window.location.origin,
  basePath: "/api/vendor-auth",
  plugins: [twoFactorClient(), passkeyClient()],
});
```

- Cookie-only, без токенов в JS. `getSession` не используется как источник
  истины; identity берётся из `/v1/vendor/auth/me`.
- `signIn.email`, `twoFactor.verifyTotp`, `twoFactor.verifyBackupCode`,
  `twoFactor.enable`, `requestPasswordReset`, `resetPassword`,
  `changePassword`, `revokeOtherSessions`, `signOut`,
  `signIn.passkey`, `passkey.addPasskey`, `passkey.listUserPasskeys`,
  `passkey.deletePasskey`.
- 2FA redirect обрабатывается inline: `signIn.email` с
  `data.twoFactorRedirect` переключает шаг на TOTP/backup-код; глобальный
  `onTwoFactorRedirect` не используется.
- Conditional UI (autofill) в PR B не включаем: лишний риск для E2E и
  неоднозначное поведение с явной кнопкой. Отмечено в follow-ups.

`apps/api/src/vendor-auth/config.ts`:

```ts
import { passkey } from "@better-auth/passkey";

database: drizzleAdapter(options.db, {
  provider: "pg",
  schema: {
    /* ... */
    passkey: vendorAuthPasskeys,
  },
}),
plugins: [
  twoFactor({ /* как в PR A */ }),
  passkey({
    rpID: options.webauthnRpId,
    rpName: "Партнер кодер (вендор)",
    origin: [vendorBaseURL],
    authenticatorSelection: { userVerification: "required", residentKey: "required" },
    advanced: { webAuthnChallengeCookie: "pc-vendor-passkey" },
  }),
],
```

`origin` задаётся явно: иначе плагин ожидает origin API, а ceremony идёт с
origin консоли. `rpID` — хост консоли (локально `localhost`), не origin с
портом.

`residentKey: "required"` — моё решение по итогам builder-check: вход
`signIn.passkey` usernameless, без email и `allowCredentials`, поэтому
non-discoverable credential выбрать нельзя. `preferred` мог создать
непригодный для входа ключ. Следствие: cross-platform ключи без resident
key в PR B не поддерживаются как passkeys; passkey остаётся дополнительным
способом, TOTP — обязательным.

### 5.5 Политика TOTP/passkey и gate в прокси

- TOTP включается только через `two-factor/enable` + `verify-totp`;
  отключение (`/two-factor/disable`) остаётся запрещённым.
- Passkey можно добавить/смотреть/удалять только при
  `twoFactorEnabled = true`; иначе прокси отвечает 403
  `vendor_mfa_required`.
- Gate применяется к: `GET /passkey/generate-register-options`,
  `POST /passkey/verify-registration`, `POST /passkey/register`,
  `GET /passkey/list-user-passkeys`, `POST /passkey/delete-passkey`,
  `POST /passkey/update-passkey`.
- Тот же gate применяется к `POST /change-password`,
  `POST /revoke-session`, `POST /revoke-other-sessions`: password-only
  сессия (TOTP ещё не включён) не должна менять пароль и отзывать чужие
  сессии — иначе украденный пароль даёт DoS владельцу до сброса. `sign-out`
  остаётся доступным, чтобы пользователь мог выйти.
- Не гейтятся: `GET /passkey/generate-authenticate-options`,
  `POST /passkey/verify-authentication`, `POST /passkey/authenticate`,
  `POST /sign-in/passkey` — иначе passkey-вход сломается.
- Gate также проверяет статус: `suspended`/`disabled` → 403
  `vendor_inactive` (даже при живой сессии).
- Passkey-вход создаёт полноценную сессию; при `twoFactorEnabled = true`
  guard считает её MFA. Если TOTP ещё не включён, сессия упирается в
  `/setup-mfa` и `vendor_mfa_required` на данных.
- Потеря passkey не блокирует вход: остаются password + TOTP/backup-коды.
  Сброс MFA суперадминистратором удаляет TOTP и passkeys.
- Fresh-session middleware плагина (по умолчанию 24 ч) не конфликтует с TTL
  сессии 8 ч; отдельных действий не требуется.

### 5.6 Аудит

Новые константы:

- `vendor.passkey.added` — успешный `verify-registration`;
- `vendor.passkey.removed` — успешный `delete-passkey`;
- `vendor.passkey.renamed` — успешный `update-passkey` (UI rename не
  выставляем, но путь закрыт gate и аудируется).

Прокси резолвит identity до запроса для этих путей и пишет аудит
best-effort после 200; секреты, credential ID и public key не пишутся.
Успешный passkey-вход пишется существующим `session.create.after`
(`vendor.auth.sign_in_succeeded`). Неуспешные passkey-попытки не аудируем,
чтобы не шуметь отменами ceremony; серверный rate limit остаётся.

### 5.7 UI-система и визуальное направление

- Tailwind 4, shadcn-подход, CSS-переменные в `globals.css`; семантические
  токены: background/foreground, card, muted, border, primary, destructive,
  success, warning, ring, radius.
- Палитра — моё решение: графитовые нейтрали + сдержанный синий primary,
  зелёный success, янтарный warning, красный destructive; контраст AA.
  Без фирменного брендбука; легко заменить токенами.
- Типографика: Inter Variable с кириллицей (`@fontsource-variable/inter`),
  системный mono для кодов/секретов. Без внешних font-CDN.
- Светлая/тёмная тема через `next-themes` (`system` по умолчанию, toggle в
  шелле и на auth-экранах), без вспышки темы.
- Компоненты в `packages/ui`: Button, Input, PasswordInput, Label, Field,
  Card, Alert, Badge, Dialog, AlertDialog, DropdownMenu, Separator,
  Skeleton, Spinner, Checkbox, Tabs (если понадобятся), CodeInput,
  CopyButton, Toast (sonner), ThemeToggle, BrandMark, PageHeader, EmptyState.
- Интерактивные компоненты помечаются `"use client"`; чистые
  презентационные остаются серверно-совместимыми.
- Русский UI; строки — в типизированном каталоге
  `apps/web/src/lib/messages.ts`, без разбросанных литералов. Роли:
  «Суперадминистратор», «Финансы», «Поддержка», «Только чтение».
- Доступность: landmarks, skip-link, label/`aria-describedby`, inline
  ошибки, `aria-live` для статусов, focus management после шагов,
  keyboard-only сценарии, reduced motion, минимум 44×44 px для действий.
- Шелл: header с брендом и меню пользователя, sidebar «Профиль» /
  «Безопасность», mobile — sheet. Пункты M3.1 не показываем
  заглушками; структура навигации готова к добавлению по ролям.
- Auth-экраны: центрированная карточка, brand mark, спокойный фон, без
  sidebar.

## 6. Экраны и потоки

### 6.1 `/login`

- Email, password (show/hide), submit; inline ошибки; ссылка «Забыли
  пароль?».
- Кнопка «Войти с ключом доступа (passkey)» показывается, если
  `window.PublicKeyCredential` доступен; иначе скрыта с пояснением.
- `signIn.email`: успех без 2FA → безопасный `returnTo` или `/me`;
  `twoFactorRedirect` → шаг TOTP; `returnTo` сохраняется в состоянии шага.
  Если после входа нужен TOTP enrollment — `/setup-mfa?returnTo=…`.
- Passkey-вход ведёт себя так же: `returnTo` или `/me`, либо
  `/setup-mfa?returnTo=…`, если TOTP ещё не включён.
- Шаг TOTP: 6-значный CodeInput, `autocomplete="one-time-code"`, ссылка
  «Использовать резервный код», возврат к паролю. Ошибки: неверный код,
  lockout 429, истёкшая 2FA-сессия.
- «Забыли пароль?»: inline-форма email → `requestPasswordReset` с
  `redirectTo: ${origin}/reset-password`; ответ всегда нейтральный.
- `reason=inactive` / `session_expired` — Alert с понятным текстом.
- Уже аутентифицированный пользователь редиректится сервером.

### 6.2 `/reset-password`

- Server page читает `token` из `searchParams` (Promise), передаёт в
  client-форму; без токена — состояние «ссылка неполная».
- Поля: новый пароль, повтор; проверки: минимум 12, совпадение, show/hide.
- `resetPassword({ token, newPassword })`; успех → экран «Пароль
  установлен» + ссылка на вход; ошибка → «ссылка недействительна или
  истекла» + запрос новой.
- После монтирования токен удаляется из адресной строки
  (`history.replaceState`); `Referrer-Policy: no-referrer`; страница
  `noindex`; никаких внешних запросов.
- Сброс не реактивирует suspended/disabled — UI показывает безопасную
  ошибку входа.

### 6.3 `/setup-mfa`

- Обязательный экран, пока `mfaEnrollmentRequired`.
- Шаг 1: объяснение, зачем TOTP; повторный ввод пароля (требование
  плагина) → `twoFactor.enable({ password, method: "totp" })`.
- Шаг 2: QR (`qrcode.react`, SVG) + секрет текстом + копирование;
  предупреждение не отправлять QR/секрет третьим лицам.
- Backup-коды: 10 штук, один раз; copy/download `.txt`; обязательный
  чекбокс «Я сохранил коды»; предупреждение, что повторно не покажем.
- Шаг 3: CodeInput → `twoFactor.verifyTotp`; успех → безопасный
  `returnTo` с `enrolled=1` (по умолчанию `/me?enrolled=1`).
- Ошибки: неверный пароль, неверный код, lockout, `TOTP_ALREADY_ENABLED`
  (считать включённым и уйти в `/me`), сеть. Пароль не хранится после
  запроса.
- Выход из аккаунта доступен; данные консоли до включения TOTP закрыты
  API.

### 6.4 `/me`

- Server-fetched `/me`; карточка профиля: имя, email, роль, статус.
- Карточка сессии: срок действия, step-up (если есть), кнопка «Выйти».
- Ссылка/переход в «Безопасность».
- `enrolled=1` — success-toast «Защита включена».

### 6.5 `/me/security`

- TOTP: статус «Включён»; отключение недоступно; текст «Для сброса
  обратитесь к суперадминистратору».
- Passkeys: список (имя/провайдер по AAGUID/дата/backedUp), добавление
  (диалог имени), удаление (AlertDialog). Пустое состояние с объяснением,
  что passkey — дополнительный способ, TOTP остаётся.
- Смена пароля: current/new/confirm, `changePassword` с
  `revokeOtherSessions: true`; успех-toast.
- «Завершить другие сессии» — `revokeOtherSessions`.
- Ошибки ceremony: отмена, устройство не поддерживает, passkey уже
  зарегистрирован; без технических деталей.
- Все действия требуют MFA; при 403 `vendor_mfa_required` — переход на
  `/setup-mfa`; при 403 `vendor_inactive` — `/login?reason=inactive`.

### 6.6 Блокировки и истечение сессии

- suspended/disabled: `/login` с Alert; reset-письма не отправляются;
  существующая сессия отзывается guard-ом.
- Истёкшая сессия: 401 → `/login?reason=session_expired`; после входа —
  безопасный `returnTo`.
- `returnTo` санитизируется: только pathname, начинающийся с одного `/`,
  без `//`, `\`, схем, host, query и hash; невалидное значение заменяется
  на `/me`. Источники значения — server guard при 401 и клиентский
  401-handler; вход, TOTP, passkey и `/setup-mfa` проносят его через шаги.

## 7. Ошибки и состояния

`mapAuthError` — чистая функция с тестами. Приоритет: `error.code`, затем
HTTP status, затем generic. Пользователю — русский текст, без stack и
сырых сообщений.

| Код / статус                                       | Текст                                                      |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `INVALID_EMAIL_OR_PASSWORD`, `INVALID_CREDENTIALS` | Неверный email или пароль                                  |
| `VENDOR_INACTIVE`                                  | Учётная запись заблокирована. Обратитесь к администратору. |
| `ACCOUNT_TEMPORARILY_LOCKED`, 429                  | Слишком много попыток. Попробуйте позже.                   |
| `INVALID_CODE`, `INVALID_TWO_FACTOR_CODE`          | Неверный код подтверждения                                 |
| `INVALID_TWO_FACTOR_COOKIE`, `SESSION_EXPIRED`     | Сессия входа истекла. Начните заново.                      |
| `TOTP_ALREADY_ENABLED`                             | TOTP уже включён                                           |
| `SESSION_NOT_FRESH`                                | Сессия устарела. Войдите заново.                           |
| `PREVIOUSLY_REGISTERED`                            | Этот ключ доступа уже зарегистрирован                      |
| `AUTH_CANCELLED`, `REGISTRATION_CANCELLED`         | Действие отменено                                          |
| `vendor_mfa_required`                              | Сначала включите TOTP                                      |
| `vendor_step_up_required`                          | Требуется повторное подтверждение пароля                   |
| `upstream_unavailable`, сеть, 5xx                  | Сервис временно недоступен. Повторите позже.               |
| 401 на защищённом экране                           | Сессия истекла — переход на вход                           |

Состояния: idle → submitting (spinner, disabled) → success/error; ошибки
полей — под полем, общие — Alert сверху с `role="alert"`; успехи — toast;
пустые состояния — EmptyState; загрузка — Skeleton/Spinner без layout
shift.

## 8. Безопасность и приватность

### 8.1 Cookie и CSRF

- Cookie Better Auth (`pc-vendor.*`) HttpOnly, first-party, `SameSite=Lax`;
  BFF не переписывает атрибуты.
- Passkey challenge cookie — `pc-vendor-passkey`; BFF пропускает все
  `Set-Cookie`.
- Origin-guard API сохраняется; BFF дополнительно проверяет unsafe-методы
  на свой origin. CSRF не ослабляется.

### 8.2 Токены и секреты

- Reset-токен живёт только в URL страницы сброса; удаляется из адресной
  строки после чтения; не пишется в аналитику/логи BFF; `no-referrer`.
- TOTP-секрет и backup-коды показываются один раз; не сохраняются в
  localStorage/state после ухода; пароль очищается после запроса.
- Passkey public key/credential ID не отображаются; аудит без секретов.

### 8.3 Заголовки

`next.config.ts`: `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`,
`Cross-Origin-Opener-Policy: same-origin`; HSTS только при
`APP_ENV !== "local"` на HTTPS-edge. CSP с nonce — follow-up.

### 8.4 Rate limit и IP за BFF

Per-email 5/60 и Better Auth database rate limit остаются в API и работают
через BFF, потому что ключ — email/аккаунт. Per-IP лимиты Better Auth и
глобальный Fastify 300/min видят IP BFF и становятся instance-global; для
4–10 вендорских сотрудников это приемлемо. Передача доверенного client IP
требует выбора хостинга/edge (§14) и отдельного решения о подписи
заголовка; в PR B не делаем. По той же причине audit-события за BFF
фиксируют egress-IP BFF, а не клиентский; риск уходит в threat model и
follow-ups.

### 8.5 Прочее

- BFF не логирует body, cookie, query; логирует только method/path/status/
  requestId/длительность.
- Никаких `dangerouslySetInnerHTML`; React экранирует.
- Ошибки API не пробрасываются в UI сырыми.
- WebAuthn origin жёстко `VENDOR_BASE_URL`; preview-домены passkeys не
  поддерживают — это ожидаемо.

## 9. Env и конфигурация

| Переменная              | Где        | Правило                                                                                                         |
| ----------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `VENDOR_WEBAUTHN_RP_ID` | API        | local default `localhost`; вне local обязателен, hostname без схемы/порта/пути; суффикс хоста `VENDOR_BASE_URL` |
| `VENDOR_BASE_URL`       | API + web  | уже есть; origin консоли; https вне local                                                                       |
| `API_BASE_URL`          | web server | target BFF; уже есть; не обязателен на этапе `next build`                                                       |
| `NEXT_PUBLIC_*`         | —          | не добавляем: auth client использует `window.location.origin`                                                   |

`resolveVendorWebauthnRpId(env)` в `packages/config`:

- local без значения → `localhost`;
- вне local без значения → ошибка;
- значение с `://`, `/`, `?`, `#`, `:` → ошибка;
- `new URL(VENDOR_BASE_URL).hostname` должен быть равен rpID или
  заканчиваться на `.${rpID}` (граница метки).
- Тесты: дефолт, отсутствие вне local, невалидный формат, чужой домен,
  родительский домен.

`.env.example` получает `VENDOR_WEBAUTHN_RP_ID=localhost`; staging README —
канонический host консоли.

## 10. E2E и CI

### 10.1 Инструменты

- Playwright 1.65.1, только Chromium (CDP virtual authenticator).
- Отдельная БД `partner_coder_e2e`; `prepare.mjs` пересоздаёт схемы
  `public/drizzle/pgboss`, применяет миграции и создаёт суперадмина через
  CLI без `--force`.
- Mailpit HTTP API (`/api/v1/messages`) для reset-ссылки.
- `otpauth` для генерации кода из `totpURI`, перехваченного из ответа
  `two-factor/enable`.
- `@axe-core/playwright` — проверки login/setup/me на serious/critical.

### 10.2 Сценарий

1. Bootstrap superadmin (prepare), запрос reset через UI.
2. Письмо из Mailpit → переход по ссылке → установка пароля.
3. Вход по паролю → принудительный `/setup-mfa` → пароль → QR/секрет →
   backup-коды → TOTP-код → `/me`.
4. `/me/security` → добавить passkey через виртуальный authenticator
   (`hasResidentKey: true`, user verification) → список содержит имя.
5. Выход → вход кнопкой passkey → `/me`.
6. Негативные: неверный пароль; неверный TOTP; passkey-эндпоинты до TOTP
   дают 403 (API-тест); suspended login (API-тест).
7. A11y: login/setup/me — нет serious/critical нарушений.

### 10.3 Команды и CI

- `pnpm build` → `pnpm test:e2e` (prepare + Playwright, серверы поднимает
  `webServer`).
- `pnpm test:e2e:full` = build + test:e2e для локального одного запуска.
- CI job `e2e` в `ci.yml`: Postgres + Mailpit services, Chromium install,
  build, test:e2e. Не входит в 4 обязательных check на старте; кандидат в
  обязательные после стабилизации.
- Vitest не подхватывает `e2e/*.spec.ts` (include только `*.test.ts`).

## 11. Карта файлов

### API / config / DB

| Файл                                        | Изменение                                                      |
| ------------------------------------------- | -------------------------------------------------------------- |
| `apps/api/package.json`                     | `@better-auth/passkey` 1.7.25                                  |
| `apps/api/src/vendor-auth/config.ts`        | passkey plugin, schema mapping, rpID, origin, challenge cookie |
| `apps/api/src/main.ts`                      | передать `VENDOR_WEBAUTHN_RP_ID` в runtime                     |
| `apps/api/src/vendor-auth/runtime.ts`       | поле `webauthnRpId` (если нужно)                               |
| `apps/api/src/routes/vendor-auth.ts`        | MFA/status gate, audit passkey, новые identity paths           |
| `apps/api/src/vendor-auth/audit-actions.ts` | passkey events                                                 |
| `apps/api/src/vendor-auth/*.test.ts`        | passkey config/proxy/gate/audit тесты                          |
| `packages/config/src/env.ts`                | `VENDOR_WEBAUTHN_RP_ID`, resolver/валидация                    |
| `packages/config/src/env.test.ts`           | тесты env                                                      |
| `.env.example`                              | новый env                                                      |

### Web / UI

| Файл                                                     | Изменение                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/web/package.json`                                  | Next/React/Better Auth/UI/Playwright скрипты                  |
| `apps/web/next.config.ts`                                | headers, poweredByHeader, strict mode                         |
| `apps/web/postcss.config.mjs`                            | Tailwind 4 postcss                                            |
| `apps/web/tsconfig.json`, `next-env.d.ts`                | Next TS                                                       |
| `apps/web/src/app/layout.tsx`, `globals.css`, `page.tsx` | корень, тема, токены                                          |
| `apps/web/src/app/(auth)/**`                             | login, reset-password, setup-mfa                              |
| `apps/web/src/app/(console)/**`                          | защищённый layout, me, me/security                            |
| `apps/web/src/app/api/vendor-auth/[...path]/route.ts`    | BFF auth                                                      |
| `apps/web/src/app/v1/vendor/[...path]/route.ts`          | BFF vendor API                                                |
| `apps/web/src/lib/*`                                     | auth-client, vendor-api, proxy, env, errors, messages, format |
| `apps/web/src/components/*`                              | экраны, guard-провайдеры, shell                               |
| `apps/web/e2e/*`, `playwright.config.ts`                 | E2E, prepare, helpers                                         |
| `packages/ui/src/**`                                     | примитивы, токены-классы, тема, layout                        |
| `packages/ui/package.json`, `tsconfig.json`              | сборка dist, peer deps                                        |
| `eslint.config.js`                                       | Next/react-hooks правила для web, no-console override         |
| `turbo.json`                                             | при необходимости outputs `.next` уже есть                    |
| `.github/workflows/ci.yml`                               | отдельный e2e job                                             |

### Документация

| Файл                                                                       | Изменение                            |
| -------------------------------------------------------------------------- | ------------------------------------ |
| `docs/adr/0014-web-console-bff.md`                                         | новое решение                        |
| `docs/adr/README.md`, `docs/index.md`                                      | ссылки                               |
| `docs/03-architecture/vendor-auth.md`                                      | PR B, passkeys, UI, BFF, RP ID       |
| `docs/03-architecture/api.md`                                              | BFF и passkey-прокси                 |
| `docs/04-security/threat-model.md`                                         | passkey/BFF/токены/IP-лимиты         |
| `docs/04-security/authz.md`                                                | роли консоли и self-service          |
| `docs/00-start/quickstart.md`                                              | консоль, Mailpit, TOTP, passkey, E2E |
| `docs/05-process/quality-gates.md`                                         | E2E команда и CI                     |
| `deploy/environments/staging/README.md`                                    | RP ID, BFF, env                      |
| `README.md`, `CHANGELOG.md`, `packages/ui/README.md`, `apps/web/README.md` | статус и инструкции                  |
| `.superpowers/sdd/partner-coder-mega-plan/progress.md`                     | R-46, статус PR B                    |

## 12. Тестирование

### 12.1 API/config/unit

- `createVendorAuth` собирает passkey plugin с rpID/origin/challenge cookie.
- `VENDOR_WEBAUTHN_RP_ID`: дефолт local, обязательность/формат/суффикс вне
  local.
- Прокси: gated paths (passkey management + `change-password` +
  `revoke-session(s)`) → 403 `vendor_mfa_required` без TOTP; suspended →
  `vendor_inactive`; sign-out и passkey-auth paths не гейтятся.
- Прокси: успешные `verify-registration`/`delete-passkey` пишут аудит;
  цепочка `verify_vendor_audit_chain()` остаётся true.
- Существующие 776 тестов зелёные.

### 12.2 Web unit (node)

- `sanitizeReturnTo`, `mapAuthError`, `validatePassword`,
  `passkeyLabel`, `formatDateTime`.
- BFF proxy: path validation, header whitelist, multiple `Set-Cookie`,
  body limit, timeout/502, origin check.

### 12.3 E2E

Сценарий §10.2; серийный запуск; уникальные email; deterministic DB.
Axe на трёх экранах. При падении — trace/screenshot/video.

### 12.4 Ручные проверки

- Keyboard-only вход, TOTP, добавление/удаление passkey.
- Safari/Firefox: passkey UI скрыт/работает по возможностям браузера;
  E2E только Chromium.
- Мобильный layout 375 px.
- Light/dark/system, контраст.
- Suspended login и reset-письмо.

## 13. Acceptance criteria

- [ ] Passkey plugin 1.7.25 подключён; `VENDOR_WEBAUTHN_RP_ID` валидируется;
      схема без миграции.
- [ ] Passkey-эндпоинты управления и смена пароля/отзыв сессий закрыты до
      TOTP и для suspended; passkey-вход и sign-out не сломаны.
- [ ] Аудит `vendor.passkey.added/removed`; цепочка валидна.
- [ ] BFF не теряет cookie, не светит токены, не становится open proxy;
      unit-тесты.
- [ ] Экраны login/reset/setup-mfa/me/me-security работают на десктопе и
      мобильном; русские тексты; light/dark; доступность.
- [ ] Server guard: 401/403/MFA-редиректы; безопасный returnTo.
- [ ] Playwright E2E: reset → TOTP → passkey add → passkey login — зелёный
      локально и в CI.
- [ ] `pnpm check` зелёный; новых красных проверок нет; OpenAPI drift нет.
- [ ] Документация/ADR/ledger обновлены; quickstart воспроизводит вход.
- [ ] Tenant-auth, tenant-таблицы и существующие API-контракты не изменены.

## 14. Риски, компромиссы и follow-ups

1. **Client IP за BFF.** Per-IP лимиты становятся общими на инстанс.
   Первичная защита — per-email и lockout; доверенный IP — после выбора
   хостинга. Записать в threat model.
2. **CSP.** Базовые заголовки без nonce; полноценный CSP — отдельная
   задача, чтобы не ломать Next inline-скрипты.
3. **WebAuthn-покрытие.** E2E только Chromium; Safari/Firefox — ручная
   проверка, UI деградирует по возможностям браузера. `residentKey:
"required"` отсекает non-discoverable cross-platform ключи; это осознанно,
   passkey — дополнительный способ.
4. **Passkey recovery.** Нет self-service; потеря всех passkeys не
   блокирует вход (TOTP/backup), потеря TOTP — сброс суперадмином.
5. **SMTP/домен §14.** Reset-письма зависят от SPF/DKIM/DMARC; до этого
   локально Mailpit, staging — тестовый SMTP.
6. **BFF как новая поверхность.** Path/header/body whitelist, origin
   check, unit-тесты; API остаётся энфорсером.
7. **E2E flakiness.** Virtual authenticator, фиксированные origin/порты,
   deterministic DB, serial; job необязательный до стабилизации.
8. **Next 16 + TS 5.7.** Не поднимать TS до 7; проверить `next typegen` и
   flat ESLint.
9. **Дублирование аудита sign-in.** Passkey-вход пишется session-hook-ом;
   отдельного события не добавляем, чтобы не плодить записи.
10. **Conditional UI / passkey autofill** — follow-up, не PR B.
11. **Backup-code regeneration UI** — follow-up; сейчас коды показываются
    при включении TOTP.
12. **Пользовательские экраны M3.1** должны переиспользовать шелл, токены
    и server guard; пункты навигации добавятся по ролям.

## 15. Поставка

- Одна ветка `feat/m3-vendor-console`, один PR B; логические коммиты:
  env/config, passkey API/proxy/audit/tests, UI package, web app/BFF/auth
  screens, E2E/CI, docs/ADR/ledger.
- Squash-merge после 4 обязательных check + ревью; E2E job — зелёный, но
  не блокирующий на старте.
- Rollback: откат web-деплоя возвращает headless-контур PR A; passkey-строки
  остаются, вход по password+TOTP работает. Env `VENDOR_WEBAUTHN_RP_ID`
  остаётся заданным.
- Staging: HTTPS, канонический `VENDOR_BASE_URL`, rpID = хост консоли,
  `API_BASE_URL` доступен из Next server, SMTP с deliverability.
