---
inclusion: always
---

# Product: Relay — closing the referral loop for rural Massachusetts

**Challenge:** Improving Healthcare Access and Coordination.

The challenge names two failures. Relay is built to catch and close both:
1. **"A referral may be sent without an appointment being scheduled."**
2. **"A specialist visit may occur without the treatment plan reaching the primary-care team."**

> Relay tracks every referral from sent to plan-back, shows where it's stuck and why, and drafts
> the follow-up. People make every clinical and scheduling decision.

## Users
1. **Referral coordinator** at a rural primary-care practice. Owns the loop. Main user.
2. **PCP**: writes the referral reason and priority, receives the specialist's plan, closes the loop.
3. **Specialist office** (simulated in the demo): accepts, schedules, and returns the plan.
4. **Patient** (SHOULD): sees where their referral stands in plain language.

## The journey Relay covers
Referral created → specialist chosen (distance, hospital, Medicare assignment) → sent → accepted →
scheduled → seen → plan returned → PCP acknowledges → closed. Barriers (transportation, coverage,
language, schedule) are logged along the way.

## Data honesty
- **Real public data:** CMS clinician directory (MA), CMS hospital star ratings and readmissions (MA),
  Mass. hospitals layer, CDC PLACES (**county-level**, 2023), Mass. environmental-justice block groups,
  HRSA shortage areas, town centroids.
- **Synthetic:** patients (Synthea, western-MA towns), referrals, appointments, messages, and specialist
  replies. Label every screen.
- **Real organizations, simulated behavior:** the specialist finder shows real practices from the CMS
  directory, at **organization level, not individual clinicians' names**. Seeded "stuck" referrals use
  **fictional practices** so no real office is shown as slow or unresponsive. Any simulated action by a
  real organization is labeled "Simulated response".
- **Community context describes places, never people.** SVI, environmental-justice status, PLACES, and
  HRSA designations are shown as context for the patient's town or county, with what they can't see.
  They are never a score for a patient.

## Hard boundaries
- No clinical decisions: Relay never sets or changes referral priority, never picks the specialist,
  never decides telehealth appropriateness, never writes Assessment or Plan.
- Distance is **straight-line between town centers**. Never call it drive time.
- Coverage: Relay only knows whether a clinician accepts Medicare assignment. It never says
  "in network" or "accepts your insurance".
- Delivery is simulated in the demo. Production would use Direct Secure Messaging, an HIE, or FHIR
  exchange. Say so on screen.
- Don't claim BSeR or 360X conformance. Say "modeled on HL7 BSeR's ServiceRequest + Task pattern".
