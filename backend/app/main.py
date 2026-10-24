"""FastAPI entry point.

Accounts: coordinators and clinicians sign in (argon2 hashes, HttpOnly session cookie). Office
links (/office/{token}) are capability URLs with no account: anyone holding a link can update
that one referral and see its summary. This is not a HIPAA-compliant deployment; production needs
SSO, audit logging, and hosting approved for patient data.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from app import clock
from app.api import auth, call, dashboard, finder, inbox, office, referrals
from app.call import phone
from app.store import get_repo


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Resume any phone calls left open by a restart, then keep polling in the background.
    phone.ensure_poller()
    yield


app = FastAPI(title="Relay", lifespan=lifespan)
app.middleware("http")(auth.auth_middleware)
for module in (auth, dashboard, finder, inbox, referrals, office, call):
    app.include_router(module.router)


@app.get("/api/health")
def health() -> dict:
    repo = get_repo()
    # db file name (not path) lets the e2e script refuse to touch anything but its own database.
    return {"ok": True, "db": Path(repo.path).name, **clock.info()}


def _e2e_only():
    """End-to-end test endpoints exist only when RELAY_E2E=1 and the database is relay-e2e.db."""
    repo = get_repo()
    if os.environ.get("RELAY_E2E") != "1" or Path(repo.path).name != "relay-e2e.db":
        raise HTTPException(404, "Not found")
    return repo


@app.post("/api/test/reset")
def test_reset() -> dict:
    _e2e_only().reset_everything()
    return {"ok": True}


# Fake phone calls for the UI tests: the browser script swaps the real "call-office" request for
# these, so e2e runs never dial anyone. The real transcript pipeline still runs on finish.
class FakeCall(BaseModel):
    referral_id: str


class FakeFinish(BaseModel):
    status: str = "done"
    duration_secs: int | None = None
    turns: list[dict] = []


@app.post("/api/test/calls")
def test_fake_call(body: FakeCall, request: Request) -> dict:
    import uuid
    repo = _e2e_only()
    user = auth.current_user(request)
    ref = repo.get(body.referral_id)
    call = repo.add_call({
        "id": f"call-{uuid.uuid4().hex[:12]}", "referral_id": ref.id, "user_id": user.id,
        "user_name": user.name, "practice": ref.performer.name, "conversation_id": f"e2e-{uuid.uuid4().hex[:8]}",
        "call_sid": None, "status": "calling", "phase": "initiated", "phase_at": phone.now_iso(), "reason": "", "started_at": phone.now_iso(), "finished_at": None,
        "duration_secs": None, "transcript": [], "result": None, "applied_by": None, "applied_at": None, "e2e": True})
    return {"call": phone.public(call)}


class FakePhase(BaseModel):
    phase: str


@app.post("/api/test/calls/{cid}/phase")
def test_call_phase(cid: str, body: FakePhase) -> dict:
    """Move a fake call through initiated → in-progress → processing (UI tests and screenshots)."""
    repo = _e2e_only()
    conv = {"status": body.phase, "metadata": {}, "transcript": []}
    return {"call": phone.public(phone.poll_once(repo, repo.call(cid), fetch=lambda _cid: conv))}


@app.post("/api/test/calls/{cid}/finish")
def test_finish_call(cid: str, body: FakeFinish) -> dict:
    repo = _e2e_only()
    conv = {"status": body.status, "metadata": {"call_duration_secs": body.duration_secs}, "transcript": body.turns}
    return {"call": phone.public(phone.poll_once(repo, repo.call(cid), fetch=lambda _cid: conv))}
