# apps/mcp — локальный MCP-сервер и агент (M4, M6)

Режимы одного бинарника: `mcp`, `agent`, `setup`, `doctor`, `version`.
Enrollment одноразового ключа, device key (Ed25519, DPAPI), сессии,
heartbeat батчами, дайджест, диагностика.

Сборка: Bun compile в один `.exe` (ADR-0004). Каркас — M4.
