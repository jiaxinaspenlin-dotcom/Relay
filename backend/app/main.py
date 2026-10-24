"""FastAPI entry point. Local demo only: no authentication (synthetic data, single user)."""
from __future__ import annotations

from fastapi import FastAPI

from app.api import dashboard, finder, inbox, referrals
from app.store import store

app = FastAPI(title="Relay (synthetic demo)")
for module in (dashboard, finder, inbox, referrals):
    app.include_router(module.router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "synthetic": True, **store.clock()}
