// AI call wiring through the UI. Never calls a real office:
//  1. Browser assistant (phone calling switched off for this page): "Call office" opens the
//     CallAssistant and "Start call" reaches POST /api/referrals/{id}/call-session.
//  2. Background phone call (default): "Call office" → "Calling {practice}…" → "Call finished,
//     review update" → result card → Apply updates the timeline. The real call-office request is
//     swapped for an e2e-only fake call; the server's real transcript pipeline reads the sample.
//  3. A not-received call → "Office says not received" → Resend referral clears it.
//  4. Clinicians get no call buttons.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const T = 15000;
const assert = (c, m) => { if (!c) throw new Error(m); };
const turns = (name) => readFileSync(path.join(ROOT, "docs", name), "utf8").split("\n").filter((l) => l.trim())
  .map((l) => { const i = l.indexOf(":"); return { role: l.slice(0, i).trim(), message: l.slice(i + 1).trim() }; });

const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ permissions: ["microphone"] });
const page = await ctx.newPage();
const h = await (await page.request.get(`${WEB}/api/health`)).json();
if (h.db !== "relay-e2e.db") throw new Error(`Refusing to touch '${h.db}'`);
await page.request.post(`${WEB}/api/test/reset`);
await page.request.post(`${WEB}/api/sample-data`);
const cfg = await (await page.request.get(`${WEB}/api/config`)).json();

// Safety net: no request from this browser ever reaches the real call-office endpoint.
const fakeCalls = [];
await ctx.route("**/api/referrals/*/call-office", async (route) => {
  const rid = route.request().url().split("/").at(-2);
  const r = await page.request.post(`${WEB}/api/test/calls`, { data: { referral_id: rid } });
  const body = await r.json();
  fakeCalls.push(body.call);
  await route.fulfill({ status: r.status(), contentType: "application/json", body: JSON.stringify(body) });
});
let phoneMode = false;
await ctx.route("**/api/config", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...cfg, phone_calling_enabled: phoneMode }) }));

await page.goto(`${WEB}/sign-in`);
await page.getByRole("button", { name: /coordinator \(sample\)/ }).click();
await page.waitForURL(`${WEB}/`);
await page.goto(`${WEB}/?tab=lost`);

// 1. Browser assistant fallback
const calls = [];
page.on("request", (r) => { if (r.url().includes("/call-session")) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
await page.getByTestId("row-R-102").getByRole("button", { name: "Call office" }).click();
if (cfg.voice_enabled) {
  const dialog = page.getByRole("dialog", { name: "Call office" });
  await dialog.getByText("Call the office with the AI assistant").waitFor({ timeout: T });
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/call-session"), { timeout: T }),
    dialog.getByRole("button", { name: "Start call" }).click(),
  ]);
  assert(calls.includes("POST /api/referrals/R-102/call-session"), "call-session not requested at the expected path");
  assert(res.status() !== 404, "call-session returned 404");
  await page.waitForTimeout(500);
  const alert = await dialog.getByRole("alert").allInnerTexts();
  console.log("1 browser assistant:", res.status(), alert.join(" ") || "(connected)");
  await page.keyboard.press("Escape");
} else {
  await page.getByRole("dialog", { name: "Log update" }).waitFor({ timeout: T });
  console.log("1 voice disabled: Call office opens Log update");
  await page.keyboard.press("Escape");
}

// 2. Background phone call: chip states on the row, live call card on the detail
phoneMode = true;
await page.goto(`${WEB}/?tab=lost`); // fresh page so the config is read again
const row = page.getByTestId("row-R-102");
const btnBox = await row.getByRole("button", { name: "Call office" }).boundingBox();
await row.getByRole("button", { name: "Call office" }).click();
const chip = row.getByTestId("row-call");
await chip.getByText("Dialing office").waitFor({ timeout: T });
const chipBox = await chip.boundingBox();
assert(Math.abs(chipBox.height - btnBox.height) < 1, `chip height ${chipBox.height} vs button ${btnBox.height}`);
assert(fakeCalls.length === 1, `expected one fake call, got ${fakeCalls.length}`);
const cid = fakeCalls[0].id;
await page.request.post(`${WEB}/api/test/calls/${cid}/phase`, { data: { phase: "in-progress" } });
await chip.getByText(/^On the call \d+:\d\d$/).waitFor({ timeout: T });
await page.goto(`${WEB}/referrals/R-102`);
const live = page.getByTestId("live-call");
await live.getByText(/AI assistant is on the call with /).waitFor({ timeout: T });
await live.getByText("You can keep working").waitFor();
assert(await page.getByTestId("header-primary").count() === 0, "header primary shown during the call");
await page.request.post(`${WEB}/api/test/calls/${cid}/phase`, { data: { phase: "processing" } });
await live.locator('[aria-current="step"]').getByText("Summarizing").waitFor({ timeout: T });
await page.goto(`${WEB}/?tab=lost`);
await chip.getByText(/^Reading the call \d+:\d\d$/).waitFor({ timeout: T });
await page.request.post(`${WEB}/api/test/calls/${cid}/finish`,
  { data: { status: "done", duration_secs: 92, turns: turns("sample_call_transcript.txt") } });
