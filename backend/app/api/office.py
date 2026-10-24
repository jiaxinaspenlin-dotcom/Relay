"""Office update link: /office/{token}. No login. The token (192 random bits) is the only
credential, and it grants access to one referral. Every action goes through loop/states.py and is
recorded with actor = office, source = link."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import clock
from app.api.referrals import PlanForm, apply_update
from app.store import get_repo
from app.views import office_view

router = APIRouter(prefix="/api/office")


def _ref_for(token: str):
    repo = get_repo()
    rid = repo.referral_for_token(token)
    if rid is None:
        raise HTTPException(404, "This link is not valid")
    return repo, repo.get(rid)


@router.get("/{token}")
def office_get(token: str) -> dict:
    repo, ref = _ref_for(token)
    return office_view(ref, repo.patient(ref.patient_id), clock.today(repo))


class OfficeAction(BaseModel):
    action: Literal["accepted", "declined", "scheduled", "seen", "no_show", "plan_returned"]
    reason: str = Field(default="", max_length=2000)  # decline reason, or an optional note
    appointment_date: Optional[date] = None
    appointment_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    plan: Optional[PlanForm] = None


@router.post("/{token}")
def office_act(token: str, body: OfficeAction) -> dict:
    repo, ref = _ref_for(token)
    if body.action == "scheduled" and (body.appointment_date is None or body.appointment_time is None):
        raise HTTPException(422, "Add the appointment date and time")
    new = apply_update(ref, body.action, actor="office", source="link", note=body.reason,
                       today=clock.today(repo), appointment_date=body.appointment_date,
                       appointment_time=body.appointment_time, plan_form=body.plan)
    repo.put(new)
    return office_view(new, repo.patient(new.patient_id), clock.today(repo))
