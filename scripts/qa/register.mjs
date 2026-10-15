// Registers a user through the real UI. Usage: node register.mjs <baseUrl> <name> <email> <password>
import { chromium } from "@playwright/test";
const [base, name, email, password] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/register`, { timeout: 120000 });
await page.fill("#name", name);
await page.fill("#email", email);
await page.fill("#password", password);
await page.click("button[type=submit]");
try {
  await page.waitForURL((u) => u.pathname === "/", { timeout: 90000 });
  console.log("registered + logged in:", page.url());
} catch {
  console.log("did not reach /:", page.url(), (await page.textContent("form"))?.slice(0, 300));
}
await browser.close();
