# Staging

Статус: конфигурация и чек-лист готовы; фактический деплой ждет выбора
хостинга/региона и managed PostgreSQL (открытые вопросы мега-плана §14).
Провижининг ролей и ограничения managed PG — в
[`managed-postgres.md`](./managed-postgres.md).

## Состав

| Компонент  | Требование                                                                 |
| ---------- | -------------------------------------------------------------------------- |
| API        | 1 инстанс Fastify, TLS на edge, `/healthz`, `/readyz`                      |
| Web        | Next.js консоль, HTTPS, same-origin BFF, `API_BASE_URL` доступен с сервера |
| Worker     | 1 инстанс, те же образы/секреты, отдельный `WORKER_METRICS_PORT`           |
| PostgreSQL | managed PG 17, отдельная БД, PITR, daily backup                            |
| SMTP       | отдельный ящик с SPF/DKIM/DMARC                                            |
| S3         | отдельный bucket, приватный, versioning                                    |

## Переменные

Обязательные: `APP_ENV=staging`, `DATABASE_URL`, `AUTH_DATABASE_URL`,
`AUTH_SECRET` (>= 32 байт), `API_BASE_URL`, `WEB_BASE_URL`,
`VENDOR_DATABASE_URL`, `VENDOR_AUTH_DATABASE_URL`, `VENDOR_AUTH_SECRET`
(>= 32 байт, не равен `AUTH_SECRET`), `VENDOR_BASE_URL`,
`VENDOR_WEBAUTHN_RP_ID`, `AUTH_TRUSTED_PROXIES`, `SMTP_*`, `S3_*`.

Вендорский контур (ADR-0013): `VENDOR_SESSION_TTL_HOURS=8`,
`VENDOR_PASSWORD_RESET_TTL_MINUTES=30`, `VENDOR_PASSWORD_MIN_LENGTH=12`
(допустимые диапазоны 1…24, 5…120, 12…64). `VENDOR_BASE_URL` — origin
консоли без path/query/fragment: локально `http://localhost:3001`, в staging —
только `https://` с реальным доменом консоли. Вне local значение обязательно.

`VENDOR_WEBAUTHN_RP_ID` — канонический хост консоли **без схемы, порта и
пути** (например, `admin.pcoder.ru`), не origin. Он должен совпадать с
хостом `VENDOR_BASE_URL` или быть его родительским доменом
(`pcoder.ru` для `admin.pcoder.ru`); иначе API не стартует.
Passkeys привязаны к origin и rpID: смена домена или порта требует
перерегистрации ключей, preview-домены для passkeys не подходят.

Web-сервер (Next.js, ADR-0014) обслуживает только origin консоли и
проксирует `/api/vendor-auth/*` и `/v1/vendor/*` в API. Ему нужны
`API_BASE_URL` и `VENDOR_BASE_URL`; `API_BASE_URL` должен быть доступен **с
Next-сервера** (внутренняя сеть), а не обязательно из браузера. Браузер
ходит только в `VENDOR_BASE_URL`, поэтому CORS для консоли не нужен; если
`API_CORS_ORIGINS` задан явно, он должен включать `VENDOR_BASE_URL`.
WebAuthn требует HTTPS (кроме `localhost`), поэтому staging-консоль
публикуется по HTTPS; HSTS включается при сборке, когда `APP_ENV=staging`
(значение считывается в `next.config.ts` на этапе `pnpm build` и попадает в
build-манифест — задать только на runtime недостаточно).

BFF видит egress-IP web-сервера: per-IP лимиты API и audit IP становятся
общими на инстанс, пока не передан доверенный client IP (follow-up). CSP с
nonce — тоже follow-up; сейчас выставляются базовые security-заголовки.

Rate limit: вне local по умолчанию используется общий PostgreSQL-store;
`RATE_LIMIT_STORAGE=database` можно задать явно, `memory` — только для
диагностики на одном инстансе (ADR-0012).

Наблюдаемость: `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL=info`.
Метрики: `METRICS_TOKEN` (если `/metrics` доступен не только из private
network). Worker: `WORKER_METRICS_PORT=4100`, cron-переменные
`DAY_CLOSE_CRON`, `AUDIT_ANCHOR_CRON`, `TTL_CLEANUP_CRON`.

