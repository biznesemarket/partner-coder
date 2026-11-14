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

### Notes

- Лицензия — source-available; финальный текст за юристом.
- M2–M11 не реализованы: см. `docs/05-process/development-process.md`.
