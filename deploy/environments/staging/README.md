# Staging

Статус: конфигурация и чек-лист готовы; фактический деплой ждет выбора
хостинга/региона и managed PostgreSQL (открытые вопросы мега-плана §14).

## Состав

| Компонент  | Требование                                                       |
| ---------- | ---------------------------------------------------------------- |
| API        | 1 инстанс Fastify, TLS на edge, `/healthz`, `/readyz`            |
| Worker     | 1 инстанс, те же образы/секреты, отдельный `WORKER_METRICS_PORT` |
| PostgreSQL | managed PG 17, отдельная БД, PITR, daily backup                  |
| SMTP       | отдельный ящик с SPF/DKIM/DMARC                                  |
| S3         | отдельный bucket, приватный, versioning                          |

## Переменные

Обязательные: `APP_ENV=staging`, `DATABASE_URL`, `AUTH_DATABASE_URL`,
`AUTH_SECRET` (>= 32 байт), `API_BASE_URL`, `WEB_BASE_URL`,
`VENDOR_DATABASE_URL`, `VENDOR_AUTH_DATABASE_URL`, `VENDOR_AUTH_SECRET`
(>= 32 байт, не равен `AUTH_SECRET`), `VENDOR_BASE_URL`,
`AUTH_TRUSTED_PROXIES`, `SMTP_*`, `S3_*`.

Вендорский контур (ADR-0013): `VENDOR_SESSION_TTL_HOURS=8`,
`VENDOR_PASSWORD_RESET_TTL_MINUTES=30`, `VENDOR_PASSWORD_MIN_LENGTH=12`
(допустимые диапазоны 1…24, 5…120, 12…64). `VENDOR_BASE_URL` — origin
консоли; локально `http://localhost:3001`, в staging — реальный домен
консоли. Passkeys и UI-страницы в PR A не включены; вход проверяется через
SMTP/Mailpit и HTTP, `VENDOR_WEBAUTHN_RP_ID` пока не задаётся.

Rate limit: вне local по умолчанию используется общий PostgreSQL-store;
`RATE_LIMIT_STORAGE=database` можно задать явно, `memory` — только для
диагностики на одном инстансе (ADR-0012).

Наблюдаемость: `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL=info`.
Метрики: `METRICS_TOKEN` (если `/metrics` доступен не только из private
network). Worker: `WORKER_METRICS_PORT=4100`, cron-переменные
`DAY_CLOSE_CRON`, `AUDIT_ANCHOR_CRON`, `TTL_CLEANUP_CRON`.

## Роли БД

1. Провижининг создает `NOLOGIN`-роли `partner_coder_api`,
   `partner_coder_vendor`, `partner_coder_vendor_auth`,
   `partner_coder_worker`, `partner_coder_auth`,
   `partner_coder_retention` и login-роли приложений.
2. API login состоит только в `partner_coder_api`; auth login — только в
   `partner_coder_auth`; vendor login — только в `partner_coder_vendor`;
   vendor-auth login — только в `partner_coder_vendor_auth`; worker login —
   в `partner_coder_worker` (BYPASSRLS). Смешение ролей, superuser и чужое
   членство вне `local` роняют старт API и worker.
3. Worker login должен уметь создать/владеть схемой `pgboss` (или схема
   создается миграцией/администратором заранее).
4. Retention-функция `retention_delete_heartbeats` принадлежит
   `partner_coder_retention`; worker получает только `EXECUTE`.
5. Миграция `0005` создает `auth_rate_limits` (только auth-роль) и
   `email_rate_limits` (API-роль + worker для очистки); проверить гранты
   после переноса ролей на managed PostgreSQL.
6. Миграция `0006` создает `partner_coder_vendor_auth`, семь таблиц
   `vendor_auth_*`, функцию `vendor_audit()` и права worker на TTL-очистку.
   `partner_coder_vendor` не видит `vendor_auth_*`; API/auth не видят
   вендорский контур. RLS на вендорских таблицах отсутствует по решению
   ADR-0013.

## Порядок выката

```bash
pnpm db:migrate
pnpm db:check
pnpm --filter @partner-coder/seed seed   # только синтетический tenant
pnpm --filter @partner-coder/api start
pnpm --filter @partner-coder/worker start
```

Миграции применяются до старта новых инстансов; worker можно запускать после
API. При откате — предыдущий образ и совместимая схема; destructive-миграции
запрещены.

## Bootstrap вендорского суперадминистратора

На пустой staging/prod БД нет ни одного вендора, поэтому первый
суперадминистратор создаётся ops-инструментом (без UI):

```bash
pnpm --filter @partner-coder/api vendor:admin -- --email ops@example.com --name "Ops"
```

CLI использует `VENDOR_DATABASE_URL`/`VENDOR_AUTH_DATABASE_URL`, создаёт
пользователя в статусе `invited`, отправляет одноразовую ссылку через SMTP и
пишет `vendor.user.bootstrap_admin` с actor `NULL`. Пароль и токен не
печатаются. На пустой БД `--force` не нужен; повторный запуск для того же
`invited` superadmin идемпотентен и переотправляет ссылку. Если superadmin уже
существует, без `--force` CLI откажется; активного/suspended/disabled
пользователя `--force` не сбрасывает — статус меняется через
`PATCH /v1/vendor/users/:id` из консоли/API.

Ссылка ведёт на `/reset-password` консоли, которой в PR A ещё нет. Для smoke
возьмите `token` из письма в Mailpit/SMTP и вызовите
`POST /api/vendor-auth/reset-password` с `{ token, newPassword }`; затем
`POST /api/vendor-auth/sign-in/email`, включите TOTP через
`/api/vendor-auth/two-factor/enable` и подтвердите `verify-totp`.

## Smoke

```bash
curl -fsS https://staging-api.partnercoder.ru/healthz
curl -fsS https://staging-api.partnercoder.ru/readyz
curl -fsS https://staging-api.partnercoder.ru/openapi.json > /dev/null
curl -fsS https://staging-api.partnercoder.ru/metrics | head
```

Затем: OTP через Mailpit/SMTP → `/v1/auth/me` → `/v1/tenant/overview` →
`/v1/tenant/projects` → `/v1/tenant/days`; ручной запуск `day-close` и
`audit-anchor` из pg-boss UI/CLI, проверка метрик worker и Sentry.

Вендорский smoke: `vendor:admin` → reset-токен из письма → сброс пароля →
вход → TOTP → `GET /v1/vendor/auth/me` (`role=superadmin`,
`twoFactorEnabled=true`) → `GET /v1/vendor/users`. Suspended-пользователь
должен получить 403 `VENDOR_INACTIVE` на входе, а `reset-mfa` — удалить TOTP
и отозвать сессии.

## Ограничения

- Пока не выбран хостинг, workflow staging не включен.
- Общий rate-limit store включен вне local (ADR-0012); глобальный лимит
  Fastify остается на инстанс, распределенный edge/WAF — при выборе хостинга.
- Сертификат подписи Windows и GitHub App не входят в staging.
