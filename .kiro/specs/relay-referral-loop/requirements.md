# Requirements — Relay: closing the referral loop (7-hour build)

## Introduction
Relay helps a rural primary-care practice in Massachusetts track every specialty referral from
"sent" to "plan back in the chart". It catches the two failures the challenge names (a referral with
no appointment, and a visit whose plan never returns) and drafts the follow-up for a person to send.
It shows distance and community context from real public data. Every clinical and scheduling
decision stays with people.

### Problem
In a rural practice, a referral often means a long trip to a specialist in another county. After
sending it, the practice has no shared view of whether it was accepted, scheduled, or attended, or
whether the plan came back. Coordinators chase by phone and fax, and the stuck cases are the ones
nobody notices.

### Untested assumptions (label as untested in the pitch)
- A1. Coordinators lack a single view of referral status across specialist offices.
- A2. Surfacing "stuck" referrals with a drafted follow-up shortens time to scheduling and to plan-back.
- A3. Showing distance and community context at the moment of choosing a specialist changes choices
  or prompts earlier barrier planning.

### Tiers
| Tier | Items |
|---|---|
| MUST | R1–R8, R10, R11 |
| SHOULD | R4.5 AI drafting (templates are MUST), R3.6 mini-map, R9 patient status view |
| STRETCH | R12 home-monitoring follow-up beat |
| OUT | Real patient data, real messaging or EHR integration, scheduling into real calendars, insurance eligibility checks, drive-time routing, accounts, database |

---

## R1 — Coordinator dashboard (MUST)
**User story:** As a referral coordinator, I want to see every open referral by stage, with the stuck
ones first, so that nothing falls through.
1. THE SYSTEM SHALL show open referrals grouped by stage: Sent, Accepted, Scheduled, Seen,
   Plan returned, plus Declined and Patient barrier.
2. THE SYSTEM SHALL show a "Needs attention" list at the top, sorted by days stuck, with each rule
   stated in words (e.g., "Accepted 12 days ago — no appointment yet").
3. THE SYSTEM SHALL show summary counts: open, stuck, closed this month, and median days from sent
   to scheduled. All are computed from the (synthetic) data and labeled as such.
4. THE SYSTEM SHALL show a persistent banner: "Synthetic patients and referrals. Specialist responses
   and delivery are simulated."
5. THE SYSTEM SHALL use the real date by default. Settings → "Demo mode" (off by default) adds a
   forward offset (+1 day, +7 days, back to today); while on, a banner reads "Demo mode: simulated
   date". Only `config.real_today()` reads the real clock.
6. THE SYSTEM SHALL persist data in SQLite, start empty ("No referrals yet", "Add a referral",
   "Load sample data"), and let the coordinator add a patient (name, Massachusetts town from
   towns.csv, coverage, optional date of birth). Sample records carry a "Sample" tag.

## R2 — Loop states and stuck rules (MUST)
1. THE SYSTEM SHALL model each referral as a FHIR-shaped `ServiceRequest` + `Task`, with the stages and
   allowed transitions in design.md §3. Invalid transitions SHALL be rejected.
2. THE SYSTEM SHALL record a timestamped event for every transition, with actor and note.
3. THE SYSTEM SHALL flag a referral as stuck when it matches a rule in design.md §4, including:
   accepted with no appointment after N days (**challenge failure 1**), and seen with no plan returned
   after N days (**challenge failure 2**).
4. Rule thresholds SHALL be practice settings, shown in the UI as "Practice setting", and never
   presented as clinical standards.
5. **Log update (primary real-world input path).** THE SYSTEM SHALL let the coordinator log what the
   specialist office reported: accepted, declined, scheduled (+ appointment date), seen, no-show, or
   plan received (care-update-shaped form, R7.2), with source (phone, fax, portal, other) and a
   note. Each update SHALL go through the design.md §3 transitions and be dated by the demo clock.

## R3 — New referral with specialist finder (MUST)
**User story:** As a PCP and coordinator, we want to see which practices offer the needed specialty,
how far they are from the patient's town, and the nearest hospital, so that we choose with the
patient's travel in mind.
1. THE SYSTEM SHALL let the PCP create a referral: patient, specialty, reason (free text), priority
   (routine / urgent, set by the PCP only), and the linked Condition from the chart.
2. THE SYSTEM SHALL list practice locations for the chosen specialty from the CMS clinician directory
   snapshot, grouped at organization + address level, **without individual clinician names**.
3. Each practice card SHALL show: organization, city, straight-line distance in miles from the
   patient's town center, number of clinicians in that specialty at that location, Medicare
   assignment, and the **nearest acute hospital to the practice town** from the MassGIS hospitals
   layer (`data/public/hospitals_massgis.csv`) with its straight-line miles from the practice town
   center and its bed count.
   - Medicare assignment comes from `ind_assgn` (CMS data dictionary: Y = clinician accepts the
     Medicare-approved amount as payment in full; M = clinician may accept Medicare assignment).
     WHEN every clinician at the location is `Y` THE SYSTEM SHALL show "Accepts Medicare
     assignment". WHEN any clinician is `M` it SHALL show "May accept Medicare assignment — confirm
     with the office". It SHALL NEVER show "No"; the data has no such value.
   - Bed count SHALL be labeled exactly "med/surg + ICU + pediatric beds", never "total beds". ICU
     beds MAY be shown separately.
   - WHEN that hospital's normalized name exactly matches a `facility_name` in
     `hospitals_cms_ma.csv` THE SYSTEM SHALL show its CMS overall star rating. Otherwise it SHALL
     show nothing for rating and SHALL NOT guess a match (no fuzzy matching).
   - The CMS clinician file (`mj5m-pzi6`) has no hospital-affiliation columns. THE SYSTEM SHALL NOT
     describe any hospital as "affiliated" with a practice; the label is "Nearest hospital".
