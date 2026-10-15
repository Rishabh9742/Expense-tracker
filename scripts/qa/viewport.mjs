// Viewport-only screenshots at several scroll offsets (what a user actually sees).
// Usage: node viewport.mjs <baseUrl> <outDir> <email> <password> <theme> <mobile|desktop> <path> <offset1,offset2,...>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [base, out, email, password, theme, vp, path, offsets] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: vp === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: vp === "mobile" ? 2 : 1,
  colorScheme: theme,
});
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.fill("#email", email);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
for (const y of offsets.split(",").map(Number)) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(500);
  const name = `vp-${vp}-${theme}-${path.replace(/[^a-z0-9]+/gi, "_") || "root"}-${y}.png`;
  await page.screenshot({ path: `${out}/${name}` });
  console.log(name);
}
await browser.close();
