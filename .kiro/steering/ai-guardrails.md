---
inclusion: always
---

# AI guardrails and wording

## Where AI is used
1. **Referral summary** for the specialist: reason for referral and relevant history, drafted from
   the synthetic chart. Medications, allergies, and recent results are shown as **deterministic
   tables from the chart**, not AI text.
2. **Nudge drafts:** follow-ups to the specialist office, the patient, or the PCP when a loop is stuck.

Both have a deterministic template version. The demo must work with no LLM key.

## Rules for every AI output
- Built only from `Fact` objects (chart facts, referral dates, stage, barriers). No name, DOB, or
  address is sent to the LLM. Use a pseudonymous key and re-insert names after verification.
- Every sentence ends with `[F#]` citations to existing facts.
- Every number and date in the output must appear in the cited facts.
- It must pass `scripts/check_copy.py`.
- On failure: discard it, use the template, and tell the coordinator why.
- AI text is labeled "Drafted by AI — verified against the record — edit before sending". A human
  sends every message. Relay never auto-sends.

## Wording
| Avoid | Use |
|---|---|
| "35 minutes away" / "drive time" | "38 miles straight-line between town centers" |
| "In network" / "takes your insurance" | "Accepts Medicare assignment (CMS directory)" (all clinicians `ind_assgn = Y`) |
| "Doesn't accept Medicare" / "Medicare assignment: No" | "May accept Medicare assignment — confirm with the office" (any `M`; CMS has no "No" value) |
| "Affiliated hospital" | "Nearest hospital" (the CMS clinician file has no affiliation columns) |
| "Total beds" | "med/surg + ICU + pediatric beds" |
| "High-risk patient" / "vulnerable patient" | "Patient's county: 81% routine-checkup rate (CDC PLACES 2023, county estimate)" |
| "Specialist is ignoring the referral" | "No response 6 days after sending" |
| "Urgent" (unless the PCP set priority) | Show the PCP-set priority verbatim |
| "Should be seen by telehealth" | "Ask the office whether a telehealth visit is offered" |
