// Core loop on a brand-new referral: nothing sample, nothing hardcoded.
// New referral (add patient inline → specialty → finder → Send) → each office-link action from a
// separate browser → dashboard row and referral detail reflect it without a reload → Inbox →
// Acknowledge and close → FHIR export validates.
// Needs the API on RELAY_DB=data/relay-e2e.db (refuses otherwise). Signs in when sign-in exists.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const T = 15000;
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const coord = await (await browser.newContext({ acceptDownloads: true })).newPage();
const office = await (await browser.newContext()).newPage();
coord.on("popup", (p) => p.close().catch(() => {}));
const step = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) {
    console.log(`FAIL ${name}: ${e.message.split("\n").slice(0, 3).join(" | ")}`);
    await coord.screenshot({ path: path.join(ROOT, ".e2e-core-failure.png"), fullPage: true }).catch(() => {});
    await browser.close(); process.exit(1);
  }
};

const h = await (await coord.request.get(`${WEB}/api/health`)).json();
if (h.db !== "relay-e2e.db") throw new Error(`Refusing to delete data in '${h.db}'`);
await coord.request.post(`${WEB}/api/clear-data`, { data: { confirm: "DELETE" } });
async function signIn(page, who) {
  const cfg = await (await page.request.get(`${WEB}/api/auth/me`)).status();
  if (cfg === 404) return; // sign-in not built yet
  await page.request.post(`${WEB}/api/auth/sample-users`).catch(() => {});
  await page.goto(`${WEB}/sign-in`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: T });
}
const SAM = { email: "sam.ortiz@quabbinhills.example", password: process.env.SAM_PASSWORD ?? "relay-coordinator" };
const AVERY = { email: "avery.lin@quabbinhills.example", password: process.env.AVERY_PASSWORD ?? "relay-clinician" };

let rid, href;
const row = () => coord.getByTestId(`row-${rid}`);
async function officeAct(label, fill) {
  await office.goto(`${WEB}${href}`);
  await office.getByRole("radio", { name: label }).click();
  if (fill) await fill(office);
  await office.getByRole("button", { name: "Send update" }).click();
  await office.getByTestId("office-done").waitFor({ timeout: T });
}
// The dashboard and detail are open in the coordinator's browser; they must update on their own.
async function seesOnDashboard(text) {
  await row().getByTestId("row-status").getByText(text).waitFor({ timeout: T });
}

