import { expect, test } from "@playwright/test";

import { loadAdminCredentials, loginWithTotp } from "./helpers/auth";

const WRONG_PASSWORD = "definitely wrong password";

// Сброс пароля и включение TOTP покрывает setup-проект: здесь проверяем только
// вход уже настроенного админа и ошибку неверного пароля.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("вендорская аутентификация", () => {
  test.setTimeout(120_000);

  test("вход по паролю и TOTP ведёт в /me", async ({ page }) => {
    const credentials = loadAdminCredentials();

    await loginWithTotp(page, credentials);

    await expect(page.getByRole("heading", { name: "Профиль", level: 1 })).toBeVisible();
    await expect(page.locator("dd").filter({ hasText: credentials.email })).toHaveText(
      credentials.email,
    );
  });

  test("показывает русскую ошибку при неверном пароле", async ({ page }) => {
    const credentials = loadAdminCredentials();

    await page.goto("/login");
    await page.locator("#login-email").fill(credentials.email);
    await page.locator("#login-password").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();

    await expect(page.getByText("Неверный email или пароль", { exact: true })).toBeVisible();
  });
});
