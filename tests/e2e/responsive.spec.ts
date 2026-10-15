import { expect, test } from "@playwright/test";
import { register, uniqueEmail } from "./helpers";

test("mobile layout has no horizontal overflow and uses bottom navigation", async ({ page }) => {
  test.setTimeout(120_000);
  await register(page, uniqueEmail("mobile"));
  for (const p of ["/", "/transactions", "/budgets", "/reports", "/settings"]) {
    await page.goto(p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `horizontal overflow on ${p}`).toBe(false);
  }
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
  await page.getByRole("button", { name: "Add transaction" }).last().click();
  await expect(page.getByRole("dialog", { name: "New transaction" })).toBeVisible();
});
