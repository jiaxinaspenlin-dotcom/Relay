// Screenshot every screen at 1440px and 390px wide into docs/screenshots/ (design self-review).
// Uses the e2e database: loads sample data, captures, then clears it.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const api = await (await browser.newContext()).newPage();
const h = await (await api.request.get(`${WEB}/api/health`)).json();
if (h.db !== "relay-e2e.db") throw new Error(`Refusing to touch '${h.db}'. Use RELAY_DB=data/relay-e2e.db`);
await api.request.post(`${WEB}/api/clear-data`, { data: { confirm: "DELETE" } });
await api.request.post(`${WEB}/api/settings`, { data: { demo_mode: false, practice: { practice: "Quabbin Hills Family Medicine", clinician: "Dr. Avery Lin", coordinator: "Sam Ortiz, referral coordinator" } } });

const only = process.argv.slice(2);
const shots = [];
async function shot(name, url, prep) {
  if (only.length && !only.includes(name)) return;
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${WEB}${url}`);
    await page.waitForLoadState("networkidle");
    if (prep) await prep(page);
    await page.waitForTimeout(400);
    const file = path.join(OUT, `${name}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots.push(path.relative(ROOT, file));
    await ctx.close();
  }
}

await shot("empty", "/");
await api.request.post(`${WEB}/api/sample-data`);
const detail = await (await api.request.get(`${WEB}/api/referrals/R-102`)).json();
await shot("dashboard", "/");
await shot("new-referral", "/new", async (p) => {
  await p.getByLabel("Search patients").fill("Shalanda");
  await p.getByRole("button", { name: /Shalanda Dicki/ }).click();
  await p.getByTestId("practice-card").first().waitFor({ timeout: 10000 });
  await p.getByTestId("practice-card").nth(1).getByRole("button", { name: /^Choose/ }).click();
});
await shot("referral-detail", "/referrals/R-102");
await shot("referral-detail-scheduled", "/referrals/R-103");
await shot("inbox", "/inbox");
await shot("settings", "/settings");
await shot("office", detail.office_path);
await api.request.post(`${WEB}/api/clear-data`, { data: { confirm: "DELETE" } });
await browser.close();
console.log(shots.join("\n"));
