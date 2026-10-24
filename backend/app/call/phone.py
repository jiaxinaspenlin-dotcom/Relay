"""Background AI phone calls to the specialist office (ElevenLabs agent over Twilio).

"Call office" places one outbound call and returns at once. A server-side poller checks the
conversation every few seconds until it ends, then runs the transcript pipeline
(app/call/transcript.py) and leaves a suggestion for the coordinator to review. Nothing is ever
applied automatically.

HARD RULE: the number dialed is always OFFICE_TEST_NUMBER. Relay never dials a number from
referral data or the CMS clinician file.

The ElevenLabs key is sent only in the xi-api-key header. It is never stored, logged, or returned.
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timedelta
from typing import Callable, Optional

import httpx

from app import config
from app.call.transcript import EmptyTranscript, clean_turns, process
from app.config import phone_settings
from app.loop.timeline import first_event_date
from app.views import initials

log = logging.getLogger("relay.call")

OUTBOUND_URL = "https://api.elevenlabs.io/v1/convai/twilio/outbound-call"
CONVERSATION_URL = "https://api.elevenlabs.io/v1/convai/conversations/{}"
POLL_SECS = 5
TIMEOUT = timedelta(minutes=10)
WAITING = {"initiated", "in-progress", "processing"}

NO_ONE_ANSWERED = "No one answered"
CALL_FAILED = "Call failed"
TIMED_OUT = "The call didn't finish within 10 minutes"
UNREADABLE = "The call ended but the transcript couldn't be read"

POLLER_ENABLED = True  # tests turn this off and drive poll_once() directly


class PhoneError(RuntimeError):
    """A safe-to-show reason the call couldn't be placed (never contains the key)."""


def long_month(d) -> str:
    return f"{d:%B} {d.day}, {d.year}"


def duration_label(secs: Optional[int]) -> str:
    if secs is None:
        return ""
    m, s = divmod(int(secs), 60)
    if not m:
        return f"{s} s"
    return f"{m} min {s} s" if s else f"{m} min"


def _redact(text: str) -> str:
    for v in phone_settings().values():
        if v:
            text = text.replace(v, "<redacted>")
    return text


def _refusal(r: httpx.Response) -> str:
    reason = ""
    try:
        body = r.json()
        detail = body.get("detail", body.get("message", ""))
        reason = detail.get("message", "") if isinstance(detail, dict) else str(detail or "")
    except ValueError:
        pass
    reason = _redact(reason)[:200]
    return f"The phone service refused the call ({r.status_code})" + (f": {reason}" if reason else "")


# Network calls are module functions so tests can replace them (no network in tests).
def _post(url: str, *, headers: dict, json: dict) -> httpx.Response:
    return httpx.post(url, headers=headers, json=json, timeout=20)


def fetch_conversation(conversation_id: str) -> dict:
    p = phone_settings()
    r = httpx.get(CONVERSATION_URL.format(conversation_id), headers={"xi-api-key": p["api_key"]}, timeout=15)
    r.raise_for_status()
    return r.json()


def dynamic_variables(ref, patient: dict) -> dict:
    sent = first_event_date(ref, "sent") or ref.authored_on
    return {
        "referral_id": ref.id,
        "specialty": ref.specialty,
        "requesting_practice": ref.requester.practice,
        "sent_date": long_month(sent),
        "patient_initials": initials(patient.get("name", "")) or "unknown",
    }


def outbound_body(ref, patient: dict) -> dict:
    p = phone_settings()
    return {
        "agent_id": p["agent_id"],
        "agent_phone_number_id": p["phone_number_id"],
        # Always the test number. Never ref.performer.phone or anything from data/.
        "to_number": p["to_number"],
        "conversation_initiation_client_data": {"dynamic_variables": dynamic_variables(ref, patient)},
    }


def now_iso() -> str:
    return config.real_now().isoformat()


