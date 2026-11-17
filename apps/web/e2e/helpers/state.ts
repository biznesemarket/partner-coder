import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Каталог gitignored-состояния Playwright: сессия админа и его креды. */
export const AUTH_DIR = fileURLToPath(new URL("../.auth/", import.meta.url));

export const ADMIN_STORAGE_STATE = resolve(AUTH_DIR, "admin.json");

export const PASSKEY_STORAGE_STATE = resolve(AUTH_DIR, "passkey.json");

export const ADMIN_CREDENTIALS = resolve(AUTH_DIR, "credentials.json");
