import { rmSync } from "node:fs";

import { AUTH_DIR } from "../helpers/state";

/**
 * Убирает сохранённые сессию и TOTP-секрет после прогона: это локальные
 * тестовые данные, но хранить их дольше одного запуска не нужно.
 */
export default function globalTeardown(): void {
  rmSync(AUTH_DIR, { recursive: true, force: true });
}
