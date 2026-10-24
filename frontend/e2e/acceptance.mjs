// Acceptance tests M1–M5 in REAL mode, through the UI and API.
// Run against a throwaway database: the script deletes all data before each test.
//   make e2e     (starts nothing; needs the API with RELAY_DB=data/relay-e2e.db on :8000 and web on :5173)
//   node e2e/acceptance.mjs M3 M4
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
  // Never wipe a real database: the API must be running with RELAY_DB=…/relay-e2e.db.
  if (h.db !== "relay-e2e.db") {
    throw new Error(`Refusing to delete data in '${h.db}'. Start the API with RELAY_DB=data/relay-e2e.db`);
  }
  const r = await page.request.post(`${WEB}/api/clear-data`, { data: { confirm: "DELETE" } });
  assert(r.ok(), "clear failed");
  await page.request.post(`${WEB}/api/settings`, { data: { demo_mode: false } });
  return h;
}

// Add a patient by hand, create a referral from the finder, send it (Copy text).
async function handReferral(page) {
  await page.goto(`${WEB}/`);
  await page.getByTestId("empty-state").waitFor({ timeout: T });
  await page.getByRole("button", { name: "Add a referral" }).click();
  const form = page.getByRole("form", { name: "Add patient" });
  await form.waitFor({ timeout: T });
  await form.getByLabel("Full name").fill("Maria Santos");
  await form.getByLabel("Massachusetts town").fill("Athol");
  await form.getByLabel("Coverage").selectOption("medicare");
  await form.getByLabel("Date of birth (optional)").fill("1951-03-02");
  await form.getByRole("button", { name: "Add patient" }).click();
  const card = page.getByTestId("practice-card").first();
  await card.waitFor({ timeout: T });
  await page.getByLabel("Specialty", { exact: true }).selectOption("Cardiology");
  await page.getByLabel("Condition this referral is for").fill("Chest pain on exertion");
  await page.getByLabel("Reason for referral (in your words)").fill("New exertional chest discomfort over 3 weeks; please evaluate.");
  await page.getByLabel("Routine").check();
  await page.getByTestId("practice-card").first().getByRole("button", { name: /^Choose/ }).click();
  await page.getByRole("button", { name: "Create referral" }).click();
  await page.waitForURL(/\/referrals\/R-\d+$/, { timeout: T });
  const rid = page.url().split("/").pop();
  await page.getByText("This referral is a draft until you send it.").waitFor({ timeout: T });
  await page.getByRole("button", { name: "Copy text" }).click();
  await page.getByTestId("timeline").getByText("Referral sent to the office, copied").waitFor({ timeout: T });
  const officeHref = await page.getByTestId("office-link").getAttribute("href");
  return { rid, officeHref };
}

async function officeDo(page, officeHref, steps) {
  await page.goto(`${WEB}${officeHref}`);
  for (const step of steps) {
    await page.getByRole("radio", { name: step.button }).click();
    if (step.fill) await step.fill(page);
    await page.getByRole("button", { name: "Submit" }).click();
    await page.getByText("Thank you. The referring practice can see this update now.").waitFor({ timeout: T });
    await page.getByTestId("office-status").getByText(step.expect).waitFor({ timeout: T });
  }
}

