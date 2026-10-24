# Relay: closing the referral loop (Kiro build kit)

**Challenge:** Improving Healthcare Access and Coordination.
Relay tracks each specialty referral from a rural Massachusetts practice through sent, accepted,
scheduled, seen, plan returned, and closed. It catches the two failures the challenge names,
shows distance and community context from real public data, and drafts follow-ups for a person to
send. Clinical and scheduling decisions stay with people.

```
.kiro/
├── specs/relay-referral-loop/  requirements.md · design.md · tasks.md (7-hour plan, cut order)
├── steering/                   product.md · ai-guardrails.md · tech.md · structure.md
└── hooks/relay-hooks.json      copy guard · loop/finder tests · drafting verification · FHIR · sources · spec sync
scripts/check_copy.py           copy guard (works now)
```

## Start
1. Open in Kiro: "Review .kiro/specs/relay-referral-loop against the steering files, list conflicts,
   then start Block 1."
2. Start the data fetches and Synthea in the first 20 minutes. They're the slowest, least predictable part.
3. Log each hook catch in `docs/KIRO.md` as it happens.

## Verify early (first hour)
- The CMS clinician dataset ID and exact specialty strings (task 1.2).
- That Synthea accepts each western-MA town name (task 1.4).
- The HRSA HPSA download columns (task 1.3). Cut it if it takes more than 10 minutes.
- Hooks use Kiro's `version: "v1"` JSON format. If your build doesn't load them, recreate them in
  the Agent Hooks panel.

## Sources
- CMS Provider Data Catalog: https://data.cms.gov/provider-data/
- Doctors and Clinicians data dictionary: https://data.cms.gov/provider-data/sites/default/files/data_dictionaries/DOC_Data_Dictionary.pdf
- CDC PLACES: https://data.cdc.gov/resource/swc5-untb.json
- HRSA Data Warehouse: https://data.hrsa.gov/
- HL7 BSeR workflow resources: https://hl7.org/fhir/us/bser/WorkflowManagementResources.html
- CMS ACCESS Care Update template: https://www.cms.gov/priorities/innovation/files/access-care-update-template.pdf
- Massachusetts rural health: https://www.mass.gov/rural-health
- MassGIS data layers: https://www.mass.gov/info-details/massgis-data-layers
- Synthea (Apache-2.0): https://github.com/synthetichealth/synthea
