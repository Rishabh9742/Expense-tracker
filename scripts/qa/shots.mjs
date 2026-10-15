// Usage: node shots.mjs <baseUrl> <outDir> <email> <password> <theme:light|dark> <viewport:desktop|mobile> <paths...>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [base, out, email, password, theme, vp, ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: vp === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: vp === "mobile" ? 2 : 1,
  colorScheme: theme,
});
const page = await ctx.newPage();
const errors = [];
let current = "login";
page.on("pageerror", (e) => errors.push(`[${current}] pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`[${current}] console: ${m.text().slice(0, 6000)}`));

if (email !== "-") {
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
}
for (const p of paths) {
  const t0 = Date.now();
  current = p;
  await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(700);
  const name = `${vp}-${theme}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.png`;
  await page.screenshot({ path: `${out}/${name}`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(`${p} -> ${name} (${Date.now() - t0}ms)${overflow ? " [HORIZONTAL OVERFLOW]" : ""}`);
}
if (errors.length) console.log("ERRORS:\n" + [...new Set(errors)].join("\n"));
await browser.close();