def start_call(repo, ref, patient: dict, user) -> dict:
    """Place the outbound call and record a CallAttempt with status "calling"."""
    p = phone_settings()
    if not all(p.values()):
        raise PhoneError("Phone calls aren't configured on this server")
    try:
        r = _post(OUTBOUND_URL, headers={"xi-api-key": p["api_key"]}, json=outbound_body(ref, patient))
    except httpx.HTTPError:
        raise PhoneError("Couldn't reach the phone service. Try again.") from None
    try:
        out = r.json()
    except ValueError:
        out = {}
    if r.status_code != 200 or not out.get("success") or not out.get("conversation_id"):
        raise PhoneError(_refusal(r) if r.status_code != 200 else
                         _redact(str(out.get("message") or "The phone service didn't start the call"))[:200])
    call = {
        "id": f"call-{uuid.uuid4().hex[:12]}",
        "referral_id": ref.id,
        "user_id": user.id,
        "user_name": user.name,
        "practice": ref.performer.name,
        "conversation_id": out["conversation_id"],
        "call_sid": out.get("callSid") or out.get("call_sid"),
        "status": "calling",
        "reason": "",
        "started_at": now_iso(),
        "finished_at": None,
        "duration_secs": None,
        "transcript": [],
        "result": None,
        "applied_by": None,
        "applied_at": None,
    }
    repo.add_call(call)
    log.info("call %s started for %s (conversation %s)", call["id"], ref.id, call["conversation_id"])
    ensure_poller(repo)
    return call


def _turns(conv: dict) -> list[dict]:
    out = []
    for t in conv.get("transcript") or []:
        if t.get("role") in ("agent", "user") and t.get("message"):
            out.append({"role": t["role"], "message": t["message"]})
    return out


def poll_once(repo, call: dict, *, now: Optional[datetime] = None,
              fetch: Optional[Callable[[str], dict]] = None) -> dict:
    """Check one calling attempt once; finish it if the conversation has ended or timed out."""
    if call["status"] != "calling":
        return call
    now = now or config.real_now()
    timed_out = now - datetime.fromisoformat(call["started_at"]) > TIMEOUT
    try:
        conv = (fetch or fetch_conversation)(call["conversation_id"])
    except Exception:  # network trouble: keep waiting until the timeout
        log.warning("call %s: couldn't fetch the conversation", call["id"])
        conv = None
    if conv is None:
        if timed_out:
            return repo.update_call(call["id"], status="no_answer", reason=TIMED_OUT, finished_at=now.isoformat())
        return call
    status = conv.get("status")
    secs = (conv.get("metadata") or {}).get("call_duration_secs")
    turns = _turns(conv)
    if status in WAITING or status is None:
        if timed_out:
            return repo.update_call(call["id"], status="no_answer", reason=TIMED_OUT, finished_at=now.isoformat(),
                                    duration_secs=secs)
        return call
    fields = {"finished_at": now.isoformat(), "duration_secs": secs}
    if status == "failed":
        return repo.update_call(call["id"], status="no_answer", reason=CALL_FAILED, **fields)
    if not any(t["role"] == "user" for t in turns):
        return repo.update_call(call["id"], status="no_answer", reason=NO_ONE_ANSWERED, **fields)
    try:
        cleaned = clean_turns(turns)
        result = process(turns, repo.get(call["referral_id"]))
    except EmptyTranscript:
        return repo.update_call(call["id"], status="no_answer", reason=NO_ONE_ANSWERED, **fields)
    except Exception:
        log.exception("call %s: transcript pipeline failed", call["id"])
        return repo.update_call(call["id"], status="no_answer", reason=UNREADABLE, **fields)
    log.info("call %s finished (%s s), ready for review", call["id"], secs)
    return repo.update_call(call["id"], status="ready_for_review", transcript=cleaned, result=result, **fields)


def public(call: dict) -> dict:
    """What the UI sees. There are no secrets in a call record; the dialed number isn't stored."""
    return {**call, "duration_label": duration_label(call.get("duration_secs")),
            "summary": (call.get("result") or {}).get("summary", "")}


# ---------------------------------------------------------------- background poller

class Poller:
    """One daemon thread polls every open call. Unfinished calls resume after a restart, because
    open calls are read from the database on each tick."""

    def __init__(self, get_repo: Callable):
        self.get_repo = get_repo
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running() or not POLLER_ENABLED:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="relay-call-poller", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def tick(self) -> None:
        repo = self.get_repo()
        for call in repo.open_calls():
            if call.get("e2e"):  # fake calls from the UI tests are finished by the test itself
                continue
            try:
                poll_once(repo, call)
            except Exception:
                log.exception("call %s: poll failed", call.get("id"))

    def _run(self) -> None:
        while not self._stop.wait(POLL_SECS):
            try:
                self.tick()
            except Exception:
                log.exception("call poller tick failed")


_poller: Optional[Poller] = None


def ensure_poller(repo=None) -> None:
    global _poller
    if not POLLER_ENABLED:
        return
    if _poller is None:
        from app.store import get_repo
        _poller = Poller(get_repo)
    _poller.start()
