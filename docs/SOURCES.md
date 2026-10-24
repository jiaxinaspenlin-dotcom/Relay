# Sources for the Massachusetts workflow

Data snapshots (CMS, CDC PLACES, MassGIS, HRSA, EJ) are listed in `data/public/SOURCES.md`.
These are the policy and delivery sources behind Relay's Massachusetts-specific wording.
Retrieved 2026-10-24.

| Topic | Source | Used for |
|---|---|---|
| MassHealth referrals | mass.gov, MassHealth fact sheet "Specialists, including medical specialists, home health, and durable medical equipment": https://www.mass.gov/doc/specialists-including-medical-specialists-home-health-and-durable-medical-equipment-0/download. Also the Provider Handbook, Authorizations and Referrals: https://www.mass.gov/info-details/provider-handbook-authorizations-and-referrals | The referral hint for PCC Plan and Primary Care ACO members, citing 130 CMR 450.118(J). Shown as a hint; the coordinator decides. |
| MassHealth rides (PT-1) | mass.gov, "Request transportation for a member": https://www.mass.gov/how-to/request-transportation-for-a-member. Also "Get a ride to MassHealth medical appointments", which says approval may take up to 3 business days: https://www.mass.gov/info-details/get-a-ride-to-masshealth-medical-appointments | The PT-1 checkbox and link on referral detail, and the "at least 3 business days before the visit" rule. |
| Delivery | Mass HIway, "Improving Care Coordination via Direct Messaging" (October 2018): https://ehs-hie-drt.ehs.mass.gov/sites/default/files/2020-10/Improving_Care_Coordination_via_Direct_Messaging_October_2018.pdf | Copy that names Mass HIway Direct messaging as production delivery, and the office link as the path for offices not yet on Mass HIway. |
| Original Medicare | Medicare.gov, "Compare Original Medicare & Medicare Advantage" (Medicare Advantage plans may need a referral; Original Medicare lets you see any doctor that takes Medicare): https://www.medicare.gov/basics/get-started-with-medicare/get-more-coverage/your-coverage-options/compare-original-medicare-medicare-advantage | The Original Medicare hint ("generally doesn't require a referral"). |

Relay states these as hints. It never says a referral is or isn't needed for a specific patient.
