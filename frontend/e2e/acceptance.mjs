// Acceptance tests D1–D5: the real product end to end, starting from an empty app.
// Demo mode is used only to skip time. A second browser page plays the specialist office by
// opening the office link. Refuses to run unless the API uses data/relay-e2e.db.
//   make dev-api-e2e   (API on :8000)   make dev-web   (web on :5173)   make e2e
//   node e2e/acceptance.mjs        # D1 to D5 in sequence on one referral
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

async function wipe(page) {
  const h = await (await page.request.get(`${WEB}/api/health`)).json();
  if (h.db !== "relay-e2e.db") throw new Error(`Refusing to delete data in '${h.db}'. Start the API with RELAY_DB=data/relay-e2e.db`);
  assert((await page.request.post(`${WEB}/api/clear-data`, { data: { confirm: "DELETE" } })).ok(), "clear failed");
  await page.request.post(`${WEB}/api/settings`, { data: { demo_mode: false } });
}

async function skipDays(page, days) {
  await page.goto(`${WEB}/settings`);
  // Wait for Settings to load before deciding (checking too early raced the query).
  const toggle = page.getByRole("button", { name: /^Turn (on|off) demo mode$/ });
  await toggle.waitFor({ timeout: T });
  if ((await toggle.innerText()) === "Turn on demo mode") await toggle.click();
  await page.getByTestId("demo-banner").waitFor({ timeout: T });
  for (let i = 0; i < Math.floor(days / 7); i++) {
    const before = await page.getByTestId("demo-today").getAttribute("data-iso");
    await page.getByRole("button", { name: "+7 days" }).click();
    await page.waitForFunction((b) => document.querySelector('[data-testid="demo-today"]')?.dataset.iso !== b, before);
  }
  for (let i = 0; i < days % 7; i++) {
    const before = await page.getByTestId("demo-today").getAttribute("data-iso");
    await page.getByRole("button", { name: "+1 day" }).click();
    await page.waitForFunction((b) => document.querySelector('[data-testid="demo-today"]')?.dataset.iso !== b, before);
  }
}

async function office(officePage, href, action, fill) {
  await officePage.goto(`${WEB}${href}`);
  await officePage.getByRole("radio", { name: action }).click();
  if (fill) await fill(officePage);
  await officePage.getByRole("button", { name: "Send update" }).click();
  await officePage.getByTestId("office-done").waitFor({ timeout: T });
}

const ctx = {};

