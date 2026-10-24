"""AI call assistant endpoints, matching frontend/src/components/CallAssistant.tsx.

The ElevenLabs API key stays on the server and is never logged or returned. Calls are offered
only for referrals stuck at Sent or Received. Transcripts produce a suggestion; nothing is saved.
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


__all__ = ["router", "long", "long_month"]
