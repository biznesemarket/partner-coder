# ADR-0014: Same-origin BFF для вендорской веб-консоли

| Поле      | Значение                                                        |
| --------- | --------------------------------------------------------------- |
| Статус    | принято                                                         |
| Дата      | 2026-11-17                                                      |
| Связанные | ADR-0010, ADR-0013, `docs/03-architecture/vendor-auth.md`, R-46 |

## Контекст

PR A реализовал вендорский auth-контур на Fastify: `/api/vendor-auth/*` и
`/v1/vendor/*`, cookie-сессии `pc-vendor.*`, обязательный TOTP. Веб-консоли
ещё нет. Консоль должна жить на отдельном origin (`VENDOR_BASE_URL`,
локально `http://localhost:3001`), API — на своём (`API_BASE_URL`, локально
`http://localhost:4000`).

Прямой вызов API из браузера делает cookie вендорской сессии third-party для
консоли: они привязаны к хосту API, а не к origin страницы. При выборе
хостинга web и API могут оказаться на разных сайтах, и `SameSite=Lax` начнёт
ломать вход. Кроме того, защищённые страницы нельзя отрендерить на сервере:
браузер не отдаст HttpOnly-cookie Next.js-серверу, а CORS нужно поддерживать
для каждого браузерного запроса.

В PR B появляются passkeys. WebAuthn ceremony выполняется с origin страницы,
поэтому `origin` плагина и `rpID` должны соответствовать origin консоли, а не
API. Reset-ссылка ведёт на страницу консоли, и токен нельзя показывать
лишним слоям.

Next.js App Router уже зафиксирован мега-планом для кабинетов M3/M5; Vite SPA
противоречил бы этому решению и добавил бы второй фронтенд-тулчейн.

## Решение

1. **Same-origin BFF в Next.js.** Браузер обращается только к origin
   консоли. Два catch-all route handler проксируют запросы в Fastify:
   `/api/vendor-auth/[...path]` → `${API_BASE_URL}/api/vendor-auth/...`
   (GET, POST) и `/v1/vendor/[...path]` → `${API_BASE_URL}/v1/vendor/...`
   (GET, POST, PATCH, DELETE). API остаётся единственной точкой
   авторизации; BFF не добавляет прав и не ослабляет guard.
2. **First-party cookie и SSR.** Better Auth выставляет cookie на origin
   консоли, поэтому они first-party и `SameSite=Lax` работает предсказуемо.
   Защищённые страницы рендерятся на сервере: server-only `getVendorMe()`
   вызывает `/v1/vendor/auth/me` с cookie из `cookies()` и `cache: "no-store"`,
   а `ConsoleGuard` делает redirect или показывает недоступность сервиса.
3. **Узкий контракт BFF.** Разрешены только пути из двух префиксов; сегменты
   проверяются по `^[A-Za-z0-9._~-]+$` без `.` и `..`. Query-строка — не
   больше 8 KiB, тело — не больше 64 KiB. В API-forward уходят только
   `cookie`, `content-type`, `accept`, `origin`, `user-agent`, `x-request-id`,
   `idempotency-key`. Ответ копирует `content-type`, `content-disposition`,
   `x-request-id` и **все** `Set-Cookie`; для всех ответов ставится
   `cache-control: no-store`. Небезопасные методы при наличии `Origin`
   проверяют его на собственный origin BFF; отсутствие заголовка
   допускается. Таймаут — 15 секунд, сеть/таймаут — 502
   `upstream_unavailable`.
4. **Passkey origin и rpID.** Плагин `@better-auth/passkey` получает
   `origin: [VENDOR_BASE_URL]` и `rpID` из `VENDOR_WEBAUTHN_RP_ID`: это хост
   консоли без схемы, порта и пути. Локально — `localhost`; вне local
   переменная обязательна и должна совпадать с хостом `VENDOR_BASE_URL` или
   быть его родительским доменом. Challenge-cookie —
   `pc-vendor-passkey`; BFF пропускает её через `Set-Cookie`.
