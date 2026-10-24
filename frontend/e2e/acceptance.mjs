// Acceptance tests A1–A5 (replace section D): the real product with sign-in, real clock only.
// A second browser plays the specialist office through the office link (no account).
// Needs the API with RELAY_E2E=1 and RELAY_DB=data/relay-e2e.db (`make dev-api-e2e`) and the
// web app on :5173 (`make dev-web`). Refuses to run against any other database.
//   node e2e/acceptance.mjs          # A1 to A5 in order
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const T = 15000;
const assert = (c, m) => { if (!c) throw new Error(m); };

async function reset(page) {
  const h = await (await page.request.get(`${WEB}/api/health`)).json();
  if (h.db !== "relay-e2e.db") throw new Error(`Refusing to touch '${h.db}'. Start the API with make dev-api-e2e`);
  assert((await page.request.post(`${WEB}/api/test/reset`)).ok(), "test reset failed (is RELAY_E2E=1 set?)");
}

async function signInAs(page, role) {
  await page.goto(`${WEB}/sign-in`);
  await page.getByRole("button", { name: `Sign in as ${role} (sample)` }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: T });
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
  // Sign in as coordinator → New referral → add patient (Orange, Dual eligible) → Cardiology →
  // finder (deduped, distance, Medicare assignment, nearest acute hospital) → Send → "Sent by Sam Ortiz".
  async A1(page) {
    await page.goto(`${WEB}/sign-in`);
    await page.getByRole("button", { name: "Load sample data" }).click(); // brand-new install
    await page.getByRole("button", { name: "Sign in as coordinator (sample)" }).waitFor({ timeout: T });
    await signInAs(page, "coordinator");
    await page.getByTestId("signed-in-as").getByText("Sam Ortiz").waitFor({ timeout: T });
    await page.goto(`${WEB}/new`);
    await page.getByRole("button", { name: "Add new patient" }).click();
    const form = page.getByRole("form", { name: "Add new patient" });
    await form.getByLabel("Full name").fill("Maria Santos");
    await form.getByLabel("Massachusetts town").fill("Orange");
    await form.getByLabel("Insurance").selectOption("dual");
    await form.getByRole("button", { name: "Add patient" }).click();
    await page.getByLabel("Specialty", { exact: true }).selectOption("Cardiology");
    const first = page.getByTestId("practice-card").first();
    await first.waitFor({ timeout: T });
    const groups = await page.getByTestId("town-group").allInnerTexts();
    assert(/miles straight-line|^In /m.test(groups[0]), `no distance: ${groups[0]}`);
    assert(groups[0].includes("Nearest acute hospital"), "nearest acute hospital missing");
    const medicare = await first.getByTestId("medicare-label").innerText();
    assert(/^(Accepts Medicare assignment|May accept Medicare assignment)/.test(medicare), `medicare: ${medicare}`);
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
    await page.getByTestId("timeline").getByTestId("event-title").getByText("Sent by Sam Ortiz", { exact: true }).waitFor({ timeout: T });
    ctx.officeHref = await page.getByTestId("office-link").getAttribute("href");
  },

  // Office link → "Something is missing: records" → the referral appears under Waiting as "Missing records".
  async A2(page, officePage) {
    await page.goto(WEB); // dashboard stays open; it must update by itself
    await page.getByTestId(`row-${ctx.rid}`).waitFor({ timeout: T });
    await office(officePage, ctx.officeHref, "Something is missing", (p) => p.getByLabel("Records").check());
    await officePage.getByTestId("office-status").getByText("Missing records").waitFor({ timeout: T });
    await page.getByTestId("waiting").getByTestId(`row-${ctx.rid}`).getByTestId("row-status").getByText("Missing records").waitFor({ timeout: T });
  },

  // Office link → Received → patient message with the practice phone → sent. Transportation barrier → PT-1.
  async A3(page, officePage) {
    await office(officePage, ctx.officeHref, "Received");
    await page.goto(`${WEB}/referrals/${ctx.rid}`);
    const phone = (await (await page.request.get(`${WEB}/api/referrals/${ctx.rid}`)).json()).referral.performer.phone;
    assert(/^\d{3}-\d{3}-\d{4}$/.test(phone), `practice phone from CMS: ${phone}`);
    await page.getByRole("button", { name: "Message patient" }).click();
    const drawer = page.getByRole("dialog", { name: "Message patient" });
    const box = drawer.getByTestId("patient-message");
    await box.waitFor({ timeout: T });
    const text = await box.inputValue();
    assert(text.includes(`was received. Please call ${phone} to schedule.`), `patient message: ${text}`);
    await drawer.getByRole("button", { name: "Print" }).click();
    await drawer.waitFor({ state: "detached", timeout: T });
    await page.getByTestId("timeline").getByText("Message to patient").waitFor({ timeout: T });
    await page.getByTestId("timeline").getByText("print by Sam Ortiz").waitFor();
    assert(await page.getByText("Request a MassHealth ride (PT-1)").count() === 0, "PT-1 shown before a barrier");
    await page.getByRole("button", { name: "Log a barrier" }).click();
    const bf = page.getByRole("form", { name: "Log a barrier" });
    await bf.getByLabel("Barrier").selectOption("transportation");
    await bf.getByLabel("Note").fill("No car; lives alone");
    await bf.getByRole("button", { name: "Add barrier" }).click();
    await page.getByText("Request a MassHealth ride (PT-1)").waitFor({ timeout: T });
    await page.getByText("At least 3 business days before the visit.").waitFor();
  },

  // With sample data loaded, the dashboard shows both challenge failures under "Lost in the handoff".
  async A4(page) {
    await page.goto(WEB);
    const lost = page.getByTestId("lost");
    await lost.getByText("Not scheduled, 14 days").waitFor({ timeout: T });
    await lost.getByText("No plan back, 12 days").waitFor({ timeout: T });
    // (Every time threshold is covered in pytest with an injected test clock, not here.)
  },

  // Office → Patient contacted → Scheduled → Seen → Return plan → clinician → Inbox → Acknowledge and
  // close → "Closed by Dr. Avery Lin" → FHIR (Provenance names her) → coordinator counts update.
  async A5(page, officePage) {
    await page.goto(WEB);
    const beforeOpen = await page.getByText(/^\d+ open$/).innerText();
    await office(officePage, ctx.officeHref, "Patient contacted", (p) => p.getByLabel("Office called the patient").check());
    await office(officePage, ctx.officeHref, "Scheduled", async (p) => {
      await p.getByLabel("Date", { exact: true }).fill("2027-02-02");
      await p.getByLabel("Time", { exact: true }).fill("10:15");
    });
    await office(officePage, ctx.officeHref, "Seen");
    await office(officePage, ctx.officeHref, "Return plan", async (p) => {
      await p.getByLabel("Assessment", { exact: true }).fill("Exertional symptoms reviewed; stress test ordered.");
      await p.getByLabel("Plan", { exact: true }).fill("Stress echo in 2 weeks, ordered by cardiology. Follow-up after results.");
    });
    await page.goto(`${WEB}/inbox`);
    await page.getByTestId(`inbox-${ctx.rid}`).getByText("Only a clinician can acknowledge and close.").waitFor({ timeout: T });
    const clin = await (await page.context().browser().newContext({ acceptDownloads: true })).newPage();
    await signInAs(clin, "clinician");
    assert(clin.url().endsWith("/inbox"), `clinician should land on Inbox, got ${clin.url()}`);
    const item = clin.getByTestId(`inbox-${ctx.rid}`);
    await item.waitFor({ timeout: T });
    assert((await item.getByTestId("returned-plan").innerText()).includes("Stress echo"), "plan missing");
    await item.getByRole("button", { name: "Acknowledge and close" }).click();
    await item.waitFor({ state: "detached", timeout: T });
    await clin.goto(`${WEB}/referrals/${ctx.rid}`);
    await clin.getByTestId("timeline").getByText("Closed by Dr. Avery Lin", { exact: true }).waitFor({ timeout: T });
    const [dl] = await Promise.all([clin.waitForEvent("download", { timeout: T }), clin.getByRole("link", { name: "Download FHIR" }).click()]);
    const file = path.join(ROOT, `.e2e-${ctx.rid}-fhir.json`);
    await dl.saveAs(file);
    const out = execFileSync(path.join(ROOT, ".venv/bin/python"), ["-c", `
import json,sys
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B import get_fhir_model_class
b=json.load(open(sys.argv[1])); Bundle.model_validate(b)
for e in b['entry']: get_fhir_model_class(e['resource']['resourceType']).model_validate(e['resource'])
t={}
for e in b['entry']: t.setdefault(e['resource']['resourceType'], []).append(e['resource'])
people={p['id']: p['name'][0]['text'] for p in t['Practitioner']}
close=[p for p in t['Provenance'] if p['activity']['text']=='Stage → Closed'][0]
assert people[close['agent'][0]['who']['reference'].split('/')[1]]=='Dr. Avery Lin', close
sent=[p for p in t['Provenance'] if p['activity']['text']=='Stage → Sent'][0]
assert sent['agent'][0]['who']['display']=='Sam Ortiz'
assert t['Composition'][0]['attester'][0]['party']['display']=='Dr. Avery Lin'
assert t['Task'][0]['status']=='completed'
print('valid', len(b['entry']))`, file]).toString();
    execFileSync("rm", ["-f", file]);
    assert(out.startsWith("valid"), out);
    await clin.close();
    await page.goto(WEB);
    const afterOpen = await page.getByText(/^\d+ open$/).innerText();
    assert(parseInt(afterOpen) === parseInt(beforeOpen) - 1, `open count ${beforeOpen} → ${afterOpen}`);
  },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] })).newPage();
const officePage = await (await browser.newContext()).newPage(); // the office: no account, no shared cookies
page.on("popup", (p) => p.close().catch(() => {}));
const results = {};
await reset(page);
for (const name of Object.keys(tests)) {
  if (Object.values(results).some((v) => v !== "PASS")) { results[name] = "SKIPPED (earlier step failed)"; continue; }
  try {
    await tests[name](page, officePage);
    results[name] = "PASS";
  } catch (e) {
    results[name] = `FAIL: ${e.message.split("\n").slice(0, 3).join(" | ")}`;
    await page.screenshot({ path: path.join(ROOT, `.e2e-${name}-failure.png`), fullPage: true }).catch(() => {});
  }
}
await reset(page).catch(() => {});
await browser.close();
for (const [k, v] of Object.entries(results)) console.log(`${k} ${v}`);
writeFileSync(path.join(ROOT, ".e2e-results.json"), JSON.stringify(results, null, 2));
process.exit(Object.values(results).every((v) => v === "PASS") ? 0 : 1);
