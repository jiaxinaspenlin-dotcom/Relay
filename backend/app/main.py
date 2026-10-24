"""FastAPI entry point.

Accounts: coordinators and clinicians sign in (argon2 hashes, HttpOnly session cookie). Office
links (/office/{token}) are capability URLs with no account: anyone holding a link can update
that one referral and see its summary. This is not a HIPAA-compliant deployment; production needs
SSO, audit logging, and hosting approved for patient data.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException

from app import clock
from app.api import auth, call, dashboard, finder, inbox, office, referrals
from app.store import get_repo

app = FastAPI(title="Relay")
app.middleware("http")(auth.auth_middleware)
for module in (auth, dashboard, finder, inbox, referrals, office, call):
    app.include_router(module.router)


@app.get("/api/health")
def health() -> dict:
    repo = get_repo()
    # db file name (not path) lets the e2e script refuse to touch anything but its own database.
    return {"ok": True, "db": Path(repo.path).name, **clock.info()}


@app.post("/api/test/reset")
def test_reset() -> dict:
    """End-to-end tests only: exists when RELAY_E2E=1 and the database is relay-e2e.db."""
    repo = get_repo()
    if os.environ.get("RELAY_E2E") != "1" or Path(repo.path).name != "relay-e2e.db":
        raise HTTPException(404, "Not found")
    repo.reset_everything()
    return {"ok": True}
