import { expect, test } from "@playwright/test";

import { ENROLLED_ADMIN } from "../helpers/accounts";
import {
  freshTotpCode,
  loginWithTotp,
  resetSavedAuthState,
  saveAdminCredentials,
  saveAdminStorageState,
  setPasswordViaReset,
} from "../helpers/auth";
import { PASSKEY_STORAGE_STATE } from "../helpers/state";

/**
 * Playwright setup-проект: один раз за прогон готовит E2E-базу — сбрасывает
 * пароль приглашённого админа и включает TOTP. Результат кладётся в
 * gitignored `e2e/.auth/`: `storageState` для зависимых тестов и
 * email/пароль/TOTP URI для входа. Зависимые проекты стартуют только после
 * успешного завершения, поэтому порядок spec-файлов не важен.
 */
test("готовит админа: сброс пароля и включение TOTP", async ({ page, browser }) => {
  test.setTimeout(180_000);

  resetSavedAuthState();

  await setPasswordViaReset(page, ENROLLED_ADMIN.email, ENROLLED_ADMIN.password);
  await page.getByRole("link", { name: "Перейти ко входу" }).click();

  await page.locator("#login-email").fill(ENROLLED_ADMIN.email);
  await page.locator("#login-password").fill(ENROLLED_ADMIN.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  // На пересозданной базе логин ведёт на /setup-mfa. Если база не пересоздана,
  // админ уже включил TOTP и получает запрос кода — сообщаем это явно вместо
  // невнятного таймаута waitForURL.
  const outcome = await Promise.race([
    page.waitForURL((url) => url.pathname === "/setup-mfa").then(() => "setup-mfa" as const),
    page
      .locator("#login-code")
      .waitFor({ state: "visible" })
      .then(() => "totp" as const),
  ]);

  if (outcome === "totp") {
    throw new Error(
      "E2E-админ уже включил TOTP: база не пересоздана. Запустите pnpm test:e2e " +
        "(prepare пересоздаст partner_coder_e2e) или пересоздайте базу вручную.",
    );
  }

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

  await page.locator("#setup-mfa-code").pressSequentially(await freshTotpCode(enrollment.totpURI));
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

  // Отдельная сессия для passkey-спеки: её logout не должен отзывать
  // admin.json, которым пользуются read-only проверки. Отдельный контекст
  // создаётся один раз здесь, чтобы не упираться в rate limit sign-in
  // (3 запроса / 10 с) при повторных входах внутри прогона.
  const baseURL = new URL(page.url()).origin;
  const passkeyContext = await browser.newContext({ baseURL });

  try {
    const passkeyPage = await passkeyContext.newPage();

    await loginWithTotp(passkeyPage, {
      email: ENROLLED_ADMIN.email,
      password: ENROLLED_ADMIN.password,
      totpUri: enrollment.totpURI,
    });
    await passkeyContext.storageState({ path: PASSKEY_STORAGE_STATE });
  } finally {
    await passkeyContext.close();
  }
});