4. THE SYSTEM SHALL sort by distance only. It SHALL NOT offer a rating sort, and SHALL NOT label
   any practice "best".
5. WHEN the patient's coverage is Medicare THE SYSTEM SHALL show the Medicare assignment status
   prominently. It SHALL NOT claim network status for any other coverage.
6. (SHOULD) THE SYSTEM SHALL show a mini-map with the patient's town and the top practices, with
   straight lines labeled in miles.
7. THE SYSTEM SHALL display the fixed note "Ask the office whether a telehealth visit is offered".
   It SHALL NOT display the CMS `telehlth` column or any value derived from it.

## R4 — Referral packet and follow-up drafting (MUST, 4.5 SHOULD)
1. THE SYSTEM SHALL generate a referral packet: patient demographics, reason (PCP's words), linked
   condition, active problems, medications, allergies, and recent relevant observations, all as
   deterministic tables from the Synthea chart.
2. THE SYSTEM SHALL generate a template summary paragraph with `[F#]` citations.
3. WHEN a referral is stuck THE SYSTEM SHALL offer a drafted follow-up for the right recipient
   (specialist office, patient, or PCP), with citations to dates and stage facts.
4. A human SHALL send every message. Sent messages are stored as `Communication` events on the timeline.
5. (SHOULD) WHEN an LLM is configured THE SYSTEM SHALL offer AI versions of 4.2 and 4.3 that pass the
   verification in ai-guardrails.md, or fall back to the template with the failure reason shown.

## R5 — Barriers (MUST)
1. THE SYSTEM SHALL let the coordinator record barriers on a referral: transportation, coverage,
   language/interpreter, schedule/work, cost, other (free text), each with status (open / addressed)
   and a note.
2. An open barrier SHALL show on the dashboard card and in follow-up drafts as a fact.
3. THE SYSTEM SHALL let the coordinator move a referral to "Patient barrier" and back.

## R6 — Place context (MUST)
**User story:** As a coordinator, I want context about the patient's town and county, so that I plan
for likely barriers. It is never a judgment about the patient.
1. THE SYSTEM SHALL show, for the patient's town and county: county CDC PLACES 2023 estimates
   (routine checkup, diabetes, obesity, frequent mental distress, smoking) with confidence intervals;
   whether the town contains environmental-justice block groups and which criteria; HRSA primary-care
   shortage designation for the area; and the nearest hospitals with straight-line distance and bed
   counts.
2. Every context item SHALL show source, year, and geographic level, and SHALL include a one-line
   "what this can't tell you" note.
3. Context SHALL never appear in messages to specialists or patients.

## R7 — Plan back (MUST) and Specialist office (simulated portal) (DEFERRED)
1. THE SYSTEM SHALL create an unguessable office update link (/office/{token}) per referral. The
   page (no login) shows the referral summary and lets the office accept, decline (reason required),
   schedule (date and time), mark seen or no-show, and return the plan. Each action goes through
   design.md §3 with actor = office, source = link. R2.5 "Log update" remains for phone/fax/other.
2. The returned plan SHALL use sections shaped by the CMS care-update template: Patient, From,
   Reason/Conditions, Visit date, Assessment, Plan, Actions for the PCP (optional), Questions/contact.
   ACCESS-specific fields (track, OAP measures) are omitted and the omission is noted.
3. Assessment and Plan SHALL be written by the specialist (entered as reported, or simulated).
   Relay never drafts them.
4. Every simulated action SHALL be labeled "Simulated response".

## R8 — PCP inbox and loop closure (MUST)
**User story:** As a PCP, I want the returned plan to land with the original referral, so that I can
act on it and close the loop.
1. THE SYSTEM SHALL show returned plans next to the original referral reason and the full loop timeline.
2. THE SYSTEM SHALL let the PCP "Acknowledge & close", which records time, name, and an optional note.
3. Closing SHALL require a returned plan, or an explicit closure reason (patient declined, referred
   elsewhere, cancelled).

## R9 — Patient status view (SHOULD)
1. THE SYSTEM SHALL show the patient a plain-language status: where the referral is, appointment
   date and city, distance, and open barriers they can update. No clinical content.

## R10 — FHIR export (MUST)
1. THE SYSTEM SHALL export each referral as a FHIR R4 Bundle per design.md §7, modeled on HL7 BSeR's
   ServiceRequest + Task pattern, and validated with `fhir.resources.R4B` in tests.
2. Every resource SHALL carry a `meta.tag` for synthetic data, and real-directory organizations a tag
   for public-directory source.

## R11 — Data provenance and Kiro evidence (MUST)
1. `data/public/SOURCES.md` SHALL list every public snapshot with agency, URL, retrieval date, filters,
   and license/terms note. The UI SHALL link sources from each context item.
2. `docs/KIRO.md` SHALL record at least two cases where a hook or steering rule caught a problem.
3. README SHALL include setup, `make dev`, and the 3-minute demo script.

## R12 — Home-monitoring follow-up (STRETCH — only if R1–R11 pass by hour 5)
1. WHEN a returned plan includes home BP monitoring THE SYSTEM MAY show synthetic home readings as a
   measures table (baseline / most recent) delivered to the PCP in the same format, labeled synthetic.