await step("sign in as coordinator", () => signIn(coord, SAM));
await step("new referral: add patient inline, specialty, finder, send", async () => {
  await coord.goto(`${WEB}/new`);
  const form = coord.getByRole("form", { name: "Add new patient" });
  await form.waitFor({ timeout: T });
  await form.getByLabel("Full name").fill("Rosa Delgado");
  await form.getByLabel("Massachusetts town").fill("Athol");
  await form.getByLabel("Insurance").selectOption("masshealth_pcc");
  await form.getByRole("button", { name: "Add patient" }).click();
  await coord.getByLabel("Specialty", { exact: true }).selectOption("Nephrology");
  await coord.getByTestId("practice-card").nth(1).getByRole("button", { name: /^Choose/ }).click();
  await coord.getByLabel("Condition", { exact: true }).fill("Chronic kidney disease stage 3");
  await coord.getByLabel("Reason for referral").fill("eGFR falling over 6 months; please evaluate.");
  await coord.getByLabel("Urgent").check();
  await coord.getByRole("button", { name: "Open in email" }).click();
  await coord.waitForURL(/\/referrals\/R-\d+$/, { timeout: T });
  rid = coord.url().split("/").pop();
  href = await coord.getByTestId("office-link").getAttribute("href");
  await coord.getByTestId("timeline").getByText("Referral sent").waitFor({ timeout: T });
  await coord.getByTestId("referral-hint").getByText(/130 CMR 450\.118\(J\)/).waitFor();
});
await step("dashboard shows it as Sent (on track)", async () => {
  await coord.goto(WEB);
  await coord.getByTestId("on-track").getByTestId(`row-${rid}`).getByText("Sent").waitFor({ timeout: T });
});
await step("office: Something is missing → dashboard 'Missing test results' without reload", async () => {
  await officeAct("Something is missing", (p) => p.getByLabel("Test results").check());
  await seesOnDashboard("Missing test results");
});
await step("office: Received → detail updates without reload", async () => {
  await coord.goto(`${WEB}/referrals/${rid}`);
  await officeAct("Received");
  await coord.getByTestId("timeline").getByText("Received", { exact: true }).first().waitFor({ timeout: T });
});
await step("office: Patient contacted → detail shows it", async () => {
  await officeAct("Patient contacted", (p) => p.getByLabel("Patient told to call").check());
  await coord.getByTestId("timeline").getByText("Patient contacted", { exact: true }).waitFor({ timeout: T });
});
await step("office: Scheduled (date + time)", async () => {
  await officeAct("Scheduled", async (p) => {
    await p.getByLabel("Date", { exact: true }).fill("2027-01-12");
    await p.getByLabel("Time", { exact: true }).fill("13:30");
  });
  await coord.getByTestId("timeline").getByText("Scheduled", { exact: true }).waitFor({ timeout: T });
});
await step("office: No-show → dashboard 'Missed appointment'", async () => {
  await officeAct("No-show");
  await coord.goto(WEB);
  await seesOnDashboard("Missed appointment");
});
await step("office: Scheduled again, Seen", async () => {
  await officeAct("Scheduled", async (p) => {
    await p.getByLabel("Date", { exact: true }).fill("2027-01-19");
    await p.getByLabel("Time", { exact: true }).fill("09:00");
  });
  await officeAct("Seen");
  await coord.getByTestId(`row-${rid}`).getByTestId("row-status").getByText("Seen").waitFor({ timeout: T });
});
await step("office: Return plan → Inbox", async () => {
  await officeAct("Return plan", async (p) => {
    await p.getByLabel("Assessment", { exact: true }).fill("CKD stage 3a, stable.");
    await p.getByLabel("Plan", { exact: true }).fill("Repeat labs in 3 months, ordered by nephrology.");
  });
  await signIn(coord, AVERY);
  await coord.goto(`${WEB}/inbox`);
  await coord.getByTestId(`inbox-${rid}`).getByTestId("returned-plan").getByText(/Repeat labs/).waitFor({ timeout: T });
});
await step("Acknowledge and close → timeline Closed", async () => {
  await coord.getByTestId(`inbox-${rid}`).getByRole("button", { name: "Acknowledge and close" }).click();
  await coord.getByTestId(`inbox-${rid}`).waitFor({ state: "detached", timeout: T });
  await coord.goto(`${WEB}/referrals/${rid}`);
  await coord.getByTestId("timeline").getByText("Closed", { exact: true }).waitFor({ timeout: T });
});
await step("FHIR export validates", async () => {
  const [dl] = await Promise.all([coord.waitForEvent("download", { timeout: T }), coord.getByRole("link", { name: "Download FHIR" }).click()]);
  const file = path.join(ROOT, `.e2e-core-fhir.json`);
  await dl.saveAs(file);
  const out = execFileSync(path.join(ROOT, ".venv/bin/python"), ["-c", `
import json,sys
from fhir.resources.R4B.bundle import Bundle
b=json.load(open(sys.argv[1])); Bundle.model_validate(b)
t={e['resource']['resourceType']:e['resource'] for e in b['entry']}
assert t['Task']['status']=='completed' and t['ServiceRequest']['priority']=='urgent'
assert t['Coverage']['type']['text']=='MassHealth PCC Plan'
print('valid')`, file]).toString();
  execFileSync("rm", ["-f", file]);
  assert(out.startsWith("valid"), out);
});
await coord.request.post(`${WEB}/api/clear-data`, { data: { confirm: "DELETE" } });
await browser.close();
console.log("CORE LOOP PASS");
