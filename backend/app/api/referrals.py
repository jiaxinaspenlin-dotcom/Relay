"""Referrals: create (draft), send (copy / email / print), detail, coordinator Log update,
barriers, transportation, office phone, follow-ups, patient messages, PCP close, FHIR export."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import clock
from app.chart import active_conditions
from app.config import FINDER_SPECIALTIES
from app.drafting.draft import NotStuck, make_draft
from app.drafting.templates import patient_message, referral_message
from app.export.fhir import build_bundle
from app.finder.practices import practices_for
from app.loop.states import STAGES, InvalidTransition, record_field_update, transition
from app.loop.stuck import BARRIER_LABELS
from app.models import (Barrier, BarrierType, Channel, Communication, Condition, Party, Performer,
                        Referral)
from app.api.auth import current_user, require_role
from app.auth import User
from app.store import get_repo
from app.updates import UpdateBody, UpdateError, apply_update
from app.views import patient_brief, referral_detail_view

router = APIRouter(prefix="/api")


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


def _save(ref: Referral) -> dict:
    get_repo().put(ref)
    return _detail(ref)


def _actor(user: User) -> str:
    return "pcp" if user.role == "clinician" else "coordinator"


def _comm(ref: Referral, user: User, *, recipient: str, text: str, kind: str, channel: str,
          rule: str = "", edited: bool = False) -> Referral:
    new = ref.model_copy(deep=True)
    new.communications.append(Communication(
        id=f"{ref.id}-C{len(ref.communications) + 1}", sent=clock.today(get_repo()), recipient=recipient,
        text=text.strip(), sent_by=user.name, sent_by_id=user.id, kind=kind, channel=channel, rule=rule,
        edited=edited))
    return new


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
def create_referral(body: NewReferral, request: Request) -> dict:
    user = require_role(request, "coordinator", "create referrals")
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
        requester=Party(**{**repo.setting("practice"),
                           **({"coordinator": user.name} if user.role == "coordinator" else {"clinician": user.name})}),
        performer=Performer(id=practice.id, name=practice.label, town=practice.town or practice.city_raw,
                            fictional=False, address=practice.address, zip5=practice.zip5,
                            org_pac_id=practice.org_pac_id, phone=practice.phone),
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
    """Record that a person sent the referral. The first send moves Draft to Sent."""
    user = require_role(request, "coordinator", "send referrals")
    repo = get_repo()
    ref = _get(rid)
    if ref.stage in ("closed", "cancelled", "declined"):
        raise HTTPException(409, f"Referral is {ref.stage}; nothing to send")
    msg = referral_message(ref, _patient(ref), office_url(request, repo.token_for(rid)))
    new = ref
    if ref.stage == "draft":
        new = transition(ref, "sent", at=clock.today(repo), actor=_actor(user), by=user.name,
                         user_id=user.id, note={"copy": "Copied for sending", "email": "Opened in email", "print": "Printed for fax"}[body.channel])
    new = _comm(new, user, recipient="specialist", text=msg["text"], kind="referral", channel=body.channel)
    return {**_save(new), "message": msg, "communication_id": new.communications[-1].id}


# ---------------------------------------------------------------- coordinator Log update (R2.5)

class LogUpdate(UpdateBody):
    source: Literal["phone", "fax", "email", "ai_call", "other"]


@router.post("/referrals/{rid}/updates")
def log_update(rid: str, body: LogUpdate, request: Request) -> dict:
    user = require_role(request, "coordinator", "log updates")
    repo = get_repo()
    try:
        new = apply_update(_get(rid), body, actor=_actor(user), source=body.source, today=clock.today(repo),
                           by=user.name, user_id=user.id)
    except UpdateError as e:
        raise HTTPException(422, str(e)) from e
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    return _save(new)


# ---------------------------------------------------------------- barriers, transport, phone

class BarrierBody(BaseModel):
    type: BarrierType
    note: str = Field(default="", max_length=1000)


@router.post("/referrals/{rid}/barriers", status_code=201)
def add_barrier(rid: str, body: BarrierBody, request: Request) -> dict:
    user = require_role(request, "coordinator", "log barriers")
    repo = get_repo()
    ref = _get(rid)
    today = clock.today(repo)
    if any(b.type == body.type and b.status == "open" for b in ref.barriers):
        raise HTTPException(409, f"A {BARRIER_LABELS[body.type].lower()} barrier is already open")
    new = record_field_update(ref, "barrier", at=today, actor=_actor(user), by=user.name, user_id=user.id,
                              note=f"{BARRIER_LABELS[body.type]} barrier: {body.note.strip()}".rstrip(": "))
    new.barriers.append(Barrier(type=body.type, status="open", opened=today, note=body.note.strip()))
    return _save(new)


@router.post("/referrals/{rid}/barriers/{btype}/address")
def address_barrier(rid: str, btype: BarrierType, request: Request) -> dict:
    user = require_role(request, "coordinator", "update barriers")
    repo = get_repo()
    ref = _get(rid)
    today = clock.today(repo)
    new = record_field_update(ref, "barrier", at=today, actor=_actor(user), by=user.name, user_id=user.id,
                              note=f"{BARRIER_LABELS[btype]} barrier addressed")
    hit = False
    for b in new.barriers:
        if b.type == btype and b.status == "open":
            b.status, b.addressed, hit = "addressed", today, True
    if not hit:
        raise HTTPException(404, "No open barrier of that type")
    return _save(new)


class TransportBody(BaseModel):
    pt1_status: Optional[Literal["not_started", "requested", "confirmed"]] = None
    transport_plan: Optional[str] = Field(default=None, max_length=1000)


PT1_LABELS = {"not_started": "not started", "requested": "requested", "confirmed": "ride confirmed"}


@router.post("/referrals/{rid}/transport")
def set_transport(rid: str, body: TransportBody, request: Request) -> dict:
    user = require_role(request, "coordinator", "update transportation")
    repo = get_repo()
    ref = _get(rid)
    notes = []
    if body.pt1_status is not None:
        notes.append(f"MassHealth ride (PT-1): {PT1_LABELS[body.pt1_status]}")
    if body.transport_plan is not None:
        notes.append("Transportation plan updated")
    if not notes:
        raise HTTPException(422, "Nothing to update")
    new = record_field_update(ref, "transport", at=clock.today(repo), actor=_actor(user), by=user.name,
                              user_id=user.id, note=". ".join(notes))
    if body.pt1_status is not None:
        new.pt1_status = body.pt1_status
    if body.transport_plan is not None:
        new.transport_plan = body.transport_plan.strip()
    return _save(new)


class PhoneBody(BaseModel):
    phone: str = Field(pattern=r"^[0-9()+\-. ]{7,20}$")


@router.post("/referrals/{rid}/office-phone")
def set_office_phone(rid: str, body: PhoneBody, request: Request) -> dict:
    user = require_role(request, "coordinator", "update the office phone")
    repo = get_repo()
    ref = _get(rid)
    new = record_field_update(ref, "phone", at=clock.today(repo), actor=_actor(user), by=user.name,
                              user_id=user.id, note=f"Office scheduling phone: {body.phone.strip()}")
    new.performer.phone = body.phone.strip()
    return _save(new)


# ---------------------------------------------------------------- follow-ups and patient messages

@router.get("/referrals/{rid}/draft")
def draft(rid: str, request: Request, rule: Optional[str] = None) -> dict:
    repo = get_repo()
    ref = _get(rid)
    try:
        return make_draft(ref, _patient(ref), clock.today(repo), rule=rule, rerouted_ids=_rerouted(),
                          office_url=office_url(request, repo.token_for(rid)))
    except NotStuck as e:
        raise HTTPException(409, str(e)) from e


@router.get("/referrals/{rid}/patient-message")
def patient_next_step(rid: str) -> dict:
    ref = _get(rid)
    if ref.stage not in ("received", "patient_contacted", "no_show", "scheduled"):
        raise HTTPException(409, "The patient message is available after the office confirms receipt")
    return patient_message(ref, _patient(ref))


class SendMessage(BaseModel):
    recipient: Literal["specialist", "patient", "pcp"]
    text: str = Field(min_length=1, max_length=8000)
    channel: Channel = "manual"
    kind: Literal["follow_up", "patient_message"] = "follow_up"
    rule: str = ""
    drafted_text: str = ""  # what Relay drafted, to record whether the sender edited it


@router.post("/referrals/{rid}/communications", status_code=201)
def send_message(rid: str, body: SendMessage, request: Request) -> dict:
    user = require_role(request, "coordinator", "send messages")
    ref = _get(rid)
    new = _comm(ref, user, recipient=body.recipient, text=body.text, kind=body.kind, channel=body.channel,
                rule=body.rule,
                edited=bool(body.drafted_text) and body.text.strip() != body.drafted_text.strip())
    return {**_save(new), "communication_id": new.communications[-1].id}


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
def close(rid: str, body: CloseBody, request: Request) -> dict:
    """Only a clinician can acknowledge a returned plan and close the loop."""
    user = require_role(request, "clinician", "acknowledge and close a referral")
    repo = get_repo()
    ref = _get(rid)
    try:
        new = transition(ref, "closed", at=clock.today(repo), actor="pcp", by=user.name, user_id=user.id,
                         note=body.note.strip())
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    return _save(new)
