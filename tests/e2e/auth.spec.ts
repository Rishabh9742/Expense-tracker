import { expect, test } from "@playwright/test";
import { PASSWORD, login, register, uniqueEmail } from "./helpers";

test("protected pages redirect to login", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.request.get("/api/export/all");
  expect(res.status()).toBe(401);
});

test("register, log out, and log back in", async ({ page }) => {
  const email = uniqueEmail("auth");
  await register(page, email);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Riya/ })).toBeVisible();
  await expect(page.getByText("Set up Finora")).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).first().click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await login(page, email, "wrong-password-1");
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();

  await login(page, email, PASSWORD);
  await page.waitForURL((u) => u.pathname === "/");
});

test("registration validates input", async ({ page }) => {
  await page.goto("/register");
  await page.fill("#name", "Short Pw");
  await page.fill("#email", uniqueEmail("pw"));
  await page.fill("#password", "short");
  await page.click("button[type=submit]");
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();
});
