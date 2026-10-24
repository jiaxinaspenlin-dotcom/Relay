"""AI call endpoints.

Two ways to call the office, both for referrals stuck at Sent or Received, coordinators only:
- call-office (default): a real phone call placed by the server (app/call/phone.py). It runs in
  the background; the result waits for the coordinator to Apply, Edit, or ignore.
- call-session / call-transcript: the in-browser CallAssistant (fallback when phone calling
  isn't configured). Transcripts produce a suggestion; nothing is saved.

The ElevenLabs API key stays on the server and is never logged or returned.
"""
from __future__ import annotations

from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import clock
from app.call.transcript import EmptyTranscript, process
from app.config import voice_settings
from app.dates import long
from app.loop.stuck import stuck_flags
from app.loop.timeline import first_event_date
from app.api.auth import require_role
from app.call import phone
from app.loop.states import InvalidTransition, record_field_update
from app.updates import UpdateBody, UpdateError, apply_update
from app.store import get_repo
from app.views import initials

router = APIRouter(prefix="/api/referrals")
TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token"


def _eligible(rid: str):
    repo = get_repo()
    try:
        ref = repo.get(rid)
    except KeyError:
        raise HTTPException(404, f"No referral {rid}") from None
    patient = repo.patient(ref.patient_id) or {}
    flags = stuck_flags(ref, clock.today(repo), coverage=patient.get("coverage"))
    if ref.stage not in ("sent", "received") or not flags:
        raise HTTPException(403, "AI calls are only for referrals stuck at Sent or Received")
    return ref, patient


def long_month(d) -> str:
    """'October 6, 2026' (full month name, for the voice agent)."""
    return f"{d:%B} {d.day}, {d.year}"


@router.post("/{rid}/call-session")
def call_session(rid: str, request: Request) -> dict:
    require_role(request, "coordinator", "start an AI call")
    v = voice_settings()
    if not (v["api_key"] and v["agent_id"]):
        raise HTTPException(503, "Voice calls aren't configured on this server")
    ref, patient = _eligible(rid)
    try:
        r = httpx.get(TOKEN_URL, params={"agent_id": v["agent_id"]}, headers={"xi-api-key": v["api_key"]}, timeout=15)
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach the voice service. Try again.") from None
    if r.status_code != 200 or "token" not in r.json():
        # Pass on ElevenLabs' reason (e.g. a key missing the convai_write permission). Their
        # error bodies don't echo the key, and we never include it.
        reason = ""
        try:
            detail = r.json().get("detail")
            reason = detail.get("message", "") if isinstance(detail, dict) else str(detail or "")
        except ValueError:
            pass
        reason = reason.replace(v["api_key"], "").replace(v["agent_id"], "<agent>")[:200]
        raise HTTPException(502, f"The voice service refused the session ({r.status_code})"
                                 + (f": {reason}" if reason else ""))
    sent = first_event_date(ref, "sent") or ref.authored_on
    return {
        "conversation_token": r.json()["token"],
        "dynamic_variables": {
            "referral_id": ref.id,
            "specialty": ref.specialty,
            "requesting_practice": ref.requester.practice,
            "sent_date": long_month(sent),
            "patient_initials": initials(patient.get("name", "")) or "unknown",
        },
    }


class Turn(BaseModel):
    role: Literal["agent", "user"]
    message: str


class TranscriptBody(BaseModel):
    conversation_id: Optional[str] = None
    turns: list[Turn]


@router.post("/{rid}/call-transcript")
def call_transcript(rid: str, body: TranscriptBody, request: Request) -> dict:
    require_role(request, "coordinator", "check an AI call transcript")
    repo = get_repo()
    try:
        ref = repo.get(rid)
    except KeyError:
        raise HTTPException(404, f"No referral {rid}") from None
    try:
        out = process([t.model_dump() for t in body.turns], ref)
    except EmptyTranscript as e:
        raise HTTPException(400, str(e)) from e
    return {"conversation_id": body.conversation_id, "referral_id": rid, **out}


