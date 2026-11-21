import { expect, test } from "@playwright/test";

test.describe("клиенты и тарифы", () => {
  test.setTimeout(120_000);

  test("создаёт клиента и тариф", async ({ page }) => {
    const suffix = Date.now().toString();
    const customerName = `ООО Тест ${suffix}`;
    const planCode = `test-${suffix}`;
    const planName = `Тест ${suffix}`;

    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Клиенты", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Создать клиента" }).click();
    await page.locator("#customer-legal-name").fill(customerName);
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    await expect(page.getByText("Клиент создан")).toBeVisible();
    await expect(page.getByText(customerName, { exact: true })).toBeVisible();

    await page.getByRole("link", { name: customerName }).click();
    await expect(page.getByRole("heading", { name: customerName, level: 1 })).toBeVisible();
    await expect(page.getByText("Карточка клиента", { exact: true })).toBeVisible();
    await expect(page.getByText("Договоров нет", { exact: true })).toBeVisible();

    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Счета", level: 1 })).toBeVisible();

    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Платежи", level: 1 })).toBeVisible();

    await page.goto("/plans");
    await expect(page.getByRole("heading", { name: "Тарифы", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Создать тариф" }).click();
    await page.locator("#plan-code").fill(planCode);
    await page.locator("#plan-name").fill(planName);
    await page.locator("#plan-price").fill("10000");
    await page.getByRole("button", { name: "Создать", exact: true }).click();

    await expect(page.getByText("Тариф создан")).toBeVisible();
    await expect(page.getByText(planCode, { exact: true })).toBeVisible();
  });
});
