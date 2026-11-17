# apps/web — вендорская консоль и кабинеты

Next.js App Router. В M3 PR B — вендорская консоль на
`http://localhost:3001`: `/login`, `/reset-password`, `/setup-mfa`, `/me`,
`/me/security` и общий шелл. Кабинеты директора и разработчика появятся в M5.

## Скрипты

```bash
pnpm --filter @partner-coder/web dev        # next dev --port 3001
pnpm --filter @partner-coder/web build      # next build
pnpm --filter @partner-coder/web start      # next start --port 3001
pnpm --filter @partner-coder/web typecheck
pnpm --filter @partner-coder/web test:e2e   # Playwright
```

Корневые `pnpm test:e2e` и `pnpm test:e2e:full` дополнительно готовят
`partner_coder_e2e`, применяют миграции и проверяют артефакты сборки. Подробно
— `docs/00-start/quickstart.md` и `docs/05-process/quality-gates.md`.

## Окружение

Серверные route handlers и server guard читают:

| Переменная        | Назначение                                                     |
| ----------------- | -------------------------------------------------------------- |
| `API_BASE_URL`    | цель BFF, например `http://localhost:4000`; нужен Next-серверу |
| `VENDOR_BASE_URL` | origin консоли, например `http://localhost:3001`               |

Next не подхватывает корневой `.env`; локально создайте
`apps/web/.env.local` (gitignored). `NEXT_PUBLIC_*` не используются: auth
client берёт `window.location.origin`, а секреты и cookie остаются на сервере.
`VENDOR_WEBAUTHN_RP_ID` — переменная API, не web.

## BFF

Браузер ходит только в origin консоли. Два catch-all route handler:

- `/api/vendor-auth/[...path]` → `${API_BASE_URL}/api/vendor-auth/...`
  (GET, POST);
- `/v1/vendor/[...path]` → `${API_BASE_URL}/v1/vendor/...`
  (GET, POST, PATCH, DELETE).

Прокси (`src/lib/proxy.ts`) валидирует сегменты пути, ограничивает query
8 KiB и body 64 KiB, пробрасывает whitelist заголовков, копирует все
`Set-Cookie`, ставит `cache-control: no-store`, проверяет `Origin` для
небезопасных методов и отвечает 502 `upstream_unavailable` при
сети/таймауте. API остаётся единственной точкой авторизации; BFF не добавляет
прав. Server guard (`src/lib/vendor-api.ts`) вызывает
`/v1/vendor/auth/me` с cookie из `cookies()` и различает
`ok | unauthenticated | inactive | error`. Контракт и ограничения — ADR-0014
и `docs/03-architecture/api.md`.

## UI и E2E

Примитивы, токены и тема — в `@partner-coder/ui`; глобальный CSS и
Tailwind-скан — здесь (`src/app/globals.css`, `@source` на
`packages/ui/src`). Строки UI — в `src/lib/messages.ts`. Клиентские проверки
дают только UX; безопасность остаётся в API.

E2E — Playwright 1.65.1, только Chromium с CDP virtual authenticator:
PostgreSQL и Mailpit должны быть запущены, `apps/api/dist` и `apps/web/.next`
собраны. Набор покрывает сброс пароля, TOTP, добавление passkey, passkey-вход,
негативные ошибки и axe-проверки; подробности — в
`docs/05-process/quality-gates.md`.
