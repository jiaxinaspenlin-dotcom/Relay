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