5. **Resident key обязателен.** `signIn.passkey` в PR B usernameless: вход
   не передаёт email и `allowCredentials`, поэтому нужен discoverable
   credential. `authenticatorSelection` требует `userVerification: "required"`
   и `residentKey: "required"`; non-discoverable cross-platform ключи не
   поддерживаются как passkeys. Passkey остаётся дополнительным способом:
   TOTP обязателен.
6. **Gate до TOTP.** Пока TOTP не включён, прокси отвечает 403
   `vendor_mfa_required` на управление passkeys, `change-password`,
   `revoke-session` и `revoke-other-sessions`. Иначе украденный пароль давал
   бы DoS владельцу до сброса MFA. Passkey-вход
   (`generate-authenticate-options`, `verify-authentication`) и `sign-out` не
   гейтятся. Тот же gate проверяет статус: `suspended`/`disabled` → 403
   `vendor_inactive`.
7. **Заголовки и CSP.** Базовые заголовки выставляет `next.config.ts`:
   `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`, `Permissions-Policy`, `COOP`; HSTS — только вне
   local. CSP с nonce — отдельный follow-up, чтобы не ломать inline-скрипты
   Next.js.
8. **Без миграции БД.** Таблица `vendor_auth_passkeys` создана в `0006` и уже
   совпадает со схемой плагина. PR B не меняет схему, RLS и гранты.

## Последствия

- Плюс: браузер работает с одним origin; cookie first-party, CORS для
  браузера не нужен, SSR защищённых страниц возможен.
- Плюс: passkey ceremony идёт с origin консоли, совпадающего с
  `VENDOR_BASE_URL`; reset-страница может безопасно прочитать токен и убрать
  его из адресной строки.
- Минус: появляется прокси-слой, который нужно держать узким. Whitelist
  путей и заголовков, лимиты 8 KiB/64 KiB, origin-check и 502 — часть
  контракта, а не деталь реализации.
- Минус: per-IP лимиты API за BFF видят egress-IP BFF и становятся
  instance-global. Для 4–10 вендорских сотрудников это приемлемо; первичная
  защита — per-email 5/60, lockout и общий rate-limit store. Доверенный
  client IP требует выбора хостинга и подписи заголовка — follow-up.
- Минус: аудит-события за BFF фиксируют egress-IP BFF, а не клиентский. Риск
  записан в threat model; корреляция — по `x-request-id`, логам и lockout.
- Минус: passkey работает только на каноническом origin. Preview-домены и
  смена `VENDOR_BASE_URL` без перерегистрации ключей не подходят. Resident
  key отсекает часть cross-platform ключей; это осознанный компромисс.
- Минус: полноценный CSP и trusted client IP отложены; базовые заголовки не
  заменяют CSP.
- Rollback: откат web-деплоя возвращает headless-контур PR A. Passkey-строки
  остаются в БД, вход по password+TOTP продолжает работать; env
  `VENDOR_WEBAUTHN_RP_ID` остаётся заданным.

## Альтернативы

- **Прямой вызов API из браузера.** Меньше кода и уже настроенные CORS, но
  нет SSR защищённых страниц; cookie привязаны к хосту API, а при разных
  сайтах `SameSite=Lax` ломает сессию; CORS-заголовки нужно поддерживать для
  каждого браузерного запроса. Отклонено.
- **Vite SPA.** Проще сборка, но противоречит зафиксированному Next.js App
  Router, который нужен кабинетам M5; второй фронтенд-тулчейн. Отклонено.
- **Только edge reverse proxy.** Ноль кода BFF, но требует инфраструктуры в
  каждом окружении; локально и в preview всё равно нужен прокси, а
  разработка становится зависимой от хостинга. Отклонено.
- **Открытый BFF-прокси.** Любой путь и заголовок наружу превращает консоль
  в обход API-проверок и open proxy. Отклонено: только два префикса,
  whitelist заголовков, лимиты и origin-check.

## Детали

Полный дизайн, экраны, gate, аудит, E2E и этапы — в
`docs/03-architecture/vendor-auth.md`; контракт прокси — в
`docs/03-architecture/api.md`. Дизайн PR B —
`docs/superpowers/specs/2026-11-16-vendor-console-pr-b-design.md`.
