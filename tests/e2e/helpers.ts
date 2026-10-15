import { expect, type Page } from "@playwright/test";

export const PASSWORD = "E2ePassword123";

export function uniqueEmail(prefix = "e2e") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@finora.test`;
}

export async function register(page: Page, email: string, name = "Riya Test") {
  await page.goto("/register");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.selectOption("#baseCurrency", "INR");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
}

export async function createAccount(page: Page, name: string, opening: string, type = "CHECKING") {
  await page.goto("/accounts?new=1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.fill("#a-name", name);
  await page.selectOption("#a-type", type);
  await page.fill("#a-open", opening);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(name).first()).toBeVisible();
}

export async function quickAdd(page: Page, opts: { type?: "Expense" | "Income" | "Transfer" | "Refund"; amount: string; description: string; category?: string; toAccount?: string }) {
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New transaction" });
  await expect(dialog).toBeVisible();
  if (opts.type && opts.type !== "Expense") await dialog.getByRole("radio", { name: new RegExp(opts.type.slice(0, 4)) }).click();
  await dialog.locator("#amount").fill(opts.amount);
  await dialog.locator("#description").fill(opts.description);
  if (opts.category) await dialog.locator("#categoryId").selectOption({ label: opts.category });
  if (opts.toAccount) await dialog.locator("#toAccountId").selectOption({ label: opts.toAccount });
  await dialog.getByRole("button", { name: /Add transaction|Record transfer/ }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

export async function shot(page: Page, name: string) {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: false });
}
