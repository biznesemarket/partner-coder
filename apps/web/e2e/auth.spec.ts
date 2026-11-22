import { expect, test } from "@playwright/test";

import { loadAdminCredentials, loginWithTotp } from "./helpers/auth";
import { clearVendorRateLimits } from "./helpers/rate-limits";

const WRONG_PASSWORD = "definitely wrong password";

// Несуществующий адрес: проверка ошибки не должна расходовать лимит
// sign-in/email зарегистрированного админа.
const UNKNOWN_EMAIL = "e2e-negative@example.test";

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

  test("не зацикливает returnTo на страницу входа", async ({ page }) => {
    const credentials = loadAdminCredentials();

    await loginWithTotp(page, credentials, "/login?returnTo=%2Flogin");

    await expect(page.getByRole("heading", { name: "Профиль", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/me$/);
  });
  test("выставляет CSP nonce и применяет его к скриптам", async ({ page }) => {
    const response = await page.goto("/login");
    const csp = response?.headers()["content-security-policy"];
    expect(csp).toContain("script-src");
    const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    const scriptNonces = await page.evaluate(() =>
      Array.from(document.scripts)
        .map((script) => script.nonce)
        .filter(Boolean),
    );
    expect(scriptNonces).toContain(nonce);
  });
  test("показывает русскую ошибку при неверном пароле", async ({ page }) => {
    // Очищаем окно sign-in/email: иначе special-rule Better Auth (3/10 с на
    // IP+путь) может ответить 429 вместо проверяемой ошибки.
    await clearVendorRateLimits();
    await page.goto("/login");
    await page.locator("#login-email").fill(UNKNOWN_EMAIL);
    await page.locator("#login-password").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();

    await expect(page.getByText("Неверный email или пароль", { exact: true })).toBeVisible();
  });
});
