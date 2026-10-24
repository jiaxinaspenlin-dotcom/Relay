---
inclusion: always
---

# Tech stack (decided — do not re-deliberate)

- **Backend:** Python 3.11, FastAPI, Pydantic v2, pandas. FHIR via `fhir.resources.R4B`. pytest.
- **Frontend:** React 18 + Vite + TypeScript, Tailwind, TanStack Query, React Router.
  Map: `react-leaflet` with OSM tiles (SHOULD). Charts only if needed: Recharts.
- **Public data:** `scripts/fetch_*.py` pull each source once into `data/public/*.csv|json`, and
  `data/public/SOURCES.md` records URL, agency, retrieval date, and filters. **The app reads only the
  committed snapshots**, so the demo never depends on a live API.
- **Synthetic data:** Synthea (Java 11+) run once per western-MA town, then `seed_referrals.py`
  (seed 42) builds referrals, appointments, messages, and plan-backs. Committed to `data/synthetic/`.
- **State:** in memory, loaded from JSON at startup. "Reset demo" reloads the seed.
- **Clock:** a fixed demo date `DEMO_TODAY=2026-10-24` in config, so "days stuck" is reproducible.
- **LLM:** optional, provider by env var (Anthropic or Bedrock), temperature 0, verify-or-fallback.
- **Run:** `make setup`, `make data` (only to refresh snapshots), `make dev`, `make test`.

## Rules
- Loop state, stuck rules, distance, and finder ranking are pure functions with unit tests in
  `backend/app/loop/` and `backend/app/finder/`.
- All UI strings live in `frontend/src/copy.ts`. All message templates live in
  `backend/app/drafting/templates.py`. The copy guard scans both.
