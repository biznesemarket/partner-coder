import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { latestResetToken } from "./mailpit";
import { ADMIN_CREDENTIALS, ADMIN_STORAGE_STATE, AUTH_DIR } from "./state";
import { totpFromUri, totpRemainingMs } from "./totp";

const RESET_SENT_TEXT = "Если адрес зарегистрирован, письмо со ссылкой отправлено.";

const TOTP_MIN_REMAINING_MS = 5_000;

export type AdminCredentials = {
  readonly email: string;
  readonly password: string;
  readonly totpUri: string;
};

function ensureAuthDir(): void {
  mkdirSync(AUTH_DIR, { recursive: true });
}

/** Удаляет артефакты прошлого прогона, чтобы setup не оставил протухшую сессию. */
export function resetSavedAuthState(): void {
  rmSync(AUTH_DIR, { recursive: true, force: true });
}

export function saveAdminCredentials(credentials: AdminCredentials): void {
  ensureAuthDir();
  writeFileSync(ADMIN_CREDENTIALS, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/** Читает email/пароль/TOTP URI, сохранённые setup-проектом. */
export function loadAdminCredentials(): AdminCredentials {
  if (!existsSync(ADMIN_CREDENTIALS)) {
    throw new Error(
      `Нет ${ADMIN_CREDENTIALS}: setup-проект Playwright не завершился. Запустите pnpm test:e2e.`,
    );
  }

  const parsed = JSON.parse(readFileSync(ADMIN_CREDENTIALS, "utf8")) as Partial<AdminCredentials>;

  if (
    typeof parsed.email !== "string" ||
    typeof parsed.password !== "string" ||
    typeof parsed.totpUri !== "string"
  ) {
    throw new Error(`Повреждён ${ADMIN_CREDENTIALS}: ожидались email, password и totpUri`);
  }

  return { email: parsed.email, password: parsed.password, totpUri: parsed.totpUri };
}

export async function saveAdminStorageState(page: Page): Promise<void> {
  ensureAuthDir();
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
}

async function requestResetLink(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Забыли пароль?" }).click();
  await page.locator("#forgot-email").fill(email);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByRole("status")).toContainText(RESET_SENT_TEXT, { timeout: 30_000 });

  return latestResetToken(email);
}

async function resetToken(page: Page, email: string): Promise<string> {
  try {
    return await requestResetLink(page, email);
  } catch (firstError) {
    try {
      return await requestResetLink(page, email);
    } catch (secondError) {
      throw new AggregateError(
        [firstError, secondError],
        `Mailpit: не удалось получить ссылку сброса для ${email}`,
        { cause: firstError },
      );
    }
  }
}

/**
 * Полный сброс пароля через Mailpit: запрос письма, переход по токену и
 * установка нового пароля. Контекст должен быть без активной сессии, иначе
 * `/login` уведёт в консоль.
 */
export async function setPasswordViaReset(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const token = await resetToken(page, email);

  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  await page.locator("#reset-password-new").fill(password);
  await page.locator("#reset-password-confirm").fill(password);
  await page.getByRole("button", { name: "Установить пароль" }).click();
  await expect(page.getByText("Пароль установлен", { exact: true })).toBeVisible();
}

/**
 * Свежий TOTP-код: если окно вот-вот сменится, ждём следующий, чтобы сервер
 * не получил протухшее значение. Без page.sleep в happy path.
 */
export async function freshTotpCode(uri: string): Promise<string> {
  const remaining = totpRemainingMs(uri);

  if (remaining < TOTP_MIN_REMAINING_MS) {
    await delay(remaining + 250);
  }

  return totpFromUri(uri);
}

/**
 * Вход в консоль по паролю и TOTP. Код генерируется из сохранённого URI.
 */
export async function loginWithTotp(page: Page, credentials: AdminCredentials): Promise<void> {
  await page.goto("/login");
  await page.locator("#login-email").fill(credentials.email);
  await page.locator("#login-password").fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  await expect(page.locator("#login-code")).toBeVisible();

  await page.locator("#login-code").pressSequentially(await freshTotpCode(credentials.totpUri));
  await page.getByRole("button", { name: "Подтвердить" }).click();

  await page.waitForURL((url) => url.pathname === "/me");
}

/** Выход из консоли через меню пользователя в шапке. */
export async function logoutViaUserMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Меню пользователя/ }).click();
  await page.getByRole("menuitem", { name: "Выйти" }).click();
  await page.waitForURL((url) => url.pathname === "/login");
}
