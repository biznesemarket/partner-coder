# Шаблоны пакета подключения

Шаблоны zip-пакета (M4, ADR-0004). Структура пакета:

```text
partner-coder-<slug>-<version>/
  START-HERE.html
  START-HERE.md
  AGENTS.md
  .mcp.json
  .cursor/mcp.json
  .cursor/rules/partner-coder.mdc
  .vscode/mcp.json
  .github/copilot-instructions.md
  bin/partner-coder.exe
  bin/partner-coder.exe.sha256
  bin/partner-coder-<version>.vsix
  config/package.json
  config/enrollment.key
  docs/privacy.md
  docs/onboarding.md
  docs/troubleshooting.md
```

Правила:

- `config/enrollment.key` — одноразовый токен: не печатать в чат, не коммитить.
- `START-HERE` объясняет ИИ-клиенту, что делать; `AGENTS.md` задает правила.
- `partner-coder.exe` режимы: `mcp`, `agent`, `setup`, `doctor`, `version`.
- Пакет подписан; hash и версия видны в консоли суперадмина.

Реализация генератора — `tools/package-builder` (M4).
