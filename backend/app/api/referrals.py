"""Referrals: create, detail, Log update, draft follow-up, send, close, FHIR export."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.export.fhir import build_bundle

from app.chart import active_conditions
from app.config import FINDER_SPECIALTIES
from app.drafting.draft import NotStuck, make_draft
from app.finder.practices import practices_for
from app.loop.states import STAGES, InvalidTransition, transition
from app.models import (Communication, Condition, Party, Performer, Plan, Referral,
                        UpdateSource)
from app.store import store
from app.views import LOG_ACTIONS, referral_detail_view

router = APIRouter(prefix="/api")

UPDATE_ACTIONS = LOG_ACTIONS  # Log update action -> loop stage (R2.5)
OMITTED_NOTE = "ACCESS-specific fields (track, OAP measures) omitted: not an ACCESS referral."


def _get(rid: str) -> Referral:
    try:
        return store.get(rid)
    except KeyError:
        raise HTTPException(404, f"No referral {rid}") from None


def _detail(ref: Referral) -> dict:
    return referral_detail_view(ref, store.all(), store.patients, store.today)


def _rerouted() -> set[str]:
    return {r.replaces for r in store.all() if r.replaces}


@router.get("/referrals/{rid}")
def get_referral(rid: str) -> dict:
    return _detail(_get(rid))


# ---------------------------------------------------------------- create + send

class NewReferral(BaseModel):
    patient_id: str
    specialty: str
    practice_id: str
    reason_text: str = Field(min_length=1)
    priority: Literal["routine", "urgent"]
    condition_code: str
    replaces: Optional[str] = None


@router.post("/referrals", status_code=201)
def create_referral(body: NewReferral) -> dict:
    p = store.patients.get(body.patient_id)
    if p is None:
        raise HTTPException(404, "Unknown patient")
    if body.specialty not in FINDER_SPECIALTIES:
        raise HTTPException(422, f"Unsupported specialty {body.specialty}")
    pri_spec = FINDER_SPECIALTIES[body.specialty]
    practice = next((x for x in practices_for(pri_spec) if x.id == body.practice_id), None)
    if practice is None:
        raise HTTPException(422, "Unknown practice for this specialty")
    cond = next((c for c in active_conditions(body.patient_id) if c["code"] == body.condition_code), None)
    if cond is None:
        raise HTTPException(422, "Condition is not an active condition in the chart")
    pcp = store.seed_meta["pcp"]
    draft = Referral(
        id=store.next_id(), patient_id=p["id"], patient_town=p["town"],
        specialty=body.specialty, pri_spec=pri_spec, priority=body.priority,
        reason_text=body.reason_text.strip(),
        reason_condition=Condition(code=cond["code"], system=cond["system"],
                                   display=cond["display"], onset=cond["onset"]),
        requester=Party(**pcp),
        performer=Performer(id=practice.id, name=practice.label, town=practice.town or practice.city_raw,
                            fictional=False, address=practice.address, zip5=practice.zip5,
                            org_pac_id=practice.org_pac_id),
        stage="draft", task_status=STAGES["draft"][0], business_status=STAGES["draft"][1],
        authored_on=store.today, events=[], replaces=body.replaces,
    )
    sent = transition(draft, "sent", at=store.today, actor="pcp", by=pcp["clinician"])
    return _detail(store.put(sent))


# ---------------------------------------------------------------- Log update (R2.5)

class PlanForm(BaseModel):
    visit_date: Optional[date] = None
    assessment: str = Field(min_length=1)
    plan: str = Field(min_length=1)
    actions_for_pcp: str = ""
    questions_contact: str = ""


class LogUpdate(BaseModel):
    action: Literal["accepted", "declined", "scheduled", "seen", "no_show", "plan_received"]
    source: UpdateSource
    note: str = ""
    appointment_date: Optional[date] = None
    plan: Optional[PlanForm] = None


@router.post("/referrals/{rid}/updates")
def log_update(rid: str, body: LogUpdate) -> dict:
    ref = _get(rid)
    plan = None
    if body.action == "plan_received":
        if body.plan is None:
            raise HTTPException(422, "Plan received needs the plan form")
        visit = body.plan.visit_date or (ref.appointment.start if ref.appointment else store.today)
        plan = Plan.model_validate({
            "simulated": False, "returned_on": store.today, "from": ref.performer.name,
            "visit_date": visit, "reason": ref.reason_condition.display,
            "assessment": body.plan.assessment.strip(), "plan": body.plan.plan.strip(),
            "actions_for_pcp": body.plan.actions_for_pcp.strip(),
            "questions_contact": body.plan.questions_contact.strip(),
            "omitted_fields_note": OMITTED_NOTE,
        })
    try:
        new = transition(ref, UPDATE_ACTIONS[body.action], at=store.today, actor="coordinator",
                         note=body.note.strip(), source=body.source,
                         appointment_start=body.appointment_date, plan=plan)
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    return _detail(store.put(new))


# ---------------------------------------------------------------- follow-up drafts (R4.3, R4.4)

@router.get("/referrals/{rid}/draft")
def draft(rid: str, rule: Optional[str] = None) -> dict:
    ref = _get(rid)
    try:
        return make_draft(ref, store.patients[ref.patient_id], store.today, rule=rule,
                          rerouted_ids=_rerouted())
    except NotStuck as e:
        raise HTTPException(409, str(e)) from e


class SendMessage(BaseModel):
    recipient: Literal["specialist", "patient", "pcp"]
    text: str = Field(min_length=1)
    rule: str = ""
    drafted_text: str = ""  # what Relay drafted, to record whether the sender edited it


@router.post("/referrals/{rid}/communications", status_code=201)
def send_message(rid: str, body: SendMessage) -> dict:
    ref = _get(rid)
    new = ref.model_copy(deep=True)
    new.communications.append(Communication(
        id=f"{ref.id}-C{len(ref.communications) + 1}", sent=store.today, recipient=body.recipient,
        text=body.text.strip(), sent_by=ref.requester.coordinator, ai_drafted=False, rule=body.rule,
        edited=bool(body.drafted_text) and body.text.strip() != body.drafted_text.strip(),
    ))
    return _detail(store.put(new))


# ---------------------------------------------------------------- FHIR export (R10)

@router.get("/referrals/{rid}/fhir")
def fhir_bundle(rid: str) -> JSONResponse:
    ref = _get(rid)
    return JSONResponse(build_bundle(ref, store.today), media_type="application/fhir+json",
                        headers={"Content-Disposition": f'attachment; filename="relay-{rid}-fhir.json"'})


# ---------------------------------------------------------------- PCP close (R8)

class CloseBody(BaseModel):
    note: str = ""


@router.post("/referrals/{rid}/close")
def close(rid: str, body: CloseBody) -> dict:
    ref = _get(rid)
    try:
        new = transition(ref, "closed", at=store.today, actor="pcp", by=ref.requester.clinician,
                         note=body.note.strip())
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    return _detail(store.put(new))
