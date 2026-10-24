"""Dashboard, settings (practice details), sample data, and data reset. Always the real clock."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import clock
from app.config import phone_calling_enabled, voice_enabled
from app.db import SampleAlreadyLoaded
from app.store import get_repo
from app.views import dashboard_view

router = APIRouter(prefix="/api")


@router.get("/dashboard")
def dashboard() -> dict:
    repo = get_repo()
    view = dashboard_view(repo.all(), repo.patients(), clock.today())
    # Each row shows its newest AI phone call ("Calling…", "Call finished, review update").
    latest = repo.latest_calls()
    def brief(rid: str):
        c = latest.get(rid)
        return {"id": c["id"], "status": c["status"], "phase": c.get("phase"), "phase_at": c.get("phase_at"),
                "reason": c["reason"], "practice": c["practice"], "started_at": c["started_at"]} if c else None
    for row in view["needs_attention"]:
        row["card"]["call"] = brief(row["card"]["id"])
    for col in view["pipeline"]:
        for card in col["cards"]:
            card["call"] = brief(card["id"])
    return view


# ---------------------------------------------------------------- settings

class PracticeDetails(BaseModel):
    practice: str = Field(min_length=1, max_length=200)
    clinician: str = Field(min_length=1, max_length=200)
    coordinator: str = Field(min_length=1, max_length=200)


class SettingsBody(BaseModel):
    practice: Optional[PracticeDetails] = None


def _settings() -> dict:
    repo = get_repo()
    return {"today": clock.today().isoformat(), "practice": repo.setting("practice"),
            "has_sample": repo.has_sample(), "referrals": repo.count()}


@router.get("/settings")
def get_settings() -> dict:
    return _settings()


@router.post("/settings")
def update_settings(body: SettingsBody) -> dict:
    if body.practice is not None:
        get_repo().set_setting("practice", body.practice.model_dump())
    return _settings()


# ---------------------------------------------------------------- data

@router.post("/sample-data")
def load_sample() -> dict:
    """Load the sample referrals, dated relative to today."""
    repo = get_repo()
    try:
        n = repo.load_sample(clock.today())
    except SampleAlreadyLoaded as e:
        raise HTTPException(409, str(e)) from e
    return {"loaded": n, **_settings()}


@router.delete("/sample-data")
def remove_sample() -> dict:
    """Remove sample referrals and sample patients. Records you entered stay."""
    n = get_repo().remove_sample()
    return {"removed": n, **_settings()}


@router.get("/config")
def config() -> dict:
    """Feature switches for the UI. Never returns secrets."""
    return {"voice_enabled": voice_enabled(), "phone_calling_enabled": phone_calling_enabled()}


class ClearBody(BaseModel):
    confirm: str


@router.post("/clear-data")
def clear_data(body: ClearBody) -> dict:
    """Delete every patient and referral. Requires confirm = "DELETE"."""
    if body.confirm != "DELETE":
        raise HTTPException(422, 'Type DELETE to confirm')
    get_repo().clear_all()
    return _settings()
