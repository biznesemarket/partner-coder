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

### Security

- Обновлены зависимости с известными уязвимостями: `vitest` 4.1.12
  (устраняет critical `tinypool` и moderate `@vitest/mocker`), `nodemailer`
  10.5.0 (high/moderate advisories), `zod` 4.6.7 во всех пакетах (high);
  `z.record` и defaults переведены на API Zod 4. Остались три moderate
  транзитивных advisory в tooling-цепочках OTel GCP detector и drizzle-kit.

### Notes

- Лицензия — source-available; финальный текст за юристом.
- Passkeys/2FA: схема готова, плагины включаются позже.
- Общий rate-limit store и per-email лимит — M6.
- M3–M11 не реализованы: см. `docs/05-process/development-process.md`.