await chip.getByRole("button", { name: "Review call update" }).click();
await page.waitForURL(`${WEB}/referrals/R-102#call-result`);
const card = page.getByTestId("call-result");
await card.waitFor({ timeout: T });
const summary = await card.getByTestId("call-summary").innerText();
assert(summary === "Received, missing records. Patient not contacted yet. Scheduling: 413-555-0142, Mon–Fri 8–4", `summary: ${summary}`);
await card.getByText("View transcript").click();
assert(!(await card.getByTestId("call-transcript").innerText()).includes("[happy]"), "voice tags shown");
await card.getByRole("button", { name: "Apply" }).click();
await card.waitFor({ state: "detached", timeout: T });
await page.getByTestId("toast").getByText("Call update applied").waitFor({ timeout: T });
await page.getByTestId("timeline").getByText("AI call by Sam Ortiz, 1:32 · Missing: records · Scheduling: Mon–Fri 8–4 · 413-555-0142").waitFor({ timeout: T });
console.log("2 phone call: Dialing → On the call → Reading → Review call update → Apply → timeline");

// 3. Not received → Office says not received → Resend referral
await page.goto(`${WEB}/?tab=waiting`);
await page.getByTestId("row-R-101").getByRole("button", { name: "Call office" }).click();
await page.getByTestId("row-R-101").getByTestId("row-call").getByText("Dialing office").waitFor({ timeout: T });
await page.request.post(`${WEB}/api/test/calls/${fakeCalls[1].id}/finish`,
  { data: { status: "done", duration_secs: 75, turns: turns("sample_call_not_received.txt") } });
await page.goto(`${WEB}/referrals/R-101`);
await page.getByTestId("call-summary").getByText("Not received, resend via portal. Scheduling: 413-555-0142, Mon–Fri 8–4").waitFor({ timeout: T });
await page.getByTestId("call-result").getByRole("button", { name: "Apply" }).click();
await page.getByTestId("status-line").getByText(/The office says it was not received; resend via portal\.$/).waitFor({ timeout: T });
await page.goto(`${WEB}/?tab=waiting`);
await page.getByTestId("row-R-101").getByTestId("row-status").getByText(/^Office says not received /).waitFor({ timeout: T });
await page.getByTestId("row-R-101").getByRole("button", { name: "Resend referral" }).click();
const send = page.getByRole("dialog", { name: "Resend referral" });
await send.getByRole("button", { name: "Copy text" }).click();
await page.getByTestId("toast").getByText(/^Referral resent to /).waitFor({ timeout: T });
// Resent today, so it's no longer stuck: it leaves Waiting for On track.
await page.getByTestId("waiting").getByTestId("row-R-101").waitFor({ state: "detached", timeout: T });
await page.getByTestId("tab-ontrack").click();
await page.getByTestId("on-track").getByTestId("row-R-101").getByTestId("row-status").getByText(/^Sent /).waitFor({ timeout: T });
await page.goto(`${WEB}/referrals/R-101`);
await page.getByTestId("timeline").getByText("Referral resent").waitFor({ timeout: T });
console.log("3 not received: flagged, resend clears it");

// 4. No answer
await page.goto(`${WEB}/?tab=lost`);
const noAns = await (await page.request.post(`${WEB}/api/test/calls`, { data: { referral_id: "R-102" } })).json();
await page.request.post(`${WEB}/api/test/calls/${noAns.call.id}/finish`, { data: { status: "done", duration_secs: 30, turns: [] } });
const na = page.getByTestId("row-R-102").getByTestId("row-call");
await na.getByText("No answer", { exact: true }).waitFor({ timeout: T });
await na.getByRole("button", { name: "Try again" }).waitFor();
console.log("4 no answer shown on the row");

// 5. Clinicians never get call buttons.
const clin = await (await browser.newContext()).newPage();
await clin.goto(`${WEB}/sign-in`);
await clin.getByRole("button", { name: /clinician \(sample\)/ }).click();
await clin.waitForURL(`${WEB}/inbox`);
await clin.goto(`${WEB}/referrals/R-109`);
await clin.getByRole("heading", { level: 1 }).waitFor({ timeout: T });
assert(await clin.getByRole("button", { name: /^Call office/ }).count() === 0, "clinician sees Call office");
await page.request.post(`${WEB}/api/test/reset`);
await browser.close();
console.log("CALL UI PASS");
