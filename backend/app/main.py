"""FastAPI entry point.

Security note: there are no user accounts. Run on localhost or behind your own access control.
Office links (/office/{token}) are capability URLs: anyone holding the link can update that one
referral and see its summary (patient name, date of birth, town, reason).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from app import clock
from app.api import call, dashboard, finder, inbox, office, referrals
from app.store import get_repo

app = FastAPI(title="Relay")
for module in (dashboard, finder, inbox, referrals, office, call):
    app.include_router(module.router)


@app.get("/api/health")
def health() -> dict:
    repo = get_repo()
    # db file name (not path) lets the e2e script refuse to wipe anything but its own database.
    return {"ok": True, "db": Path(repo.path).name, **clock.info(repo)}
