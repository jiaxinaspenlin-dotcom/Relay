# Implementation Plan — Relay referral loop (≈ 7 hours)

Times are caps. If a block hits its cap, take the cut action and move on.

| Block | Clock | Cut action if over |
|---|---|---|
| 1 Data snapshots + synthetic seed | 0:00–1:00 | Drop readmissions and HRSA (keep a "not loaded" note) |
| 2 Loop + finder + context | 1:00–2:30 | Finder: 2 specialties instead of 4 |
| 3 Drafting + plan back + FHIR | 2:30–3:30 | Skip the LLM (templates only) |
| 4 Interface | 3:30–6:00 | Cut patient view, then mini-map |
| 5 Docs + rehearsal | 6:00–7:00 | Never cut |
| Stretch: home-monitoring beat | only if all MUSTs pass by 5:00 | Mention as "next" in the pitch |

**Cut order:** patient view (R9) → AI drafting (R4.5) → mini-map (R3.6) → readmissions drawer →
HRSA context. **Never cut:** dashboard stuck list, LoopStepper, finder with distance and Medicare
assignment, simulated specialist and plan back, PCP close, FHIR export, synthetic labels, KIRO.md.

**Two people?** Split at 0:20. Person A takes blocks 1–3. Person B builds block 4 against
`frontend/src/mock/*.json` (written in task 1.6) and swaps in the real API at 3:30.

---

## MVP — thin end-to-end path (before any polish)
Deferred until all five pass: patient view, map, LLM, readmissions drawer, Specialist office
(simulated portal).
- [x] M1 Dashboard on the real API: Needs attention (R-102, R-104 messages), pipeline, counts
- [x] M2 New referral (North Adams live patient → Cardiology → real practices → Send) shows as Sent
- [x] M3 Log update (R2.5) + Demo clock (R1.5): accepted (phone) then +7 days → "Accepted 7 days ago — no appointment yet"
- [x] M4 Template follow-up with [F#] citations → edit → Send → Communication on the timeline
- [ ] M5 Log "plan received" → PCP inbox beside reason → Acknowledge & close → FHIR bundle (test_fhir.py)
- Guards: no page imports `src/mock/`; no backend real-clock calls outside config.py.

## Block 1 — Data (0:00–1:00)
- [x] 1.1 Scaffold the repo per structure.md: FastAPI, Vite React TS + Tailwind, Makefile (`setup`,
  `data`, `dev`, `test`, `check-copy`), with the copy guard in `make test`. Set `DEMO_TODAY` in config.
  - _Requirements: 11.3_
- [x] 1.2 Fetch scripts for clinicians (MA, paged), CMS hospitals, PLACES county, EJ, MassGIS
  hospitals (with geometry), and town centroids. Write snapshots and `SOURCES.md`. Confirm the
  clinician dataset ID and the exact `pri_spec` strings for 4 specialties.
  - _Requirements: 11.1, 3.2, 6.1_
- [x] 1.3 Manually download the HRSA primary-care HPSA file, then `load_hrsa.py` filters MA (≤ 10 min;
  otherwise cut)
  - _Requirements: 6.1_
- [x] 1.4 `run_synthea.sh` for the western-MA towns, plus `select_patients.py` (~10 patients with
  specialist-relevant conditions and payer)
  - _Requirements: 3.1, 4.1_
- [x] 1.5 `seed_referrals.py` for archetypes R-101…R-108 with fictional practices
  - _Requirements: 1.1, 2.3, 5.1_
- [x] 1.6 Mock API fixtures for the frontend (dashboard, referral detail, finder results)
  - _Requirements: 1.1_

## Block 2 — Core logic (1:00–2:30)
- [x] 2.1 `loop/states.py` transitions table, plus `test_loop.py` covering valid/invalid transitions
  and event logging
  - _Requirements: 2.1, 2.2, 5.3_
- [x] 2.2 `loop/stuck.py` rules with practice settings, plus boundary tests. **Checkpoint:** R-102
  and R-104 flagged with the exact messages.
  - _Requirements: 2.3, 2.4, 1.2_
- [x] 2.3 `finder/practices.py`, `distance.py` (normalization map, haversine), `rank.py`, plus
  `test_finder.py` (unmatched-city rate < 10%, no individual names in output)
  - _Requirements: 3.2, 3.3, 3.4, 3.5_
- [x] 2.4 `context/place.py` with source/year/level/cannot_tell_you on every item
  - _Requirements: 6.1, 6.2_
- [x] 2.5 Dashboard aggregates: counts and median days sent→scheduled
  - _Requirements: 1.3_

## Block 3 — Drafting, plan back, FHIR (2:30–3:30)
- [ ] 3.1 `drafting/facts.py` + `templates.py` (packet summary, follow-ups per recipient × rule)
  - _Requirements: 4.1, 4.2, 4.3_
- [ ] 3.2 `drafting/verify.py` + `test_verify.py` with the adversarial cases in design §8
  - _Requirements: 4.5_
- [ ] 3.3 (SHOULD) `drafting/llm.py` with verify-or-fallback
  - _Requirements: 4.5_
- [ ] 3.4 API: dashboard, referrals (get, create, transition, barriers, send message), finder,
  specialist actions, plan return, inbox acknowledge/close (with closure-reason rule), reset
  - _Requirements: 4.4, 5.1, 5.2, 7.1, 7.3, 8.2, 8.3_
- [ ] 3.5 `export/fhir.py` + `test_fhir.py` validating a bundle for every archetype
  - _Requirements: 10.1, 10.2_

## Block 4 — Interface (3:30–6:00)
- [ ] 4.1 Put strings in `copy.ts`. Build layout + SyntheticBanner, LoopStepper, StuckBadge,
  FactChip, SourceChip
  - _Requirements: 1.4, 7.4_
- [ ] 4.2 Dashboard (Needs attention, pipeline, counts)
  - _Requirements: 1.1, 1.2, 1.3_
- [ ] 4.3 Referral detail (stepper, timeline, packet, barriers, place context, follow-up drawer, FHIR download)
  - _Requirements: 4.1, 4.3, 4.4, 5.1, 5.2, 6.1, 6.2, 6.3, 10.1_
- [ ] 4.4 New referral + finder cards + telehealth note
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_
- [ ] 4.5 (SHOULD) Mini-map
  - _Requirements: 3.6_
- [ ] 4.6 (DEFERRED until MVP passes) Specialist office (simulated portal) with template-shaped plan form
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
- [ ] 4.7 PCP inbox with acknowledge & close
  - _Requirements: 8.1, 8.2, 8.3_
- [ ] 4.8 (SHOULD) Patient status view
  - _Requirements: 9.1_
- [ ] 4.9 **Checkpoint:** run demo script design §10 from a cold `make dev`, with "Reset demo" between runs.

## Block 5 — Docs and rehearsal (6:00–7:00)
- [ ] 5.1 README: setup, `make dev`, demo script, data provenance summary, links to Mass. rural health
  and MassGIS layer pages
  - _Requirements: 11.3, 11.1_
- [ ] 5.2 `docs/KIRO.md` with at least 2 real catches and screenshots of spec/tasks/hooks
  - _Requirements: 11.2_
- [ ] 5.3 `docs/PITCH.md` (passes the copy guard): the two failures, users, the loop, real vs
  simulated, assumptions A1–A3 untested, next step
  - _Requirements: 11.3_
- [ ] 5.4 Rehearse twice

## Stretch
- [ ] S.1 Home-monitoring follow-up: synthetic BP readings for R-105's patient → baseline/most recent
  table in the PCP inbox, labeled synthetic
  - _Requirements: 12.1_