# ---------------------------------------------------------------- background phone calls (E2)

@router.post("/{rid}/call-office")
def call_office(rid: str, request: Request) -> dict:
    """Place a real phone call to the office (always OFFICE_TEST_NUMBER) and return at once."""
    user = require_role(request, "coordinator", "call the office")
    ref, patient = _eligible(rid)
    repo = get_repo()
    if any(c["status"] == "calling" for c in repo.calls_for(rid)):
        raise HTTPException(409, "A call to this office is already in progress")
    try:
        call = phone.start_call(repo, ref, patient, user)
    except phone.PhoneError as e:
        raise HTTPException(502 if "configured" not in str(e) else 503, str(e)) from None
    return {"call": phone.public(call)}


@router.get("/{rid}/calls")
def list_calls(rid: str) -> dict:
    repo = get_repo()
    try:
        repo.get(rid)
    except KeyError:
        raise HTTPException(404, f"No referral {rid}") from None
    return {"calls": [phone.public(c) for c in repo.calls_for(rid)]}


def _call_for(rid: str, cid: str) -> dict:
    try:
        call = get_repo().call(cid)
    except KeyError:
        raise HTTPException(404, "No such call") from None
    if call["referral_id"] != rid:
        raise HTTPException(404, "No such call")
    return call


def call_note(res: dict) -> str:
    """Extra facts from the call for the timeline subtitle: "Scheduling: Mon–Fri 8–4 · 413-555-0142"."""
    from app.call.transcript import short_hours
    sched = [x for x in (res.get("scheduling_hours") and short_hours(res["scheduling_hours"]),
                         res.get("scheduling_phone")) if x]
    return " · ".join(x for x in ("Scheduling: " + " · ".join(sched) if sched else "", res.get("note")) if x)


def mark_applied(cid: str, user) -> dict:
    return get_repo().update_call(cid, status="applied", applied_by=user.name, applied_at=phone.now_iso())


@router.post("/{rid}/calls/{cid}/apply")
def apply_call(rid: str, cid: str, request: Request) -> dict:
    """The coordinator confirms the call result. Stage changes go through loop/states.py."""
    from app.api.referrals import _detail
    user = require_role(request, "coordinator", "apply an AI call result")
    call = _call_for(rid, cid)
    if call["status"] != "ready_for_review":
        raise HTTPException(409, "This call has no result waiting for review")
    repo = get_repo()
    ref = repo.get(rid)
    res = call["result"] or {}
    today = clock.today(repo)
    kw = dict(at=today, actor="coordinator", source="ai_call", by=user.name, user_id=user.id)
    extra = call_note(res)
    try:
        if res.get("received") == "no":
            method = res.get("resend_method") or "unknown"
            note = "Office says not received" + (f", resend via {method}" if method != "unknown" else "")
            new = record_field_update(ref, "call", note=" · ".join(x for x in (note, extra) if x), **kw)
            if ref.stage == "sent":
                new.office_not_received, new.office_resend_method = today, method
        elif res.get("proposed_stage"):
            stage = res["proposed_stage"]
            body = UpdateBody(
                action={"Received-complete": "received", "Received-incomplete": "missing",
                        "Patient contacted": "patient_contacted"}[stage],
                missing=res.get("missing_items") or [], note=extra,
                contact_mode="office_called" if stage == "Patient contacted" else None)
            new = apply_update(ref, body, actor="coordinator", source="ai_call", today=today,
                               by=user.name, user_id=user.id)
        else:
            new = record_field_update(ref, "call", note=" · ".join(x for x in (res.get("summary"), extra) if x), **kw)
    except UpdateError as e:
        raise HTTPException(422, str(e)) from e
    except InvalidTransition as e:
        raise HTTPException(409, str(e)) from e
    new.events[-1].call_duration = phone.duration_label(call.get("duration_secs"))
    repo.put(new)
    call = mark_applied(cid, user)
    return {**_detail(new), "call": phone.public(call)}


__all__ = ["router", "long", "long_month"]
