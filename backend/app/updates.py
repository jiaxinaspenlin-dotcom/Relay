"""One code path for status updates, whoever reports them: the office link (actor=office,
source=link), the coordinator's Log update (phone/fax/other, or a confirmed AI call suggestion).
Every stage change goes through loop/states.py."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.loop.states import InvalidTransition, record_field_update, transition
from app.models import AUTH_LABELS, MISSING_LABELS, Authorization, MissingItem, Plan, Receipt, Referral
from app.views import UPDATE_ACTIONS

OMITTED_NOTE = "ACCESS-specific fields (track, OAP measures) omitted: not an ACCESS referral."

Action = Literal["received", "missing", "authorization", "patient_contacted", "scheduled", "seen",
                 "no_show", "declined", "plan_returned"]


class UpdateError(ValueError):
    """Bad or missing input for an update (HTTP 422). Disallowed transitions raise InvalidTransition."""


class PlanForm(BaseModel):
    visit_date: Optional[date] = None
    assessment: str = Field(min_length=1, max_length=8000)
    plan: str = Field(min_length=1, max_length=8000)
    actions_for_pcp: str = Field(default="", max_length=4000)
    questions_contact: str = Field(default="", max_length=1000)


class UpdateBody(BaseModel):
    action: Action
    note: str = Field(default="", max_length=2000)  # decline reason, missing-items note, or a note
    missing: list[MissingItem] = []
    authorization: Optional[Authorization] = None
    contact_mode: Optional[Literal["office_called", "patient_told_to_call"]] = None
    appointment_date: Optional[date] = None
    appointment_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    plan: Optional[PlanForm] = None


def make_plan(ref: Referral, form: PlanForm, today: date) -> Plan:
    visit = form.visit_date or (ref.appointment.start if ref.appointment else today)
    return Plan.model_validate({
        "returned_on": today, "from": ref.performer.name, "visit_date": visit,
        "reason": ref.reason_condition.display, "assessment": form.assessment.strip(),
        "plan": form.plan.strip(), "actions_for_pcp": form.actions_for_pcp.strip(),
        "questions_contact": form.questions_contact.strip(), "omitted_fields_note": OMITTED_NOTE,
    })


def apply_update(ref: Referral, body: UpdateBody, *, actor: str, source: str, today: date,
                 by: str = "", user_id: str = "") -> Referral:
    """Return the updated referral. Raises UpdateError (bad input) or InvalidTransition."""
    note = body.note.strip()
    a = body.action
    if a == "authorization":
        if body.authorization is None or body.authorization == "not_set":
            raise UpdateError("Choose an authorization status")
        new = record_field_update(ref, "authorization", at=today, actor=actor, source=source, by=by, user_id=user_id,
                                  note=f"Authorization: {AUTH_LABELS[body.authorization].lower()}"
                                       + (f". {note}" if note else ""))
        if body.authorization == "pending" and ref.authorization != "pending":
            new.authorization_since = today
        new.authorization = body.authorization
        return new
    stage = UPDATE_ACTIONS[a]
    kw: dict = {}
    if a == "received":
        kw["receipt"] = Receipt(complete=True)
    elif a == "missing":
        if not body.missing:
            raise UpdateError("Check at least one missing item")
        kw["receipt"] = Receipt(complete=False, missing=list(dict.fromkeys(body.missing)), note=note)
        note = "Missing " + ", ".join(MISSING_LABELS[m] for m in kw["receipt"].missing) + (f". {note}" if note else "")
    elif a == "patient_contacted":
        if body.contact_mode is None:
            raise UpdateError("Say whether the office called the patient or told the patient to call")
        kw["contact_mode"] = body.contact_mode
    elif a == "scheduled":
        if body.appointment_date is None:
            raise UpdateError("Add the appointment date")
        kw["appointment_start"] = body.appointment_date
        kw["appointment_time"] = body.appointment_time
    elif a == "declined" and not note:
        raise UpdateError("Add a reason for declining")
    elif a == "plan_returned":
        if body.plan is None:
            raise UpdateError("Returning a plan needs the plan form")
        kw["plan"] = make_plan(ref, body.plan, today)
    return transition(ref, stage, at=today, actor=actor, note=note, source=source, by=by, user_id=user_id, **kw)


__all__ = ["UpdateBody", "PlanForm", "UpdateError", "InvalidTransition", "apply_update", "make_plan"]