const tests = {
  // Dashboard on the real API: empty start, then sample data shows the two failure messages.
  async M1(page) {
    await page.goto(WEB);
    await page.getByText("No referrals yet").waitFor({ timeout: T });
    await page.getByRole("button", { name: "Load sample data" }).click();
    const na = page.getByTestId("needs-attention");
    await na.getByTestId("row-R-102").getByText("Accepted 14 days ago, no appointment yet.", { exact: false }).waitFor({ timeout: T });
    await na.getByTestId("row-R-104").getByText("Seen 12 days ago, plan not received.", { exact: false }).waitFor({ timeout: T });
    const failures = page.getByRole("region", { name: "Never scheduled or plan never returned" });
    await failures.getByTestId("row-R-102").waitFor();
    await failures.getByTestId("row-R-104").waitFor();
    const headline = await page.getByTestId("headline").innerText();
    assert(headline === "7 open referrals. 5 need attention, including 1 never scheduled and 1 plan never returned.", `headline: ${headline}`);
    for (const s of ["sent", "accepted", "scheduled", "no_show", "seen", "plan_returned", "declined"]) {
      await page.getByTestId(`stage-${s}`).waitFor({ timeout: T });
    }
    await page.getByTestId("open-table").getByTestId("open-R-102").waitFor();
    await page.getByTestId("row-R-102").getByText("14 days waiting, limit 7").waitFor();
    await page.getByText("Sample data is loaded.").first().waitFor();
    const body = await page.locator("body").innerText();
    assert(!body.includes("(synthetic"), "generated text still says (synthetic)");
  },

  // Add patient by hand → referral → finder → send → Sent on the dashboard.
  async M2(page) {
    const { rid } = await handReferral(page);
    const msg = await page.getByTestId("referral-message").textContent();
    assert(msg.includes("Maria Santos") && msg.includes("/office/"), "referral text missing patient or office link");
    await page.goto(WEB);
    const row = page.getByTestId(`open-${rid}`);
    await row.waitFor({ timeout: T });
    assert((await row.getAttribute("data-stage")) === "sent", "new referral should be Sent");
    const banner = await page.getByTestId("demo-banner").count();
    assert(banner === 0, "demo banner should be off by default");
  },

  // Office link marks Accepted → Demo mode +7 days → stuck message.
  async M3(page) {
    const { rid, officeHref } = await handReferral(page);
    await officeDo(page, officeHref, [{ button: "Accept referral", expect: "Accepted" }]);
    await page.goto(`${WEB}/referrals/${rid}`);
    await page.getByTestId("timeline").getByTestId("event-meta").getByText("Office, update link").waitFor({ timeout: T });
    await page.goto(`${WEB}/settings`);
    await page.getByRole("button", { name: "Turn on demo mode" }).click();
    await page.getByTestId("demo-banner").waitFor({ timeout: T });
    const start = await page.getByTestId("demo-today").getAttribute("data-iso");
    await page.getByRole("button", { name: "+7 days" }).click();
    const want = new Date(new Date(start + "T12:00:00Z").getTime() + 7 * 864e5).toISOString().slice(0, 10);
    await page.locator(`[data-testid="demo-today"][data-iso="${want}"]`).waitFor({ timeout: T });
    await page.goto(WEB);
    const row = page.getByTestId(`row-${rid}`);
    await row.getByText("Accepted 7 days ago, no appointment yet.", { exact: false }).waitFor({ timeout: T });
    await row.getByText("7 days waiting, limit 7").waitFor();
    return rid;
  },

  // Follow-up with [F#] citations → edit → send (email and copy) → Communication on the timeline.
  async M4(page) {
    const rid = await tests.M3(page);
    await page.getByTestId(`row-${rid}`).getByRole("link", { name: "Draft follow-up" }).click();
    const drawer = page.getByRole("dialog", { name: "Follow-up" });
    await drawer.waitFor({ timeout: T });
    const box = page.getByTestId("followup-text");
    await box.waitFor({ timeout: T });
    await page.waitForFunction(() => document.querySelector('[data-testid="followup-text"]')?.value.includes("[F"));
    const drafted = await box.inputValue();
    assert(/\[F\d+\]/.test(drafted) && drafted.includes("7 days after acceptance") && drafted.includes("/office/"), `draft: ${drafted}`);
    assert(!drafted.includes("(synthetic"), "draft says (synthetic)");
    await drawer.getByText("Every number and date matches a cited fact.").waitFor();
    const extra = "Late-day slots would help; she relies on a ride from family.";
    await box.fill(`${drafted}\n${extra}`);
    await drawer.getByRole("button", { name: "Copy text" }).click();
    await drawer.waitFor({ state: "detached", timeout: T });
    const comm = page.getByTestId("timeline").locator('li[data-kind="communication"]', { hasText: extra });
    await comm.waitFor({ timeout: T });
    await comm.getByText("Edited before sending.").waitFor();
    await comm.getByText("Follow-up sent to the office, copied").waitFor();
  },

  // Office returns the plan via link → PCP inbox → close → FHIR export validates.
  async M5(page) {
    const { rid, officeHref } = await handReferral(page);
    await officeDo(page, officeHref, [
      { button: "Accept referral", expect: "Accepted" },
      { button: "Set appointment", expect: "Scheduled", fill: async (p) => {
        await p.getByLabel("Date", { exact: true }).fill("2026-12-01");
        await p.getByLabel("Time", { exact: true }).fill("10:15");
      } },
      { button: "Patient was seen", expect: "Seen" },
      { button: "Return the visit plan", expect: "Plan returned", fill: async (p) => {
        await p.getByLabel("Assessment", { exact: true }).fill("Exertional symptoms reviewed; stress test ordered.");
        await p.getByLabel("Plan", { exact: true }).fill("Stress echo in 2 weeks, ordered by cardiology. Follow-up visit after results.");
      } },
    ]);
    await page.getByText("Nothing else is needed on this referral.").waitFor({ timeout: T });
    await page.goto(`${WEB}/inbox`);
    const item = page.getByTestId(`inbox-${rid}`);
    await item.waitFor({ timeout: T });
    assert((await item.getByTestId("original-reason").innerText()).startsWith("New exertional"), "reason missing");
    assert((await item.getByTestId("returned-plan").innerText()).includes("Stress echo"), "plan missing");
    await item.getByRole("button", { name: "Acknowledge and close" }).click();
    await item.waitFor({ state: "detached", timeout: T });
    await page.goto(`${WEB}/referrals/${rid}`);
    await page.getByTestId("timeline").getByText("Closed", { exact: true }).waitFor({ timeout: T });
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: T }),
      page.getByRole("link", { name: "Download FHIR bundle" }).click(),
    ]);
    const file = path.join(ROOT, `.e2e-${rid}-fhir.json`);
    await dl.saveAs(file);
    const out = execFileSync(path.join(ROOT, ".venv/bin/python"), ["-c", `
import json,sys
from fhir.resources.R4B.bundle import Bundle
b=json.load(open(sys.argv[1])); Bundle.model_validate(b)
t={e['resource']['resourceType']:e['resource'] for e in b['entry']}
assert t['Task']['status']=='completed' and t['Task']['businessStatus']['coding'][0]['code']=='closed-by-referrer'
assert t['Appointment']['start'].startswith('2026-12-01T10:15')
assert 'Composition' in t and t['Patient']['name'][0]['family']=='Santos'
assert not any(tag.get('code')=='synthetic' for e in b['entry'] for tag in e['resource'].get('meta',{}).get('tag',[]))
print('valid', len(b['entry']))`, file]).toString();
    execFileSync("rm", ["-f", file]);
    assert(out.startsWith("valid"), out);
  },
};

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(tests);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = {};
for (const name of want) {
  const ctx = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("popup", (p) => p.close().catch(() => {}));
  try {
    await wipe(page);
    await tests[name](page);
    results[name] = "PASS";
  } catch (e) {
    results[name] = `FAIL: ${e.message.split("\n")[0]}`;
    await page.screenshot({ path: path.join(ROOT, `.e2e-${name}-failure.png`), fullPage: true }).catch(() => {});
  } finally {
    await wipe(page).catch(() => {});
    await ctx.close();
  }
}
await browser.close();
for (const [k, v] of Object.entries(results)) console.log(`${k} ${v}`);
writeFileSync(path.join(ROOT, ".e2e-results.json"), JSON.stringify(results, null, 2));
process.exit(Object.values(results).every((v) => v === "PASS") ? 0 : 1);
