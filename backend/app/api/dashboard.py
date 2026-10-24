"""Dashboard, settings (practice details, Demo mode clock), sample data, and data reset."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import clock
from app.config import voice_enabled
from app.db import SampleAlreadyLoaded
from app.store import get_repo
from app.views import dashboard_view

router = APIRouter(prefix="/api")


@router.get("/dashboard")
def dashboard() -> dict:
    repo = get_repo()
    return dashboard_view(repo.all(), repo.patients(), clock.today(repo))


# ---------------------------------------------------------------- settings

class PracticeDetails(BaseModel):
    practice: str = Field(min_length=1, max_length=200)
    clinician: str = Field(min_length=1, max_length=200)
    coordinator: str = Field(min_length=1, max_length=200)


class SettingsBody(BaseModel):
    demo_mode: Optional[bool] = None
    practice: Optional[PracticeDetails] = None


def _settings() -> dict:
    repo = get_repo()
    return {"clock": clock.info(repo), "practice": repo.setting("practice"),
            "has_sample": repo.has_sample(), "referrals": repo.count()}


@router.get("/settings")
def get_settings() -> dict:
    return _settings()


@router.post("/settings")
def update_settings(body: SettingsBody) -> dict:
    repo = get_repo()
    if body.demo_mode is not None:
        clock.set_demo_mode(repo, body.demo_mode)
    if body.practice is not None:
        repo.set_setting("practice", body.practice.model_dump())
    return _settings()


class ClockAction(BaseModel):
    advance_days: Optional[int] = None
    reset: bool = False


@router.get("/clock")
def get_clock() -> dict:
    return clock.info(get_repo())


@router.post("/clock")
def set_clock(body: ClockAction) -> dict:
    repo = get_repo()
    try:
        if body.reset:
            return clock.reset(repo)
        return clock.advance(repo, body.advance_days or 0)
    except ValueError as e:
        raise HTTPException(409 if "Demo mode" in str(e) else 422, str(e)) from e


# ---------------------------------------------------------------- data

@router.post("/sample-data")
def load_sample() -> dict:
    repo = get_repo()
    try:
        n = repo.load_sample(clock.today(repo))
    except SampleAlreadyLoaded as e:
        raise HTTPException(409, str(e)) from e
    return {"loaded": n, **_settings()}


@router.post("/sample-data/reset")
def reset_sample() -> dict:
    """Demo mode: put the sample referrals back as they were (dated relative to today)."""
    repo = get_repo()
    if not repo.setting("demo_mode"):
        raise HTTPException(409, "Turn on Demo mode in Settings to reset sample data")
    clock.reset(repo)
    n = repo.reset_sample(clock.today(repo))
    return {"loaded": n, **_settings()}


@router.get("/config")
def config() -> dict:
    """Feature switches for the UI. Never returns secrets."""
    return {"voice_enabled": voice_enabled()}


class ClearBody(BaseModel):
    confirm: str


@router.post("/clear-data")
def clear_data(body: ClearBody) -> dict:
    """Delete every patient and referral. Requires confirm = "DELETE"."""
    if body.confirm != "DELETE":
        raise HTTPException(422, 'Type DELETE to confirm')
    repo = get_repo()
    repo.clear_all()
    clock.reset(repo)
    return _settings()
