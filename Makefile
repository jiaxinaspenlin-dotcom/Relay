PY_BOOT ?= python3.12
VENV := .venv
PY := $(VENV)/bin/python
export DEMO_TODAY ?= 2026-10-24

.PHONY: setup data mocks dev dev-api dev-web test check-copy build-web e2e

setup:
	test -x $(PY) || $(PY_BOOT) -m venv $(VENV)
	$(PY) -m pip install -q -r backend/requirements.txt
	cd frontend && npm ci

# Refresh public snapshots (live network). The app itself reads only committed snapshots.
data:
	python3 scripts/fetch_public.py

# Regenerate frontend/src/mock/*.json from data/synthetic/referrals.json.
mocks:
	$(PY) scripts/build_mocks.py

# MVP acceptance tests M1–M5 through the UI (needs `make dev` running; uses installed Chrome).
e2e:
	cd frontend && node e2e/acceptance.mjs

# API on a throwaway database for `make e2e` (the e2e script refuses any other database).
dev-api-e2e:
	cd backend && RELAY_E2E=1 RELAY_DB=../data/relay-e2e.db ../$(PY) -m uvicorn app.main:app --port 8000

dev:
	$(MAKE) -j2 dev-api dev-web

dev-api:
	cd backend && ../$(PY) -m uvicorn app.main:app --reload --port 8000

dev-web:
	cd frontend && npm run dev

check-copy:
	$(PY) scripts/check_copy.py

test: check-copy
	$(PY) -m pytest -q

build-web:
	cd frontend && npm run build
