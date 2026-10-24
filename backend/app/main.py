"""FastAPI entry point. Routers for dashboard, referrals, finder, specialist, inbox, and export
are added in Block 3 (tasks.md 3.4)."""
from __future__ import annotations

from fastapi import FastAPI

from app.config import DEMO_TODAY

app = FastAPI(title="Relay (synthetic demo)")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "demo_today": DEMO_TODAY.isoformat(), "synthetic": True}
