# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версии — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

### Added

- Монорепозиторий pnpm + Turborepo, strict TypeScript, ESLint/Prettier, Vitest.
- `@partner-coder/domain`: политика (Zod + V-01…V-08), часовые пояса и DST,
  классы времени, union, капы, калькулятор дня, экономика (amount/cash/equity/
  share), пул и pending, вестинг, дерево объяснения, канонический хеш входа.
- Golden-фикстуры T-01…T-12 и E-01…E-08 (`fixtures/golden/scenarios.json`),
  `golden.test.ts`, property-тесты на инварианты.
- `@partner-coder/config`: валидация окружения через Zod.
- `@partner-coder/contracts`: конверт ошибок, health, коды доменных ошибок.
- `apps/api`: каркас Fastify (requestId, конверт ошибок, `/healthz`, `/readyz`).
- Нормативные спецификации `docs/02-domain/*`, ADR-0001…0008,
  модель угроз, процесс разработки и quality gates.
- CI: install, format, lint, typecheck, тесты, build; CodeQL; Dependabot.
- Docker Compose: PostgreSQL 17, Mailpit, MinIO; `.env.example`.
- M2.1: Drizzle-схема вендорского и тенантского контуров (40 таблиц),
  миграции, ограничения и индексы; RLS-роли `partner_coder_api`,
  `partner_coder_vendor`, `partner_coder_worker`; `SET LOCAL app.tenant_id`;
  append-only триггеры; хеш-цепочка аудита и дневные якоря; идемпотентность
  через `Idempotency-Key`; детерминированный seed (вендор, клиент, проект,
  политика, 3 разработчика, 5 закрытых дней); интеграционные тесты на
  PostgreSQL в CI.
- M2.2: Better Auth (email OTP и magic link, хеширование OTP/magic-link
  токенов), роль `partner_coder_auth` и auth-таблицы; приглашения с TTL,
  HMAC-хешем и одной активацией; device-токены `pcd_…` с хешем, TTL,
  привязкой к устройству, ротацией/каскадным отзывом и self-service
  ограничениями; матрица авторизации director/developer/finance/support и
  правило выдачи ролей; блокировка suspended/archived tenant; стартовая
  проверка разделения ролей БД; Fastify middleware, отказы в аудите отдельной
  транзакцией; E2E-тест входа, выбора tenant, приглашения, device-токена,
  suspension и эскалации роли.
- M2.3: worker на pg-boss (скан и закрытие дня с advisory-lock, catch-up по
  timezone, идемпотентность `input_hash`, компенсации, DLQ/retry), дневные
  якоря аудита после проверки цепочек, TTL-очистка ключей/OTP/сессий,
  отзыв device-токенов и сессий suspended tenant/пользователей, retention
  heartbeat через отдельную роль; per-email лимит OTP/magic-link; проверка
  роли worker при старте; pino-редакция токенов, request id, Prometheus-метрики,
  опциональные OTel/Sentry, CORS и security-заголовки; OpenAPI 3.1 из Zod-схем,
  `/openapi.json` и генерация типов клиента; tenant-маршруты проектов и закрытых
  дней; staging-чек-лист и ADR-0011.
- M6-подготовка: общий rate-limit store в PostgreSQL (`auth_rate_limits` для
  Better Auth и `email_rate_limits` для OTP/magic-link), атомарное окно
  per-email, memory-fallback при сбое БД, TTL-очистка worker-ом; вне local
  включается по умолчанию, `RATE_LIMIT_STORAGE` переопределяет выбор
  (ADR-0012).
- M3 PR A — вендорская аутентификация (ADR-0013): отдельный Better Auth
  `/api/vendor-auth` (email + password + обязательный TOTP), таблицы
  `vendor_auth_*`, роль `partner_coder_vendor_auth`, функция `vendor_audit()`;
  приглашения и создание вендорских пользователей (`superadmin`, `finance`,
  `support`, `readonly`), одноразовые reset-ссылки, TOTP/passkeys-сброс,
  блокировка suspended/disabled с отзывом сессий, step-up, origin guard,
  per-email и общий rate limit, worker TTL, bootstrap CLI
  `vendor:admin`, seed без пароля и credential-строк; E2E на реальном Fastify
  и Better Auth, OpenAPI drift, документация и ledger R-45. Passkeys и UI
  отложены в PR B; tenant-auth не менялся.
- M3 PR B — вендорская консоль (ADR-0014): `@better-auth/passkey` 1.7.25
  с resident key и origin консоли, регистрация/вход/список/удаление
  passkeys, обязательный TOTP; gate до TOTP для управления passkeys,
  смены пароля и отзыва сессий; аудит `vendor.passkey.added/removed/renamed`.
  Next.js App Router в `apps/web`: `/login`, `/reset-password`,
  `/setup-mfa`, `/me`, `/me/security`, общий шелл и тема; same-origin BFF
  с whitelist заголовков, лимитами 8/64 KiB и origin-check; server guard и
  безопасный `returnTo`. `@partner-coder/ui`: примитивы, токены и тема.
  Playwright E2E на Chromium с виртуальным authenticator (7 тестов,
  включая setup) и необязательный CI job `e2e`. Миграции БД нет:
  `vendor_auth_passkeys` уже соответствует схеме плагина; tenant-auth не
  менялся.

