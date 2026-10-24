# Kiro log: catches and deviations

- 2026-10-24 — Data check before building: the CMS clinician file (`mj5m-pzi6`) has no
  hospital-affiliation columns. Spec changed R3.3 and design §5 from "affiliated hospitals" to
  "nearest acute hospital to the practice town" (MassGIS), with CMS star rating only on an exact
  normalized-name match (36 of 103 names). Rating sort dropped (R3.4): distance only.
- 2026-10-24 — Medicare assignment meaning confirmed in the CMS Doctors and Clinicians data
  dictionary (Y = accepts the Medicare-approved amount as payment in full; M = may accept). Labels
  changed to "Accepts…" / "May accept… — confirm with the office"; "No" removed. Copy guard gained
  rules for "doesn't accept Medicare", "Medicare assignment: No", "affiliated hospital", "total beds".
- 2026-10-24 — Finder wording test (`test_no_banned_wording_in_output`) flagged "affiliat" in the
  output. Cause: a real CMS organization name, "BMC AFFILIATED PHYSICIANS, INC." Fix: the test
  exempts source organization/hospital names and checks only Relay's own fields.
- 2026-10-24 — Town map: design listed S YARMOUTH → Yarmouth, but `towns.csv` has South Yarmouth
  as its own place. The test caught it; the map now leaves South Yarmouth as is.
- 2026-10-24 — Deviation: tech.md says Python 3.11; this machine has 3.12 (and 3.14), so `.venv`
  uses 3.12 (`make setup`, `PY_BOOT=python3.12`).
- 2026-10-24 — Hooks call bare `pytest` / `python`. Activate `.venv` (or put it on PATH) so the
  loop/finder test hook and copy-guard hook use the pinned environment.
- 2026-10-24 — Hooks now call `.venv/bin/python` and `.venv/bin/pytest` (was bare `python`/`pytest`).
- 2026-10-24 — Template review caught the no-show draft (sent to the patient) saying "The patient
  has an open … barrier". Patient-facing templates now use "We noted a … barrier", and
  `test_patient_messages_address_the_patient` guards it for every rule that fires in 14 days.
- 2026-10-24 — FHIR validation gap: fhir.resources R4B accepts `Task.status = "bogus"` (no
  value-set enforcement). `test_fhir.py` now checks Task, ServiceRequest, Appointment, and
  Communication status codes itself, plus that every reference resolves inside the bundle.
- 2026-10-24 — New guards: `test_repo_rules.py` fails if backend code calls the real clock outside
  config.py, or if any frontend source imports `src/mock/`. The mock guard failed as designed while
  App.tsx still imported `mock/dashboard.json`, and passed once the dashboard was on the API.
- 2026-10-24 — Deviation: FHIR needs instants for Appointment.start and Provenance.recorded but
  Relay stores dates only. Export uses local midnight (America/New_York) with a "date only" comment.
- 2026-10-24 — Deviation: priority has no default on the New referral form. The PCP must pick
  routine or urgent, so Relay never sets priority (product.md hard boundary).
- 2026-10-24 — Added `playwright-core` 1.49.1 (dev, pinned; no browser download, uses installed
  Chrome) for `make e2e`: M1–M5 run through the real UI. All five pass.
