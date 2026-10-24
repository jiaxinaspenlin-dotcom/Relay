// MVP acceptance tests M1–M5 through the real UI and API.
// Needs `make dev` running (API :8000, web :5173). Uses the installed Google Chrome.
//   node e2e/acceptance.mjs            # all
//   node e2e/acceptance.mjs M3 M4      # some
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const T = 15000;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function reset(page) {
  const r = await page.request.post(`${WEB}/api/reset`);
  assert(r.ok(), "reset failed");
}

async function createLiveCardiologyReferral(page) {
  await page.goto(`${WEB}/new`);
  const first = page.getByTestId("practice-card").first();
  await first.waitFor({ timeout: T });
  await page.getByLabel("Reason for referral (PCP's words)").fill("Abnormal cardiac imaging; please evaluate (synthetic).");
  await page.getByLabel("Routine").check();
  await first.getByRole("button", { name: "Choose this practice" }).click();
  await page.getByRole("button", { name: "Send referral" }).click();
  await page.waitForURL(/\/referrals\/R-\d+$/, { timeout: T });
  return page.url().split("/").pop();
}

const tests = {
  async M1(page) {
    await page.goto(WEB);
    const na = page.getByTestId("needs-attention");
    await na.getByText("Accepted 14 days ago — no appointment yet").waitFor({ timeout: T });
    await na.getByText("Seen 12 days ago — plan not received").waitFor({ timeout: T });
    const rows = await na.locator(":scope > li").allTextContents();
    assert(rows.findIndex((r) => r.includes("R-102")) === 0, "R-102 should be first (most days stuck)");
    for (const s of ["sent", "accepted", "scheduled", "seen", "plan_returned", "declined", "patient_barrier"]) {
      await page.getByTestId(`col-${s}`).waitFor({ timeout: T });
    }
    await page.getByTestId("col-accepted").getByTestId("card-R-102").waitFor();
    const counts = await page.getByTestId("counts").innerText();
    assert(/Open\s*7/.test(counts) && /Stuck\s*5/.test(counts) && /Closed this month\s*1/.test(counts),
      `counts wrong: ${counts}`);
    await page.getByText("Synthetic patients and referrals.").waitFor();
  },

  async M2(page) {
    await page.goto(`${WEB}/new`);
    const card = page.getByTestId("practice-card").first();
    await card.waitFor({ timeout: T });
    const text = await card.innerText();
    assert(/\d+ mi straight-line/.test(text), `no distance: ${text}`);
    const medicare = await card.getByTestId("medicare-label").innerText();
    assert(/^(Accepts Medicare assignment|May accept Medicare assignment — confirm with the office)/.test(medicare),
      `medicare label: ${medicare}`);
    const hosp = await card.getByTestId("nearest-hospital").innerText();
    assert(hosp.startsWith("Nearest hospital:") && hosp.includes("med/surg + ICU + pediatric beds"), `hospital: ${hosp}`);
    await page.getByText("Ask the office whether a telehealth visit is offered").waitFor();
    const rid = await createLiveCardiologyReferral(page);
    await page.goto(WEB);
    await page.getByTestId("col-sent").getByTestId(`card-${rid}`).waitFor({ timeout: T });
    return rid;
  },

  async M3(page) {
    const rid = await createLiveCardiologyReferral(page);
    const form = page.getByRole("form", { name: "Log update" });
    await form.getByLabel("Accepted").check();
    await form.getByLabel("Phone").check();
    await form.getByRole("button", { name: "Log update" }).click();
    await page.getByTestId("timeline").getByText("via phone").waitFor({ timeout: T });
    await page.getByText("Demo clock — simulates time passing").first().waitFor();
    assert((await page.getByTestId("demo-today").innerText()) === "2026-10-24", "clock should start at 2026-10-24");
    await page.getByRole("button", { name: "+7 days" }).click();
    await page.getByTestId("demo-today").getByText("2026-10-31").waitFor({ timeout: T });
    await page.goto(WEB);
    const row = page.getByTestId("needs-attention").locator(":scope > li", { hasText: rid });
    await row.getByText("Accepted 7 days ago — no appointment yet").waitFor({ timeout: T });
    await page.getByRole("button", { name: "Reset clock" }).click();
    await page.getByTestId("demo-today").getByText("2026-10-24").waitFor({ timeout: T });
  },

  async M4(page) {
    await page.goto(WEB);
    await page.getByTestId("needs-attention").locator(":scope > li", { hasText: "R-102" })
      .getByRole("link", { name: "Draft follow-up" }).click();
    const box = page.getByTestId("followup-text");
    await box.waitFor({ timeout: T });
    await page.waitForFunction(() => document.querySelector('[data-testid="followup-text"]')?.value.includes("[F"));
    const drafted = await box.inputValue();
    assert(/\[F\d+\]/.test(drafted) && drafted.includes("14 days after acceptance"), `draft: ${drafted}`);
    await page.getByText("Verified: every number and date matches a cited fact.").waitFor();
    const extra = "Late-day slots would help the patient (edited by coordinator).";
    await box.fill(`${drafted}\n${extra}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const comm = page.getByTestId("timeline").locator('li[data-kind="communication"]');
    await comm.getByText(extra).waitFor({ timeout: T });
    await comm.getByText("edited before sending").waitFor();
  },

  async M5(page) {
    await page.goto(`${WEB}/referrals/R-104`);
    const form = page.getByRole("form", { name: "Log update" });
    await form.getByLabel("Plan received").check();
    await form.getByLabel("Fax").check();
    await form.getByLabel("Assessment (as written by the specialist)").fill("Imaging findings reviewed (synthetic).");
    await form.getByLabel("Plan (as written by the specialist)").fill("Echo in 6 weeks, ordered by cardiology (synthetic).");
    await form.getByRole("button", { name: "Log update" }).click();
    await page.getByTestId("timeline").getByText("Plan returned").waitFor({ timeout: T });
    await page.goto(`${WEB}/inbox`);
    const item = page.getByTestId("inbox-R-104");
    await item.waitFor({ timeout: T });
    assert((await item.getByTestId("original-reason").innerText()).startsWith("Please evaluate"), "reason missing");
    assert((await item.getByTestId("returned-plan").innerText()).includes("Echo in 6 weeks"), "plan missing");
    await item.getByRole("button", { name: "Acknowledge & close" }).click();
    await item.waitFor({ state: "detached", timeout: T });
    await page.goto(`${WEB}/referrals/R-104`);
    await page.getByTestId("timeline").getByText("Closed").waitFor({ timeout: T });
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: T }),
      page.getByRole("link", { name: "Download FHIR bundle" }).click(),
    ]);
    const file = path.join(ROOT, ".e2e-R-104-fhir.json");
    await dl.saveAs(file);
    // Validate the downloaded file with fhir.resources.R4B (same library as test_fhir.py).
    const out = execFileSync(path.join(ROOT, ".venv/bin/python"), ["-c", `
import json,sys
from fhir.resources.R4B.bundle import Bundle
b=json.load(open(sys.argv[1])); Bundle.model_validate(b)
t={e['resource']['resourceType']:e['resource'] for e in b['entry']}
assert t['Task']['status']=='completed' and t['Task']['businessStatus']['coding'][0]['code']=='closed-by-referrer'
assert 'Composition' in t
print('valid', len(b['entry']))`, file]).toString();
    execFileSync("rm", ["-f", file]);
    assert(out.startsWith("valid"), out);
  },
};

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(tests);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = {};
for (const name of want) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    await reset(page);
    await tests[name](page);
    results[name] = "PASS";
  } catch (e) {
    results[name] = `FAIL: ${e.message.split("\n")[0]}`;
    await page.screenshot({ path: path.join(ROOT, `.e2e-${name}-failure.png`), fullPage: true }).catch(() => {});
  } finally {
    await reset(page).catch(() => {});
    await ctx.close();
  }
}
await browser.close();
for (const [k, v] of Object.entries(results)) console.log(`${k} ${v}`);
writeFileSync(path.join(ROOT, ".e2e-results.json"), JSON.stringify(results, null, 2));
process.exit(Object.values(results).every((v) => v === "PASS") ? 0 : 1);
