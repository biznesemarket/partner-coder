import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { latestResetToken } from "./helpers/mailpit";
import { totpFromUri } from "./helpers/totp";

const ADMIN_EMAIL = "e2e-superadmin@example.test";

const ADMIN_PASSWORD = "correct horse battery staple e2e";

const WRONG_PASSWORD = "definitely wrong password";

const RESET_SENT_TEXT = "Если адрес зарегистрирован, письмо со ссылкой отправлено.";

async function requestResetLink(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Забыли пароль?" }).click();
  await page.locator("#forgot-email").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByRole("status")).toContainText(RESET_SENT_TEXT, { timeout: 30_000 });

  return latestResetToken(ADMIN_EMAIL);
}

async function resetToken(page: Page): Promise<string> {
  try {
    return await requestResetLink(page);
  } catch {
    return await requestResetLink(page);
  }
}

test.describe.serial("вендорская аутентификация", () => {
  test.setTimeout(180_000);

  test("сброс пароля, вход и включение TOTP ведут в /me", async ({ page }) => {
    const token = await resetToken(page);
    await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
    await page.locator("#reset-password-new").fill(ADMIN_PASSWORD);
    await page.locator("#reset-password-confirm").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Установить пароль" }).click();
    await expect(page.getByText("Пароль установлен", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Перейти ко входу" }).click();
    await page.locator("#login-email").fill(ADMIN_EMAIL);
    await page.locator("#login-password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();

    await page.waitForURL((url) => url.pathname === "/setup-mfa");
    await expect(
      page.getByRole("heading", { name: "Настройка двухфакторной аутентификации" }),
    ).toBeVisible();

    const enableResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/two-factor/enable") && response.request().method() === "POST",
    );
    await page.locator("#setup-mfa-password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Продолжить" }).click();

    const enableResponse = await enableResponsePromise;
    expect(enableResponse.status()).toBe(200);

    const enrollment = (await enableResponse.json()) as {
      totpURI: string;
      backupCodes: string[];
    };

    expect(enrollment.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.backupCodes).toHaveLength(10);

    await expect(page.getByRole("heading", { name: "Шаг 2. Добавьте аккаунт" })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Резервные коды" }).getByRole("listitem"),
    ).toHaveCount(10);

    await page.locator("#setup-mfa-saved").click();
    await expect(page.locator("#setup-mfa-saved")).toHaveAttribute("data-state", "checked");

    await page.getByRole("button", { name: "Продолжить" }).click();
    await expect(page.getByRole("heading", { name: "Шаг 3. Подтвердите код" })).toBeVisible();

    await page.locator("#setup-mfa-code").pressSequentially(totpFromUri(enrollment.totpURI));
    await page.getByRole("button", { name: "Завершить настройку" }).click();

    await page.waitForURL((url) => url.pathname === "/me");
    await expect(page.getByRole("heading", { name: "Профиль", level: 1 })).toBeVisible();
    await expect(page.locator("dd").filter({ hasText: ADMIN_EMAIL })).toHaveText(ADMIN_EMAIL);
  });

  test("показывает русскую ошибку при неверном пароле", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#login-email").fill(ADMIN_EMAIL);
    await page.locator("#login-password").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();

    await expect(page.getByText("Неверный email или пароль", { exact: true })).toBeVisible();
  });
});