const tests = {
  // A coordinator enters a real referral.
  async D1(page) {
    await page.goto(WEB);
    await page.getByText("No referrals yet").waitFor({ timeout: T });
    await page.getByRole("button", { name: "Add a referral" }).click();
    const form = page.getByRole("form", { name: "Add new patient" });
    await form.waitFor({ timeout: T });
    await form.getByLabel("Full name").fill("Maria Santos");
    await form.getByLabel("Massachusetts town").fill("Orange");
    await form.getByLabel("Insurance").selectOption("dual");
    await form.getByLabel("Date of birth (optional)").fill("1951-03-02");
    await form.getByRole("button", { name: "Add patient" }).click();
    await page.getByLabel("Specialty", { exact: true }).selectOption("Cardiology");
    const first = page.getByTestId("practice-card").first();
    await first.waitFor({ timeout: T });
    const groups = await page.getByTestId("town-group").allInnerTexts();
    assert(/miles straight-line|^In /m.test(groups[0]), `no distance: ${groups[0]}`);
    assert(groups[0].includes("Nearest acute hospital"), "nearest hospital missing");
    const medicare = await first.getByTestId("medicare-label").innerText();
    assert(/^(Accepts Medicare assignment|May accept Medicare assignment)/.test(medicare), `medicare: ${medicare}`);
    // Real practices, deduped: no two rows with the same name and address.
    const rows = await page.getByTestId("practice-card").allInnerTexts();
    const keys = rows.map((r) => r.split("\n").slice(0, 2).join("|"));
    assert(new Set(keys).size === keys.length, "duplicate practice rows");
    await first.getByRole("button", { name: /^Choose/ }).click();
    await page.getByLabel("Condition", { exact: true }).fill("Chest pain on exertion");
    await page.getByLabel("Reason for referral").fill("New exertional chest discomfort over 3 weeks; please evaluate.");
    await page.getByLabel("Routine").check();
    await page.getByRole("button", { name: "Copy text" }).click();
    await page.waitForURL(/\/referrals\/R-\d+$/, { timeout: T });
    ctx.rid = page.url().split("/").pop();
    await page.getByTestId("timeline").getByText("Referral sent").first().waitFor({ timeout: T });
    ctx.officeHref = await page.getByTestId("office-link").getAttribute("href");
    await page.goto(WEB);
    await page.getByTestId(`row-${ctx.rid}`).waitFor({ timeout: T });
  },

  // Relay notices when a referral may not have arrived.
  async D2(page, officePage) {
    await skipDays(page, 3);
    await page.goto(WEB);
    const row = page.getByTestId("waiting").getByTestId(`row-${ctx.rid}`);
    await row.getByTestId("row-status").getByText(/^Not confirmed received/).waitFor({ timeout: T });
    await office(officePage, ctx.officeHref, "Something is missing", async (p) => {
      await p.getByLabel("Records").check();
      await p.getByLabel("Note (optional)").fill("Last two office notes");
    });
    await officePage.getByTestId("office-status").getByText("Missing records").waitFor({ timeout: T });
    await page.goto(`${WEB}/referrals/${ctx.rid}`);
    try {
      await page.getByTestId("status-line").getByText(/Received incomplete, missing records/).waitFor({ timeout: T });
    } catch (e) {
      const shown = await page.getByTestId("status-line").innerText().catch(() => "(no status line)");
      const api = await (await page.request.get(`${WEB}/api/referrals/${ctx.rid}`)).json();
      throw new Error(`status line shows "${shown}"; API stage=${api.card.stage} stuck=${JSON.stringify(api.card.stuck.map((f) => f.rule))} events=${JSON.stringify(api.referral.events.map((x) => [x.stage, x.at]))}`);
    }
    await page.goto(WEB);
    await page.getByTestId(`row-${ctx.rid}`).getByTestId("row-status").getByText("Missing records").waitFor({ timeout: T });
  },

  // Relay tells the patient what to do next.
  async D3(page, officePage) {
    await office(officePage, ctx.officeHref, "Received");
    await officePage.getByTestId("office-status").getByText("Received").waitFor({ timeout: T });
    await page.goto(`${WEB}/referrals/${ctx.rid}`);
    await page.getByRole("button", { name: "Message patient" }).click();
    const drawer = page.getByRole("dialog", { name: "Message patient" });
    const box = drawer.getByTestId("patient-message");
    await box.waitFor({ timeout: T });
    const text = await box.inputValue();
    assert(/Your referral to .+ was received\. Please call \d{3}-\d{3}-\d{4} to schedule\./.test(text), `patient message: ${text}`);
    await drawer.getByRole("button", { name: "Copy text" }).click();
    await drawer.waitFor({ state: "detached", timeout: T });
    await page.getByTestId("timeline").getByText("Message to patient").waitFor({ timeout: T });
    assert(await page.getByText("Request a MassHealth ride (PT-1)").count() === 0, "PT-1 shown before a barrier");
    await page.getByRole("button", { name: "Log a barrier" }).click();
    const bf = page.getByRole("form", { name: "Log a barrier" });
    await bf.getByLabel("Barrier").selectOption("transportation");
    await bf.getByLabel("Note").fill("No car; lives alone");
    await bf.getByRole("button", { name: "Add barrier" }).click();
    await page.getByText("Request a MassHealth ride (PT-1)").waitFor({ timeout: T });
    await page.getByText("At least 3 business days before the visit.").waitFor();
    const href = await page.getByRole("link", { name: "How to request transportation for a member" }).getAttribute("href");
    assert(href.startsWith("https://www.mass.gov/"), `PT-1 link: ${href}`);
  },

  // Relay catches a referral nobody followed up on.
  async D4(page, officePage) {
    await skipDays(page, 7);
    await page.goto(WEB);
    const row = page.getByTestId("lost").getByTestId(`row-${ctx.rid}`);
    await row.getByTestId("row-status").getByText("Not scheduled, 7 days").waitFor({ timeout: T });
    await office(officePage, ctx.officeHref, "Patient contacted", (p) => p.getByLabel("Office called the patient").check());
    await office(officePage, ctx.officeHref, "Scheduled", async (p) => {
      await p.getByLabel("Date", { exact: true }).fill("2026-12-01");
      await p.getByLabel("Time", { exact: true }).fill("10:15");
    });
    await office(officePage, ctx.officeHref, "Seen");
    await officePage.getByTestId("office-status").getByText("Seen").waitFor({ timeout: T });
    await page.goto(`${WEB}/referrals/${ctx.rid}`);
    await page.getByTestId("timeline").getByText("Office, office link").first().waitFor({ timeout: T });
  },

  // The plan comes back and the loop closes.
  async D5(page, officePage) {
    await page.goto(WEB);
    const before = await page.getByTestId("headline").innerText();
    await office(officePage, ctx.officeHref, "Return plan", async (p) => {
      await p.getByLabel("Assessment", { exact: true }).fill("Exertional symptoms reviewed; stress test ordered.");
      await p.getByLabel("Plan", { exact: true }).fill("Stress echo in 2 weeks, ordered by cardiology. Follow-up after results.");
    });
    await officePage.getByText("Nothing else is needed on this referral.").waitFor({ timeout: T });
    await page.goto(`${WEB}/inbox`);
    const item = page.getByTestId(`inbox-${ctx.rid}`);
    await item.waitFor({ timeout: T });
    assert((await item.getByTestId("original-reason").innerText()).startsWith("New exertional"), "reason missing");
    assert((await item.getByTestId("returned-plan").innerText()).includes("Stress echo"), "plan missing");
    await item.getByRole("button", { name: "Acknowledge and close" }).click();
    await item.waitFor({ state: "detached", timeout: T });
    await page.goto(`${WEB}/referrals/${ctx.rid}`);
    await page.getByTestId("timeline").getByText("Closed", { exact: true }).waitFor({ timeout: T });
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: T }), page.getByRole("link", { name: "Download FHIR" }).click()]);
    const file = path.join(ROOT, `.e2e-${ctx.rid}-fhir.json`);
    await dl.saveAs(file);
    const out = execFileSync(path.join(ROOT, ".venv/bin/python"), ["-c", `
import json,sys
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B import get_fhir_model_class
b=json.load(open(sys.argv[1])); Bundle.model_validate(b)
for e in b['entry']: get_fhir_model_class(e['resource']['resourceType']).model_validate(e['resource'])
t={e['resource']['resourceType']:e['resource'] for e in b['entry']}
assert t['Task']['status']=='completed' and t['Task']['businessStatus']['coding'][0]['code']=='closed-by-referrer'
assert t['Coverage']['type']['text'].startswith('Dual eligible')
print('valid', len(b['entry']))`, file]).toString();
    execFileSync("rm", ["-f", file]);
    assert(out.startsWith("valid"), out);
    // Dashboard counts update.
    await page.goto(WEB);
    const after = await page.getByTestId("headline").innerText();
    const open = await page.getByText(/^\d+ open$/).innerText();
    assert(open === "0 open", `open count: ${open} (headline before: ${before}, after: ${after})`);
    assert(after === "0 referrals need attention", `headline: ${after}`);
  },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const officePage = await (await browser.newContext()).newPage(); // the office: separate browser, no shared state
page.on("popup", (p) => p.close().catch(() => {}));
const results = {};
await wipe(page);
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(tests);
for (const name of Object.keys(tests)) {
  if (!want.includes(name)) continue;
  if (Object.values(results).some((v) => v !== "PASS")) { results[name] = "SKIPPED (earlier step failed)"; continue; }
  try {
    await tests[name](page, officePage);
    results[name] = "PASS";
  } catch (e) {
    results[name] = `FAIL: ${e.message.split("\n").slice(0, 4).join(" | ")}`;
    await page.screenshot({ path: path.join(ROOT, `.e2e-${name}-failure.png`), fullPage: true }).catch(() => {});
    await officePage.screenshot({ path: path.join(ROOT, `.e2e-${name}-office.png`), fullPage: true }).catch(() => {});
  }
}
await wipe(page).catch(() => {});
await browser.close();
for (const [k, v] of Object.entries(results)) console.log(`${k} ${v}`);
writeFileSync(path.join(ROOT, ".e2e-results.json"), JSON.stringify(results, null, 2));
process.exit(Object.values(results).every((v) => v === "PASS") ? 0 : 1);
