"""Office update link: /office/{token}, for offices not yet on Mass HIway. No login. The token
(192 random bits) is the only credential and grants access to one referral. Every action goes
through loop/states.py and is recorded with actor = office, source = link."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import clock
from app.store import get_repo
from app.updates import InvalidTransition, UpdateBody, UpdateError, apply_update
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


@router.post("/{token}")
def office_act(token: str, body: UpdateBody) -> dict:
    repo, ref = _ref_for(token)
    if body.action == "scheduled" and (body.appointment_date is None or body.appointment_time is None):
        raise HTTPException(422, "Add the appointment date and time")
    try:
        new = apply_update(ref, body, actor="office", source="link", today=clock.today(repo))
    except UpdateError as e:
        raise HTTPException(422, str(e)) from e
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    repo.put(new)
    return office_view(new, repo.patient(new.patient_id), clock.today(repo))
