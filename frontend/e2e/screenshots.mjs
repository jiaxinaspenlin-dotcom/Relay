// Screenshot every screen at 1440px and 390px wide into docs/screenshots/ (design self-review).
// Uses the e2e database (RELAY_E2E=1): resets, loads sample data, signs in, captures, resets.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs", "screenshots", process.env.SHOT_DIR ?? "");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const api = await (await browser.newContext()).newPage();
const h = await (await api.request.get(`${WEB}/api/health`)).json();
if (h.db !== "relay-e2e.db") throw new Error(`Refusing to touch '${h.db}'. Use make dev-api-e2e`);
await api.request.post(`${WEB}/api/test/reset`);

const only = process.argv.slice(2);
const shots = [];
async function shot(name, url, { role, prep } = {}) {
  if (only.length && !only.includes(name)) return;
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    if (role) {
      await page.goto(`${WEB}/sign-in`);
      await page.getByRole("button", { name: `Sign in as ${role} (sample)` }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
    }
    await page.goto(`${WEB}${url}`);
    await page.waitForLoadState("networkidle");
    if (prep) await prep(page);
    await page.waitForTimeout(500);
    const file = path.join(OUT, `${name}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots.push(path.relative(ROOT, file));
    await ctx.close();
  }
}

await shot("first-run", "/sign-in");
await api.request.post(`${WEB}/api/sample-data`);
await shot("sign-in", "/sign-in");
const coord = { role: "coordinator" };
await shot("dashboard", "/", coord);
await shot("new-referral", "/new", { ...coord, prep: async (p) => {
  await p.getByLabel("Search patients").fill("Shalanda");
  await p.getByRole("button", { name: /Shalanda Dicki/ }).click();
  await p.getByTestId("practice-card").first().waitFor({ timeout: 10000 });
  await p.getByTestId("practice-card").nth(1).getByRole("button", { name: /^Choose/ }).click();
} });
await shot("referral-detail", "/referrals/R-102", coord);
await shot("referral-detail-scheduled", "/referrals/R-103", coord);
await shot("inbox", "/inbox", { role: "clinician" });
await shot("settings", "/settings", coord);
// office link: no account
const sam = await (await browser.newContext()).newPage();
await sam.goto(`${WEB}/sign-in`);
await sam.getByRole("button", { name: "Sign in as coordinator (sample)" }).click();
await sam.waitForURL(`${WEB}/`);
const detail = await (await sam.request.get(`${WEB}/api/referrals/R-102`)).json();
await shot("office", detail.office_path);
await api.request.post(`${WEB}/api/test/reset`);
await browser.close();
console.log(shots.join("\n"));
