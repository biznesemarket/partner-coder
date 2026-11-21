import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SETUP_MFA_ADMIN } from "./helpers/accounts";
import { setPasswordViaReset } from "./helpers/auth";
import { clearVendorRateLimits } from "./helpers/rate-limits";

const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations
    .filter(
      (violation) => typeof violation.impact === "string" && BLOCKING_IMPACTS.has(violation.impact),
    )
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help} — ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    );

  expect(blocking, `axe serious/critical violations: ${blocking.join("; ")}`).toEqual([]);
}

test.describe("доступность: гость", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("страница входа", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#login-email")).toBeVisible();

    await expectNoSeriousViolations(page);
  });
});

test.describe("доступность: первый вход", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Отдельный админ без TOTP: /setup-mfa доступен только до включения второго
  // фактора, а setup-проект уже зачислил основного админа.
  test("шаг настройки MFA", async ({ page }) => {
    test.setTimeout(120_000);

    await setPasswordViaReset(page, SETUP_MFA_ADMIN.email, SETUP_MFA_ADMIN.password);
    await page.getByRole("link", { name: "Перейти ко входу" }).click();

    await clearVendorRateLimits();
    await page.locator("#login-email").fill(SETUP_MFA_ADMIN.email);
    await page.locator("#login-password").fill(SETUP_MFA_ADMIN.password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();

    await page.waitForURL((url) => url.pathname === "/setup-mfa");
    await expect(page.getByRole("heading", { name: "Шаг 1. Подтвердите пароль" })).toBeVisible();
    await expect(page).toHaveTitle(/Настройка двухфакторной аутентификации/);

    await expectNoSeriousViolations(page);
  });
});

test.describe("доступность: финансы", () => {
  test("страница клиентов", async ({ page }) => {
    await page.goto("/clients");

    await expect(page.getByRole("heading", { name: "Клиенты", level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("страница тарифов", async ({ page }) => {
    await page.goto("/plans");

    await expect(page.getByRole("heading", { name: "Тарифы", level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("обзор", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Обзор", level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("страница пакетов", async ({ page }) => {
    await page.goto("/packages");

    await expect(page.getByRole("heading", { name: "Пакеты", level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("страница счетов", async ({ page }) => {
    await page.goto("/invoices");

    await expect(page.getByRole("heading", { name: "Счета", level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("страница платежей", async ({ page }) => {
    await page.goto("/payments");

    await expect(page.getByRole("heading", { name: "Платежи", level: 1 })).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});

test.describe("доступность: консоль", () => {
  test("страница профиля", async ({ page }) => {
    await page.goto("/me");

    await expect(page.getByRole("heading", { name: "Профиль", level: 1 })).toBeVisible();
    await expect(page.getByText("Действует до")).toBeVisible();

    await expectNoSeriousViolations(page);
  });

  test("страница безопасности", async ({ page }) => {
    const passkeysResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/passkey/list-user-passkeys") &&
        response.request().method() === "GET",
    );

    await page.goto("/me/security");
    await passkeysResponse;

    await expect(page.getByRole("heading", { name: "Безопасность", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ключи доступа" })).toBeVisible();

    await expectNoSeriousViolations(page);
  });
});