### Changed

- GitHub Actions обновлены: `actions/checkout` и `actions/setup-node` v7,
  `pnpm/action-setup` v6, `github/codeql-action` v4, `gitleaks-action` v3.
- Локальный S3 в Docker Compose переведен с удаленных образов `minio/minio`
  и `minio/mc` на совместимый форк SILO (`pgsty/silo`, `pgsty/mc`); healthcheck
  и создание приватного bucket `partner-coder` проверены.
- `apps/web` из манифеста стал рабочей вендорской консолью; `packages/ui`
  собирается в `dist` (`tsc`) и используется через workspace-зависимость.
- Новый env `VENDOR_WEBAUTHN_RP_ID`: локально `localhost`, вне local
  обязателен и проверяется на формат и суффикс хоста `VENDOR_BASE_URL`.
- `pnpm test:e2e` и `pnpm test:e2e:full` дополняют проверки; `pnpm check`
  по-прежнему требует PostgreSQL.
- E2E hardening: Mailpit зафиксирован (`axllent/mailpit:v1.33.1`) и получил
  healthcheck `/readyz` в compose/CI; Playwright пишет trace
  `retain-on-failure` и выгружает отчёт/`test-results` артефактом при падении;
  E2E использует `RATE_LIMIT_STORAGE=database` и очищает окна
  `vendor_auth_rate_limits`/`vendor_auth_email_limits` перед входами, чтобы
  special-rule Better Auth 3/10 с за BFF не давал 429 вместо проверяемой
  ошибки. Job `e2e` после трёх зелёных прогонов переведён в required checks
  ruleset.
- Managed PostgreSQL runbook: `deploy/environments/staging/managed-postgres.md`
  (роли, `BYPASSRLS`, pgboss, rate-limit, retention, бэкапы). Worker при
  старте вне local теперь требует `BYPASSRLS` на самом login: членство в
  `partner_coder_worker` этот атрибут не наследует.
- Сервисные домены закреплены за `pcoder.ru`: staging `staging.pcoder.ru`,
  prod `app./admin./api.pcoder.ru`; `partnercoder.ru` — маркетинг и help.
- Зафиксированы бренд «Партнёр кодер», тарифы «Пилот/Базовый/Про»
  (10 000/15 000/25 000 ₽ в месяц, 3/5/10 мест), статусы подписки, скидки,
  роли и правила биллинга — `docs/01-product/brand.md`,
  `docs/01-product/pricing.md`, `docs/04-security/authz.md`.
- Добавлены черновики юридических документов (ToS, Privacy, DPA, согласие,
  дисклеймер, договор подписки, чек-лист 152-ФЗ, варианты лицензии) и
  предложение по retention/SLA; runbook PostgreSQL 17 на VPS MakeCloud.
- Утверждены статусы trial/grace/expired/suspended, лимиты и правило
  `support`; добавлен break-glass для восстановления единственного
  суперадминистратора.
- M3.1, первый срез: API и экраны клиентов и тарифов. `superadmin` создаёт и
  меняет; `finance`/`support`/`readonly` читают; действия пишутся в аудит;
  дубли ИНН и кода тарифа отклоняются. Экраны `/clients` и `/plans` с
  созданием записей, E2E и a11y.
- M3.1, второй срез: договоры, подписки, счета, платежи и скидки. API с
  step-up на финансовые мутации, аудит всех действий, worker
  `billing-status-scan` с автопереходами `trial/active/grace/expired` по
  календарным границам. Экраны карточки клиента, `/invoices` и `/payments`,
  step-up-диалог в консоли. Частичные оплаты и переплаты не сверяются
  автоматически — это решение бухгалтерии.
- M3.1, третий срез: пакеты подключения и дашборд. Выдача superadmin,
  перевыпуск superadmin/support, одноразовый токен `pcp_…` (в БД только
  SHA-256), сброс onboarding при выдаче, worker переводит просроченные пакеты
  в `expired`. Экраны `/packages` и `/dashboard`; карточка клиента показывает
  пакеты и позволяет выдать/перевыпустить токен. Дашборд показывает только
  счётчики по статусам, без финансовой сверки.

### Security

- UI i18n boundary: оставшиеся строки карточки клиента, списков, тарифов,
  диалогов и metadata перенесены в `apps/web/src/lib/messages.ts`. ESLint
  запрещает кириллические литералы и JSX-текст в `apps/web/src/**/*.tsx`
  вне каталога сообщений.

