import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PASSWORD, createAccount, quickAdd, register, shot, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("a new user manages money end to end", async ({ page }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail("flow");
  await register(page, email);

  // Accounts
  await createAccount(page, "Main Checking", "10000");
  await createAccount(page, "Rainy Day Savings", "0", "SAVINGS");

  // Transactions via the keyboard quick-add
  await page.goto("/");
  await quickAdd(page, { type: "Income", amount: "50000", description: "October salary", category: "Salary" });
  await quickAdd(page, { amount: "1234.50", description: "Weekly groceries", category: "Groceries" });
  await quickAdd(page, { amount: "765.50", description: "Dinner out", category: "Dining" });
  await quickAdd(page, { type: "Refund", amount: "200", description: "Dinner refund", category: "Dining" });
  await quickAdd(page, { type: "Transfer", amount: "15000", description: "Move to savings", toAccount: "Rainy Day Savings · INR" });

  // Dashboard figures: transfers never count as income or spending; refunds reduce spending.
  await page.goto("/?range=this_month");
  const income = page.locator("section[aria-label=Summary] > *").nth(1);
  const expenses = page.locator("section[aria-label=Summary] > *").nth(2);
  await expect(income).toContainText("₹50,000.00");
  await expect(expenses).toContainText("₹1,800.00"); // 1234.50 + 765.50 − 200
  await expect(page.locator("section[aria-label=Summary] > *").first()).toContainText("₹58,200.00"); // 10000 + 50000 − 2000 + 200
  await shot(page, "e2e-overview");

  // Transactions page: search + drawer
  await page.goto("/transactions?q=groceries");
  await expect(page.getByText("Weekly groceries").first()).toBeVisible();
  await page.getByText("Weekly groceries").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "e2e-drawer");
  await page.keyboard.press("Escape");

  // Budget
  await page.goto("/budgets?new=1");
  await page.locator("#b-cat").selectOption({ label: "Dining" });
  await page.fill("#b-amt", "1000");
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByText("56.6% used").first()).toBeVisible(); // 565.50 of 1000

  // Assistant (offline mode in tests): answers come from real data
  await page.goto("/assistant");
  await page.getByLabel("Your question").fill("How much did I spend on dining this month?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("₹565.50").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /How this was calculated/ }).click();
  await expect(page.getByText(/Net spending = expenses − refunds/).first()).toBeVisible();
  await shot(page, "e2e-assistant");

  // CSV import with a duplicate row
  const dir = mkdtempSync(path.join(tmpdir(), "finora-e2e-"));
  const csv = path.join(dir, "statement.csv");
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(csv, `Date,Description,Amount\n${today},Coffee shop,-250.00\n${today},Coffee shop,-250.00\n${today},Book store,-899.00\n`);
  await page.goto("/import", { waitUntil: "networkidle" });
  await page.locator("input[type=file]").first().setInputFiles(csv);
  await expect(page.getByText("Column mapping")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Validate & preview" }).click();
  await expect(page.getByText(/1 possible duplicate/)).toBeVisible({ timeout: 30_000 });
  await shot(page, "e2e-import");
  await page.getByRole("button", { name: /Import 2 transactions/ }).click();
  await expect(page.getByText(/Imported 2 transactions/)).toBeVisible({ timeout: 30_000 });

  // Export
  const dl = page.waitForEvent("download");
  await page.goto("/import");
  await page.getByRole("tab", { name: /Export/ }).click();
  await page.getByText("All transactions · CSV").click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/finora-transactions-.*\.csv/);

  // Delete account
  await page.goto("/settings#data");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirmation", { exact: true }).fill("DELETE");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page).toHaveURL(/\/login\?deleted=1/, { timeout: 30_000 });
  await expect(page.getByText(/permanently deleted/)).toBeVisible();
});

test("users cannot see each other's data", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const a = uniqueEmail("iso-a");
  await register(page, a, "User A");
  await createAccount(page, "A's private account", "777");
  await page.goto("/accounts");
  const href = await page.getByRole("link", { name: "Open A's private account" }).getAttribute("href");
  expect(href).toMatch(/^\/accounts\/.+/);
  await page.goto(href!);
  await expect(page.getByRole("heading", { name: "A's private account" })).toBeVisible();
  const accountUrl = page.url();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await register(p2, uniqueEmail("iso-b"), "User B");
  await p2.goto("/accounts");
  await expect(p2.getByText("A's private account")).toHaveCount(0);
  // Streaming (loading.tsx) means the status can't change mid-response; what matters is that no data renders.
  await p2.goto(accountUrl);
  await expect(p2.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(p2.getByText("A's private account")).toHaveCount(0);
  // API routes enforce ownership with a real 404.
  const receipt = await p2.request.get(`/api/receipts/${accountUrl.split("/").pop()}`);
  expect(receipt.status()).toBe(404);
  await ctx.close();
});
