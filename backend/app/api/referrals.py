"""Referrals: create (draft), send (copy / email / print), detail, coordinator Log update,
follow-up drafts and sending, PCP close, FHIR export."""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import clock
from app.chart import active_conditions
from app.config import FINDER_SPECIALTIES
from app.drafting.draft import NotStuck, make_draft
from app.drafting.templates import referral_message
from app.export.fhir import build_bundle
from app.finder.practices import practices_for
from app.loop.states import STAGES, InvalidTransition, transition
from app.models import (Channel, Communication, Condition, Party, Performer, Plan, Referral,
                        UpdateSource)
from app.store import get_repo
from app.views import LOG_ACTIONS, patient_brief, referral_detail_view

router = APIRouter(prefix="/api")

OMITTED_NOTE = "ACCESS-specific fields (track, OAP measures) omitted: not an ACCESS referral."


def office_url(request: Request, token: str) -> str:
    return f"{str(request.base_url).rstrip('/')}/office/{token}"


def _get(rid: str) -> Referral:
    try:
        return get_repo().get(rid)
    except KeyError:
        raise HTTPException(404, f"No referral {rid}") from None


def _patient(ref: Referral) -> dict:
    repo = get_repo()
    p = repo.patient(ref.patient_id)
    if p is None:
        raise HTTPException(500, f"Referral {ref.id} has no patient record")
    return {**p, **patient_brief(p, clock.today(repo))}


def _detail(ref: Referral) -> dict:
    repo = get_repo()
    return referral_detail_view(ref, repo.all(), repo.patients(), clock.today(repo),
                                office_path=f"/office/{repo.token_for(ref.id)}")


def _rerouted() -> set[str]:
    return {r.replaces for r in get_repo().all() if r.replaces}


@router.get("/referrals/{rid}")
def get_referral(rid: str) -> dict:
    return _detail(_get(rid))


# ---------------------------------------------------------------- create (draft)

class NewReferral(BaseModel):
    patient_id: str
    specialty: str
    practice_id: str
    reason_text: str = Field(min_length=1, max_length=4000)
    priority: Literal["routine", "urgent"]
    condition_code: str = ""  # chart condition (sample patients with a Synthea chart)
    condition_text: str = Field(default="", max_length=300)  # typed condition (everyone else)
    replaces: Optional[str] = None


@router.post("/referrals", status_code=201)
def create_referral(body: NewReferral) -> dict:
    repo = get_repo()
    p = repo.patient(body.patient_id)
    if p is None:
        raise HTTPException(404, "Unknown patient")
    if body.specialty not in FINDER_SPECIALTIES:
        raise HTTPException(422, f"Unsupported specialty {body.specialty}")
    pri_spec = FINDER_SPECIALTIES[body.specialty]
    practice = next((x for x in practices_for(pri_spec) if x.id == body.practice_id), None)
    if practice is None:
        raise HTTPException(422, "Unknown practice for this specialty")
    if body.condition_code:
        if not p.get("chart_id"):
            raise HTTPException(422, "This patient has no chart; type the condition instead")
        cond = next((c for c in active_conditions(p["chart_id"]) if c["code"] == body.condition_code), None)
        if cond is None:
            raise HTTPException(422, "Condition is not an active condition in the chart")
        condition = Condition(code=cond["code"], system=cond["system"], display=cond["display"],
                              onset=cond["onset"])
    elif body.condition_text.strip():
        condition = Condition(display=body.condition_text.strip())
    else:
        raise HTTPException(422, "Add the condition this referral is for")
    today = clock.today(repo)
    draft = Referral(
        id=repo.next_id(), sample=False, patient_id=p["id"], patient_town=p["town"],
        specialty=body.specialty, pri_spec=pri_spec, priority=body.priority,
        reason_text=body.reason_text.strip(), reason_condition=condition,
        requester=Party(**repo.setting("practice")),
        performer=Performer(id=practice.id, name=practice.label, town=practice.town or practice.city_raw,
                            fictional=False, address=practice.address, zip5=practice.zip5,
                            org_pac_id=practice.org_pac_id),
        stage="draft", task_status=STAGES["draft"][0], business_status=STAGES["draft"][1],
        authored_on=today, events=[], replaces=body.replaces,
    )
    repo.put(draft)
    repo.token_for(draft.id)
    return _detail(draft)


# ---------------------------------------------------------------- send the referral

@router.get("/referrals/{rid}/message")
def referral_text(rid: str, request: Request) -> dict:
    ref = _get(rid)
    return referral_message(ref, _patient(ref), office_url(request, get_repo().token_for(rid)))


class SendReferral(BaseModel):
    channel: Literal["copy", "email", "print"]


@router.post("/referrals/{rid}/send")
def send_referral(rid: str, body: SendReferral, request: Request) -> dict:
    """Record that a person sent the referral (copied it, opened it in email, or printed it for
    fax). The first send moves Draft → Sent; later sends are recorded as resends."""
    repo = get_repo()
    ref = _get(rid)
    if ref.stage in ("closed", "cancelled", "declined"):
        raise HTTPException(409, f"Referral is {ref.stage}; nothing to send")
    today = clock.today(repo)
    msg = referral_message(ref, _patient(ref), office_url(request, repo.token_for(rid)))
    new = ref
    if ref.stage == "draft":
        try:
            new = transition(ref, "sent", at=today, actor="coordinator", by=ref.requester.coordinator,
                             note=f"Sent by {body.channel}")
        except InvalidTransition as e:
            raise HTTPException(409, str(e)) from e
    new = new.model_copy(deep=True)
    new.communications.append(Communication(
        id=f"{ref.id}-C{len(ref.communications) + 1}", sent=today, recipient="specialist",
        text=msg["text"], sent_by=ref.requester.coordinator, kind="referral", channel=body.channel))
    repo.put(new)
    return {**_detail(new), "message": msg, "communication_id": new.communications[-1].id}


