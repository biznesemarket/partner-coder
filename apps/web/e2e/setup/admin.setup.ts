import { expect, test } from "@playwright/test";

import { ENROLLED_ADMIN } from "../helpers/accounts";
import {
  resetSavedAuthState,
  saveAdminCredentials,
  saveAdminStorageState,
  setPasswordViaReset,
} from "../helpers/auth";
import { totpFromUri } from "../helpers/totp";

/**
 * Playwright setup-проект: один раз за прогон готовит E2E-базу — сбрасывает
 * пароль приглашённого админа и включает TOTP. Результат кладётся в
 * gitignored `e2e/.auth/`: `storageState` для зависимых тестов и
 * email/пароль/TOTP URI для входа. Зависимые проекты стартуют только после
 * успешного завершения, поэтому порядок spec-файлов не важен.
 */
test("готовит админа: сброс пароля и включение TOTP", async ({ page }) => {
  test.setTimeout(180_000);

  resetSavedAuthState();

  await setPasswordViaReset(page, ENROLLED_ADMIN.email, ENROLLED_ADMIN.password);
  await page.getByRole("link", { name: "Перейти ко входу" }).click();

  await page.locator("#login-email").fill(ENROLLED_ADMIN.email);
  await page.locator("#login-password").fill(ENROLLED_ADMIN.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  await page.waitForURL((url) => url.pathname === "/setup-mfa");
  await expect(
    page.getByRole("heading", { name: "Настройка двухфакторной аутентификации" }),
  ).toBeVisible();

  const enableResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/two-factor/enable") && response.request().method() === "POST",
  );

  await page.locator("#setup-mfa-password").fill(ENROLLED_ADMIN.password);
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
  await expect(page.locator("dd").filter({ hasText: ENROLLED_ADMIN.email })).toHaveText(
    ENROLLED_ADMIN.email,
  );

  saveAdminCredentials({
    email: ENROLLED_ADMIN.email,
    password: ENROLLED_ADMIN.password,
    totpUri: enrollment.totpURI,
  });
  await saveAdminStorageState(page);
});
