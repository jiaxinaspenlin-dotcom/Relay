// AI call wiring through the UI: "Call office" on a stuck-at-Received referral opens the
// CallAssistant, "Start call" reaches POST /api/referrals/{id}/call-session (not a 404), and a
// clinician doesn't get the AI call. Fake microphone; never calls a real office.
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const T = 15000;
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const page = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
const h = await (await page.request.get(`${WEB}/api/health`)).json();
if (h.db !== "relay-e2e.db") throw new Error(`Refusing to touch '${h.db}'`);
await page.request.post(`${WEB}/api/test/reset`);
await page.request.post(`${WEB}/api/sample-data`);
const voice = (await (await page.request.get(`${WEB}/api/config`)).json()).voice_enabled;

await page.goto(`${WEB}/sign-in`);
await page.getByRole("button", { name: "Sign in as coordinator (sample)" }).click();
await page.waitForURL(`${WEB}/`);
const calls = [];
page.on("request", (r) => { if (r.url().includes("/call-")) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
const statuses = [];
page.on("response", (r) => { if (r.url().includes("/call-")) statuses.push(r.status()); });

await page.getByTestId("row-R-102").getByRole("button", { name: "Call office" }).click();
if (voice) {
  const dialog = page.getByRole("dialog", { name: "Call office" });
  await dialog.getByText("Call the office with the AI assistant").waitFor({ timeout: T });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/call-session"), { timeout: T }),
    dialog.getByRole("button", { name: "Start call" }).click(),
  ]);
  await page.waitForTimeout(500);
  console.log("requests:", calls.join(", "), "statuses:", statuses.join(", "));
  if (!calls.includes("POST /api/referrals/R-102/call-session")) throw new Error("call-session not requested at the expected path");
  if (statuses.includes(404)) throw new Error("call-session returned 404");
  const alert = await dialog.getByRole("alert").allInnerTexts();
  console.log("assistant says:", alert.join(" ") || "(connected)");
} else {
  await page.getByRole("dialog", { name: "Log update" }).waitFor({ timeout: T });
  console.log("voice disabled: Call office opens Log update");
}
// Clinicians never get the AI call.
const clin = await (await browser.newContext()).newPage();
await clin.goto(`${WEB}/sign-in`);
await clin.getByRole("button", { name: "Sign in as clinician (sample)" }).click();
await clin.waitForURL(`${WEB}/inbox`);
await clin.goto(`${WEB}/referrals/R-102`);
await clin.getByRole("heading", { level: 1 }).waitFor({ timeout: T });
if (await clin.getByRole("button", { name: "Call office (AI)" }).count()) throw new Error("clinician sees the AI call");
await page.request.post(`${WEB}/api/test/reset`);
await browser.close();
console.log("CALL UI PASS");