# ---------------------------------------------------------------- coordinator Log update (R2.5)

class PlanForm(BaseModel):
    visit_date: Optional[date] = None
    assessment: str = Field(min_length=1, max_length=8000)
    plan: str = Field(min_length=1, max_length=8000)
    actions_for_pcp: str = Field(default="", max_length=4000)
    questions_contact: str = Field(default="", max_length=1000)


def make_plan(ref: Referral, form: PlanForm, today: date) -> Plan:
    visit = form.visit_date or (ref.appointment.start if ref.appointment else today)
    return Plan.model_validate({
        "returned_on": today, "from": ref.performer.name, "visit_date": visit,
        "reason": ref.reason_condition.display, "assessment": form.assessment.strip(),
        "plan": form.plan.strip(), "actions_for_pcp": form.actions_for_pcp.strip(),
        "questions_contact": form.questions_contact.strip(), "omitted_fields_note": OMITTED_NOTE,
    })


class LogUpdate(BaseModel):
    action: Literal["accepted", "declined", "scheduled", "seen", "no_show", "plan_received"]
    source: UpdateSource
    note: str = Field(default="", max_length=2000)
    appointment_date: Optional[date] = None
    appointment_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    plan: Optional[PlanForm] = None


def apply_update(ref: Referral, stage: str, *, actor: str, source: str, note: str, today: date,
                 appointment_date: Optional[date] = None, appointment_time: Optional[str] = None,
                 plan_form: Optional[PlanForm] = None) -> Referral:
    plan = None
    if stage == "plan_returned":
        if plan_form is None:
            raise HTTPException(422, "Returning a plan needs the plan form")
        plan = make_plan(ref, plan_form, today)
    if stage == "declined" and actor == "office" and not note.strip():
        raise HTTPException(422, "Add a reason for declining")
    try:
        new = transition(ref, stage, at=today, actor=actor, note=note.strip(), source=source,
                         appointment_start=appointment_date, plan=plan)
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    if stage == "scheduled" and appointment_time:
        new.appointment.time = appointment_time
    return new


@router.post("/referrals/{rid}/updates")
def log_update(rid: str, body: LogUpdate) -> dict:
    repo = get_repo()
    ref = _get(rid)
    new = apply_update(ref, LOG_ACTIONS[body.action], actor="coordinator", source=body.source,
                       note=body.note, today=clock.today(repo), appointment_date=body.appointment_date,
                       appointment_time=body.appointment_time, plan_form=body.plan)
    return _detail(repo.put(new))


# ---------------------------------------------------------------- follow-up drafts (R4.3, R4.4)

@router.get("/referrals/{rid}/draft")
def draft(rid: str, request: Request, rule: Optional[str] = None) -> dict:
    repo = get_repo()
    ref = _get(rid)
    try:
        return make_draft(ref, _patient(ref), clock.today(repo), rule=rule, rerouted_ids=_rerouted(),
                          office_url=office_url(request, repo.token_for(rid)))
    except NotStuck as e:
        raise HTTPException(409, str(e)) from e


class SendMessage(BaseModel):
    recipient: Literal["specialist", "patient", "pcp"]
    text: str = Field(min_length=1, max_length=8000)
    channel: Channel = "manual"
    rule: str = ""
    drafted_text: str = ""  # what Relay drafted, to record whether the sender edited it


@router.post("/referrals/{rid}/communications", status_code=201)
def send_message(rid: str, body: SendMessage) -> dict:
    repo = get_repo()
    ref = _get(rid)
    new = ref.model_copy(deep=True)
    new.communications.append(Communication(
        id=f"{ref.id}-C{len(ref.communications) + 1}", sent=clock.today(repo),
        recipient=body.recipient, text=body.text.strip(), sent_by=ref.requester.coordinator,
        kind="follow_up", channel=body.channel, ai_drafted=False, rule=body.rule,
        edited=bool(body.drafted_text) and body.text.strip() != body.drafted_text.strip(),
    ))
    repo.put(new)
    return {**_detail(new), "communication_id": new.communications[-1].id}


# ---------------------------------------------------------------- FHIR export (R10)

@router.get("/referrals/{rid}/fhir")
def fhir_bundle(rid: str) -> JSONResponse:
    repo = get_repo()
    ref = _get(rid)
    return JSONResponse(build_bundle(ref, repo.patient(ref.patient_id), clock.today(repo)),
                        media_type="application/fhir+json",
                        headers={"Content-Disposition": f'attachment; filename="relay-{rid}-fhir.json"'})


# ---------------------------------------------------------------- PCP close (R8)

class CloseBody(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/referrals/{rid}/close")
def close(rid: str, body: CloseBody) -> dict:
    repo = get_repo()
    ref = _get(rid)
    try:
        new = transition(ref, "closed", at=clock.today(repo), actor="pcp", by=ref.requester.clinician,
                         note=body.note.strip())
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    return _detail(repo.put(new))
