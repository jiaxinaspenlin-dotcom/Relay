# Design — Relay: closing the referral loop

## 1. Architecture

```
 data/public/ (committed snapshots)          data/synthetic/ (Synthea + seeded referrals)
   clinicians_ma.csv  hospitals_cms_ma.csv      patients/*.json   referrals.json
   hospitals_massgis.csv   places_county.csv          │
   ej_blockgroups.csv  hrsa_hpsa_pc_ma.csv            │
   towns.csv (centroids, county)                      │
          │                                           │
          ▼                                           ▼
   finder/ practices · distance · rank        loop/ states · stuck · timeline
   context/ place                             drafting/ facts · templates · llm · verify
          └──────────────┬────────────────────────────┘
                         ▼
             FastAPI  /api/{dashboard, referrals, finder, specialist, inbox, export}
                         ▼
   React: Dashboard · Referral detail · New referral (finder + map)
          · Specialist office (simulated portal, deferred) · PCP inbox · Patient status*
```

Everything runs locally. The app reads only committed snapshots. `DEMO_TODAY=2026-10-24` fixes the clock.
"Business days" in stuck rules are Mon–Fri with no holiday calendar.

## 2. Data

### 2.1 Public snapshots (`scripts/fetch_*.py` → `data/public/`)
| File | Source (cite the agency) | Level | Used for | Caveat to show |
|---|---|---|---|---|
| `clinicians_ma.csv` | CMS Provider Data Catalog — Doctors and Clinicians national file, filtered `state=MA` (dataset `mj5m-pzi6`; columns in §5; no hospital-affiliation columns) | clinician × location | finder | Medicare-enrolled clinicians only. No availability data. Telehealth column not shown. |
| `hospitals_cms_ma.csv` | CMS Hospital General Information / star ratings (`xubh-q36u`, MA) | hospital | rating, type, emergency services for the nearest hospital, exact name match only | Ratings summarize measures. They're not a referral recommendation. |
| `readmissions_ma.csv` (optional) | CMS HRRP (`9n3s-kdb3`, MA) | hospital × condition | hospital detail drawer only | Risk-adjusted ratios. Many cells suppressed. |
| `hospitals_massgis.csv` | Mass. hospitals layer (ArcGIS, `returnGeometry=true&outSR=4326`) | hospital point | nearest hospital to practice and patient towns, bed/ICU counts, map | Bed counts ≠ specialty availability. |
| `places_county.csv` | CDC PLACES (`swc5-untb`), MA, 5 measures, crude prevalence, year from data | **county** | place context | Model-based county estimates, not about any person. |
| `ej_blockgroups.csv` | Mass. EJ 2020 block groups (`EJ='Yes'`) | block group → town | place context | Criteria are about block-group populations. |
| `hrsa_hpsa_pc_ma.csv` | HRSA Data Warehouse → Data Downloads → Shortage Areas (primary care HPSA), filtered MA. Download manually if scripting is blocked. | designation area | place context | Designations cover areas, populations, or facilities. Show the type. |
| `towns.csv` | MassGIS towns layer centroids, with fallback to the Census Gazetteer (county subdivisions, MA) | town | distance, town → county | Straight-line from the town center only. |

`data/public/SOURCES.md` records URL, agency, retrieval date, filters, and terms. Link the Mass.
rural health page and the MassGIS layer page in the README; don't republish them.