- `/metrics` можно ограничить по `METRICS_IP_ALLOWLIST` (CSV IP/CIDR).
  Проверка идёт по verified client IP; пустой список оставляет прежнее
  поведение. Дополнительно к `METRICS_TOKEN`.

- Добавлены staging deploy assets: Caddyfile для `staging.pcoder.ru` /
  `staging-api.pcoder.ru` (TLS, security headers, `X-Forwarded-For`
  overwrite, IP allowlist API) и hardened systemd units для API, worker и web.
  Runbook `makecloud-vps.md` дополнен установкой.

- Доверенный client IP за BFF: reverse proxy передаёт `X-Forwarded-For`,
  web подписывает первый IP HMAC-ключом `TRUSTED_CLIENT_IP_SECRET`, API
  проверяет `x-pc-client-ip`/`x-pc-client-ip-signature` и использует его в
  Better Auth, Fastify rate limit и аудите. Подделанные заголовки удаляются;
  без секрета остаётся egress-IP BFF.

- `minimatch` 10.x закреплён override на 11.0.1: закрывает dev-only
  Dependabot alert GHSA-g3hv-75wg-m249. Lint после обновления зелёный.

- Passkey recovery UX: на странице входа и в разделе безопасности добавлена
  подсказка, что при потере ключа нужно войти паролем и TOTP, затем удалить
  старый ключ; при потере TOTP MFA сбрасывает суперадминистратор. Покрыто
  E2E.

- `returnTo` больше не принимает `/login`, `/reset-password` и `/setup-mfa`:
  после входа это давало цикл редиректов. Невалидные auth-пути заменяются на
  `/me`; добавлены unit- и E2E-проверки.

- Аудит-цепочка переведена на HMAC-SHA-256 с ключом `AUDIT_HMAC_KEY` вне БД.
  Ключ передаётся в сессию PostgreSQL через connection options; запись без
  ключа отклоняется, проверка с другим ключом возвращает false. Формат
  канонизации — `v3`; прежние dev-события несовместимы (продукт не в
  продакшене).

- Reset-токены вендора хранятся только как
  `base64url(SHA-256("reset-password:<token>"))` через Better Auth
  `verification.storeIdentifier: "hashed"`. Сырой токен остаётся только в
  письме и URL; тесты проверяют отсутствие plaintext в БД.

- CSP с per-request nonce в веб-консоли: strict-dynamic для скриптов,
  запрет object/base/frame, dev-послабления только для `unsafe-eval` и
  websocket. Страницы переведены на динамический рендер через
  `connection()`, чтобы nonce не кешировался.

- Защита последнего активного суперадминистратора: смена роли/статуса
  транзакционно блокирует активных `superadmin`, пересчитывает их и возвращает
  409 `vendor_last_superadmin`. Конкурентное понижение двух администраторов
  оставляет одного; покрыто тестом с параллельными транзакциями.

- Обновлены зависимости с известными уязвимостями: `vitest` 4.1.12
  (устраняет critical `tinypool` и moderate `@vitest/mocker`), `nodemailer`
  10.5.0 (high/moderate advisories), `zod` 4.6.7 во всех пакетах (high);
  `z.record` и defaults переведены на API Zod 4.
- `pnpm.overrides` поднимают `glob` до 14.0.6 и `esbuild` до 0.28.2,
  закрывая оставшиеся moderate advisories транзитивных tooling-цепочек
  OTel GCP detector и drizzle-kit; `pnpm audit --prod` показывает 0.
- Вендорская консоль: first-party cookie через same-origin BFF, whitelist
  путей/заголовков, лимиты query 8 KiB и body 64 KiB, origin-check
  небезопасных методов, `cache-control: no-store` и 502 без upstream-деталей.
- Reset-токен: `no-referrer`, `noindex`, удаление из адресной строки после
  чтения, без аналитики и логов BFF; токен остаётся одноразовым с TTL 30
  минут.
- Passkeys не заменяют TOTP; до включения TOTP заблокированы управление
  ключами, смена пароля и отзыв сессий. CSP с nonce, trusted client IP и
  per-IP лимиты за BFF — follow-up.

### Notes

- Лицензия — source-available; финальный текст за юристом.
- Вендорская консоль M3 PR B реализована: password+TOTP+passkeys, экраны
  входа/сброса/настройки MFA/профиля/безопасности, same-origin BFF и
  Playwright E2E. Tenant-аутентификация остаётся passwordless
  (OTP/magic-link).
- Общий rate-limit store внедрен (ADR-0012); глобальный лимит Fastify
  остается на инстанс, распределенный edge/WAF — при выборе хостинга.
  За BFF per-IP лимиты и audit IP — egress BFF до появления доверенного
  client IP.
- M4–M11 не реализованы: см. `docs/05-process/development-process.md`.
