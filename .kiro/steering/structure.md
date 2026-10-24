---
inclusion: always
---

# Repository structure

```
relay/
├── .kiro/
├── data/
│   ├── public/            # committed snapshots + SOURCES.md (real public data)
│   └── synthetic/         # Synthea bundles (selected) + referrals.json (seeded)
├── scripts/
│   ├── fetch_clinicians.py  fetch_hospitals.py  fetch_places.py  fetch_ej.py
│   ├── fetch_towns.py       load_hrsa.py (from a manually downloaded HRSA file)
│   ├── run_synthea.sh       select_patients.py  seed_referrals.py
│   └── check_copy.py
├── backend/app/
│   ├── main.py  config.py  models.py
│   ├── loop/        # states.py (transitions), stuck.py (rules), timeline.py
│   ├── finder/      # practices.py (group clinicians → practice locations), distance.py, rank.py
│   ├── context/     # place.py (county PLACES, HRSA, EJ, nearby hospitals)
│   ├── drafting/    # facts.py, templates.py, llm.py, verify.py
│   ├── export/      # fhir.py, render.py
│   └── api/         # referrals.py, finder.py, inbox.py, specialist.py, dashboard.py
├── backend/tests/
├── frontend/src/
│   ├── pages/       # Dashboard, ReferralDetail, NewReferral, SpecialistOffice, PcpInbox, PatientStatus
│   ├── components/  # LoopStepper, StuckBadge, PracticeCard, PlaceContext, FactChip, SyntheticBanner, MiniMap
│   └── copy.ts
└── docs/            # KIRO.md, PITCH.md
```