### 2.2 Synthetic data
- **Synthea** (`run_synthea -s 42 -p 40 Massachusetts <Town>`), run once each for western/central-MA
  towns such as Greenfield, Orange, Athol, North Adams, Great Barrington, and Ware. Confirm each name is
  accepted, and swap if not. `select_patients.py` keeps ~10 adults with a condition that plausibly
  needs a specialist (e.g., heart failure, diabetes, CKD, Crohn's) and records their payer.
- **`seed_referrals.py`** (seed 42, `DEMO_TODAY=2026-10-24`) creates the archetypes below. Seeded
  specialists are **fictional practices** (e.g., "Pioneer Valley Heart Associates (fictional)") placed
  in real cities, so distances are real but no real office is shown as slow.

| ID | Stage / situation | Dates | Shows |
|---|---|---|---|
| R-101 | Sent, no response | sent 10-17 | stuck: no response |
| R-102 | Accepted, **no appointment**; transportation barrier open | accepted 10-10 | **challenge failure 1** |
| R-103 | Scheduled | appt 11-03 | healthy, far away |
| R-104 | Seen, **no plan returned** | seen 10-12 | **challenge failure 2** |
| R-105 | Plan returned, not yet acknowledged | returned 10-22 | PCP inbox |
| R-106 | Closed | closed 10-05 | full timeline |
| R-107 | Declined (no capacity) | declined 10-20 | needs re-route |
| R-108 | No-show; schedule/work barrier | appt 10-15 | stuck: no-show |

The live demo creates one new referral through the finder (real practices, simulated responses).

## 3. Loop states (`loop/states.py`)
Modeled on HL7 BSeR: a `ServiceRequest` (the referral) plus a `Task` that tracks fulfillment.
`Task.status` uses FHIR codes, and `Task.businessStatus` uses a local CodeSystem for finer stages.

| Stage | Task.status | businessStatus | Allowed next |
|---|---|---|---|
| Draft | draft | — | Sent, Cancelled |
| Sent | requested | sent | Accepted, Declined, Cancelled |
| Accepted | accepted | accepted | Scheduled, Patient barrier, Cancelled |
| Scheduled | in-progress | scheduled (+ `Appointment` booked) | Seen, No-show, Patient barrier, Cancelled |
| No-show | in-progress | no-show (Appointment noshow) | Scheduled, Patient barrier, Cancelled |
| Seen | in-progress | visit-completed (Appointment fulfilled) | Plan returned |
| Plan returned | completed | plan-returned (`Task.output` → Composition) | Closed |
| Closed | completed | closed-by-referrer | — |
| Declined | rejected | declined | (re-route = new referral linked via `replaces`) |
| Patient barrier | on-hold | patient-barrier | previous stage |
| Cancelled | cancelled | cancelled | — |

## 4. Stuck rules (`loop/stuck.py`, practice settings in `config.py`)
| Rule | Default | Message (template) | Challenge link |
|---|---|---|---|
| Sent, no response | 3 business days | "Sent {n} business days ago — no response from {org}" | |
| Accepted, no appointment | 7 days | "Accepted {n} days ago — no appointment yet" | failure 1 |
| Appointment passed, not marked seen | 2 days | "Appointment was {date} — visit not confirmed" | |
| No-show | immediate | "Missed appointment on {date}" | |
| Seen, no plan | 7 days | "Seen {n} days ago — plan not received" | failure 2 |
| Plan not acknowledged | 3 days | "Plan received {n} days ago — not yet reviewed by PCP" | failure 2 |
| Declined, not re-routed | 2 days | "Declined {n} days ago — no new referral" | |
| Barrier open | 7 days | "{barrier} barrier open {n} days" | |

The UI labels these defaults "Practice setting". Tests cover each rule boundary (n−1, n).

## 5. Specialist finder (`finder/`)
Source file: `clinicians_ma.csv` (CMS `mj5m-pzi6`). Columns read: `npi` (count only, never
output), `pri_spec`, `facility_name`, `org_pac_id` (organization identifier for FHIR), `adr_ln_1`,
`city_town`, `state`, `zip_code`, `ind_assgn`, `grp_assgn`. `ind_pac_id` and `telehlth` are not
loaded. The file has **no hospital-affiliation columns**, and `telehlth` is never shown (R3.7).

1. **Practices:** filter on these exact `pri_spec` strings (one per demo specialty, no others):

   | Demo specialty | `pri_spec` | MA rows |
   |---|---|---|
   | Cardiology | `CARDIOVASCULAR DISEASE (CARDIOLOGY)` | 2,139 |
   | Endocrinology | `ENDOCRINOLOGY` | 888 |
   | Gastroenterology | `GASTROENTEROLOGY` | 1,239 |
   | Nephrology | `NEPHROLOGY` | 740 |

   Group by (`facility_name`, `adr_ln_1`, normalized `city_town`, `zip_code[:5]`); `zip_code` is
   ZIP+4. Per group: distinct `npi` count, and Medicare assignment from `ind_assgn`. CMS data
   dictionary: `Y` = clinician accepts the Medicare-approved amount as payment in full; `M` =
   clinician may accept Medicare assignment. These are the only values. Practice label: all `Y` →
   "Accepts Medicare assignment"; any `M` → "May accept Medicare assignment — confirm with the
   office". Never "No". (`grp_assgn` is read but not used for the label.) Blank `facility_name`
   (73 of 637 groups) → label "Practice at {adr_ln_1}, {Town}". No clinician names are output.
   Organization names are shown as CMS spells them (some real names contain words like
   "Affiliated"; wording tests exempt source names, not Relay's own labels).
2. **Town normalization** (`finder/towns.py`): `city_town` is mostly uppercase with some mixed case.
   Normalize: trim, uppercase, collapse spaces, expand `N`/`S`/`E`/`W` prefixes, then apply a
   village → town map before matching uppercased `towns.csv.town`. Seed the map from the snapshot's
   unmatched values, e.g. HYANNIS → Barnstable; BRIGHTON, DORCHESTER, JAMAICA PLAIN, ROSLINDALE,
   CHARLESTOWN, SOUTH BOSTON, WEST ROXBURY, ROXBURY CROSSING → Boston; NORTH DARTMOUTH → Dartmouth;
   SOUTH WEYMOUTH → Weymouth; FLORENCE → Northampton; NORTH/SOUTH EASTON → Easton; NORTH ATTLEBORO
   → North Attleborough; NORTH CHELMSFORD → Chelmsford; SOUTH HAMILTON → Hamilton; CHESTNUT HILL →
   Newton (spans Newton/Brookline; Newton chosen 2026-10-24); plus source typos (WORCESTEER →
   Worcester). S YARMOUTH expands to South Yarmouth, which is its own place in `towns.csv`. Without
   the map, 69 of 637 groups (10.8%) are unmatched; with it, 0 of 978 specialty × location groups
   are (asserted < 10% in tests). Unmatched → "distance unavailable".
3. **Distance:** haversine from the patient's town centroid to the practice town centroid, in
   miles, rounded to whole miles.
4. **Nearest hospital** (replaces affiliated hospitals): from `hospitals_massgis.csv`, keep
   `FACILITY_TYPE = "Acute Hospital"` (70 of 103 rows), and pick the one closest to the practice
   town centroid (haversine to `lat`/`lon`, whole miles). Beds = `MED_SURG + ICU + PEDIATRIC`,
   labeled exactly "med/surg + ICU + pediatric beds" (never "total beds"); ICU shown separately.
   Card label: "Nearest hospital", never "affiliated".
5. **CMS rating join:** normalize both names (uppercase, `&` → `AND`, punctuation → space, collapse
   spaces). Only an **exact** match of MassGIS `FACILITY_NAME` to CMS `facility_name` attaches
   `hospital_overall_rating`, `hospital_type`, and `emergency_services`. No fuzzy matching, no city
   fallback. A non-numeric rating ("Not Available") counts as no rating. Unmatched → the card shows
   nothing for rating. In the snapshot, 36 of 103 MassGIS names match exactly.
6. **Rank:** distance ascending only (ties by organization label). No rating sort, no composite
   score. Unmatched-distance practices go last.
7. **Map (SHOULD):** patient town + top 5 practices + their nearest hospitals, with straight lines
   labeled in miles and an attribution line.

## 6. Place context (`context/place.py`)
For the patient's town: county (from `towns.csv`), PLACES measures with 95% CI, EJ block groups in the
town (count + criteria), HRSA primary-care HPSA designations touching the county (type + score
if present), and 3 nearest hospitals (miles, beds, ICU). Each item carries `{source, year, level,
cannot_tell_you}`.

## 7. FHIR R4 export (`export/fhir.py`)
`Bundle.type = collection`, validated with `fhir.resources.R4B`.

| Resource | Content |
|---|---|
| `Patient`, `Condition` | from Synthea |
| `Practitioner` + `PractitionerRole` | PCP (synthetic). Specialist side at organization level |
| `Organization` + `Location` | specialist practice. Directory orgs carry `identifier` = CMS org PAC ID and `meta.tag` public-directory |
| `ServiceRequest` | `intent: order`, `category`: referral (verify the SNOMED "Patient referral" code before use), `code.text` = specialty, `priority` (PCP-set), `reasonReference` → Condition, `requester`, `performer`, `supportingInfo` → packet resources |
| `Task` | `focus` → ServiceRequest, `for`, `requester`, `owner`, `status` + `businessStatus` (§3), `authoredOn`, `lastModified`, `output` → Composition |
| `Appointment` | start, status (booked / fulfilled / noshow), participant = Patient + Location |
| `Communication` | each sent follow-up: `basedOn` → ServiceRequest, `recipient`, `sent`, payload text |
| `Composition` | returned plan, sections per R7.2, `author` = specialist org, `status: final` |
| `Provenance` | per transition (target Task, agent, recorded). AI-drafted messages add a Device agent |

All resources get `meta.tag` `https://relay.local/fhir/CodeSystem/data-origin|synthetic`.

## 8. Drafting and verification (`drafting/`)
- `facts.py` turns referral + chart + barriers into `Fact` objects (ID, label, value, numbers[], dates[], source).
- `templates.py` holds the packet summary and follow-ups per recipient × stuck rule, each sentence cited.
- `llm.py` (SHOULD) uses facts only, a pseudonymous key, and temperature 0.
- `verify.py`: every sentence has existing `[F#]` citations, every number and date is in the cited
  facts, and copy guard passes. Otherwise fall back to the template and show the reason. Adversarial
  tests: invented date, wrong day count, "recommend", "45 minutes away", "high-risk patient".

## 9. Screens
Visual direction: calm operations tool. White surfaces, one accent, a monospace numeric style, and
stage colors always paired with labels. The **LoopStepper** (Sent → Accepted → Scheduled → Seen →
Plan back → Closed) is the signature element, repeated on every card and page.

1. **Dashboard:** "Needs attention" cards (rule sentence, days, barrier chips, "Draft follow-up"),
   pipeline columns by stage, and counts (labeled synthetic).
2. **Referral detail:** LoopStepper with dates, event timeline, packet tables, barriers panel,
   place-context panel (source chips and "can't tell you" lines), follow-up drawer
   (template / AI-verified, edit, Send), Download FHIR.
3. **New referral:** form → specialty → practice cards + mini-map → choose → packet preview → Send.
4. **Specialist office (simulated portal) — deferred until the MVP passes:** incoming referrals for the chosen practice. Accept / Decline /
   Schedule / Seen / No-show / Return plan (template-shaped form, pre-filled synthetic text available
   for the demo).
5. **PCP inbox:** returned plans beside the original reason and timeline. "Acknowledge & close".
6. **Patient status (SHOULD):** plain-language stepper, appointment city and date, barrier self-report.

## 10. Demo script (3 minutes)
1. **0:00** Read the brief's two failure lines. "Relay catches both." Dashboard: Needs attention shows
   R-102 "Accepted 14 days ago — no appointment yet" and R-104 "Seen 12 days ago — plan not received".
2. **0:25** Open R-102: patient in a western-MA town, practice N miles straight-line away,
   transportation barrier open. Place context: county checkup rate with CI, EJ status, and HRSA
   shortage designation, each with its source and what it can't tell you.
3. **0:55** "Draft follow-up" → message to the office with citation chips (dates verified). Edit
   and Send. Logged as a Communication.
4. **1:20** New referral, live: patient in North Adams → cardiology. Finder lists real MA practices
   by distance, with Medicare assignment and nearest hospital (CMS rating where matched). Mini-map. Choose → Send.
5. **1:50** R-104 → Log update "plan received (fax)". PCP inbox → plan beside the original
   reason → Acknowledge & close. Dashboard: stuck count drops, closed count rises.
6. **2:25** Download FHIR → ServiceRequest, Task (status + businessStatus), Appointment, Composition.
7. **2:45** `.kiro/`: the copy guard catching "35 minutes away" during the build (from KIRO.md).
   Close: "Next: the same loop carries home-monitoring data back to primary care, so a rural patient
   can skip a long drive for a follow-up check."

## 11. Real vs simulated (say it out loud)
| Real public data | Synthetic / simulated |
|---|---|
| MA clinician practices, specialties, Medicare assignment (CMS) | Patients (Synthea), referrals, appointments, messages |
| Hospital ratings and type (CMS), locations and beds (MassGIS) | Specialist responses and returned plans |
| County health estimates (CDC PLACES), EJ areas (Mass.), shortage areas (HRSA) | Delivery (production: Direct, HIE, or FHIR exchange) |
| FHIR R4 resources, validated | Practice settings for stuck thresholds |