## Секрет вендорского auth

`VENDOR_AUTH_SECRET` (>= 32 байт, не равен `AUTH_SECRET`) шифрует TOTP-секреты
и backup-коды в `vendor_auth_two_factors` и подписывает вендорские сессии.
Храните его только в секрет-менеджере и включите в тот же backup/PITR-контур,
что и БД: без секрета существующие TOTP и backup-коды не читаются.

Ротация — плановая операция: новый секрет делает сохранённые TOTP-секреты
нерасшифровываемыми, поэтому после смены всем вендорам нужно заново
зарегистрировать TOTP (старые сессии также станут невалидны). Порядок:
объявить окно, сменить секрет, раздать reset через вход по паролю, проверить
`vendor:admin` и `verify_vendor_audit_chain()`.

## Сбой SMTP

Если SMTP недоступен при приглашении, пользователь остаётся в статусе
`invited`, письмо не уходит, API отвечает ошибкой отправки. Повторный
`POST /v1/vendor/users` для того же `invited` пользователя или
`POST /v1/vendor/users/:id/reset-password` переотправляет ссылку. Пароль и
TOTP при этом не меняются; `vendor.user.invited`/`password_reset_requested`
пишутся в аудит по факту запроса.

## Роли БД

1. Провижининг создает `NOLOGIN`-роли `partner_coder_api`,
   `partner_coder_vendor`, `partner_coder_vendor_auth`,
   `partner_coder_worker`, `partner_coder_auth`,
   `partner_coder_retention` и login-роли приложений.
2. API login состоит только в `partner_coder_api`; auth login — только в
   `partner_coder_auth`; vendor login — только в `partner_coder_vendor`;
   vendor-auth login — только в `partner_coder_vendor_auth`; worker login —
   в `partner_coder_worker` (BYPASSRLS). **Worker login должен иметь
   `BYPASSRLS` собственным атрибутом:** членство в роли этот атрибут не
   наследует (проверено на PostgreSQL 17), а worker не делает `SET ROLE`.
   Старт worker вне local проверяет и членство, и `BYPASSRLS`. Смешение
   ролей, superuser и чужое членство вне `local` роняют старт API и worker.
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
7. Managed PG: миграция `0001` всегда выполняет
   `ALTER ROLE partner_coder_worker BYPASSRLS`, поэтому провайдер должен
   разрешать этот шаг (в stock PostgreSQL — superuser). `ALTER FUNCTION ...
OWNER TO` требует членства мигратора в роли-владельце и `CREATE` на схему
   `public`. Проверить до оплаты тарифа; детали и SQL — в
   [`managed-postgres.md`](./managed-postgres.md).

## Порядок выката

```bash
pnpm db:migrate
pnpm db:check
pnpm build
pnpm --filter @partner-coder/seed seed   # только синтетический tenant
pnpm --filter @partner-coder/api start
pnpm --filter @partner-coder/worker start
pnpm --filter @partner-coder/web start
```

Миграции применяются до старта новых инстансов; worker можно запускать после
API, web — после API (BFF должен видеть `API_BASE_URL`). При откате —
предыдущий образ и совместимая схема; destructive-миграции запрещены. Откат
web возвращает headless-контур PR A: password+TOTP работает, passkey-строки
сохраняются.

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

Ссылка ведёт на `/reset-password` консоли. Для smoke откройте её, установите
пароль, войдите, включите TOTP на `/setup-mfa` и добавьте passkey на
`/me/security` (HTTPS + канонический origin). Альтернатива без браузера:
возьмите `token` из письма в Mailpit/SMTP и вызовите
`POST /api/vendor-auth/reset-password` с `{ token, newPassword }`; затем
`POST /api/vendor-auth/sign-in/email`, включите TOTP через
`/api/vendor-auth/two-factor/enable` и подтвердите `verify-totp`.

## Smoke

```bash
curl -fsS https://staging-api.pcoder.ru/healthz
curl -fsS https://staging-api.pcoder.ru/readyz
curl -fsS https://staging-api.pcoder.ru/openapi.json > /dev/null
curl -fsS https://staging-api.pcoder.ru/metrics | head
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
