import { expect, test } from "@playwright/test";

import { addVirtualAuthenticator, removeVirtualAuthenticator } from "./helpers/authenticator";
import { logoutViaUserMenu } from "./helpers/auth";

test.describe("ключи доступа", () => {
  test.setTimeout(120_000);

  test("добавляет ключ доступа и входит с ним", async ({ page }) => {
    const authenticator = await addVirtualAuthenticator(page);
    // Уникальное имя переживает повторный запуск на той же базе: старые ключи
    // не мешают выбрать и проверить свежедобавленный.
    const passkeyName = `E2E ключ доступа ${Date.now()}`;

    try {
      await page.goto("/me/security");
      await expect(page.getByRole("heading", { name: "Безопасность", level: 1 })).toBeVisible();
      await expect(page.getByRole("region", { name: "Ключи доступа" })).toBeVisible();

      await page.getByRole("button", { name: "Добавить ключ", exact: true }).click();

      const dialog = page.getByRole("dialog");

      await expect(dialog.getByRole("heading", { name: "Новый ключ доступа" })).toBeVisible();
      await dialog.locator("#passkey-name").fill(passkeyName);
      await dialog.getByRole("button", { name: "Добавить ключ", exact: true }).click();

      await expect(dialog).toBeHidden();
      await expect(page.getByRole("listitem").filter({ hasText: passkeyName })).toBeVisible();

      await logoutViaUserMenu(page);
      await expect(page.locator("#login-email")).toBeVisible();

      await page.getByRole("button", { name: "Войти с ключом доступа" }).click();

      await page.waitForURL((url) => url.pathname === "/me");
      await expect(page.getByRole("heading", { name: "Профиль", level: 1 })).toBeVisible();
    } finally {
      await removeVirtualAuthenticator(authenticator).catch(() => undefined);
    }
  });
});
