"""Background AI phone calls (E2). ElevenLabs is mocked: no network, no real calls.

Covers: the outbound request always dials OFFICE_TEST_NUMBER; the poller's paths (finished with
the office talking, no one answered, failed, timed out); the "not received" outcome; Apply and Edit
record the coordinator and the call length; the API key never appears in responses or logs.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app import config
from app.call import phone
from app.config import ROOT
from app.store import get_repo

KEY = "sk_test_secret_key_value"
TEST_NUMBER = "+14135550100"
T0 = datetime(2026, 10, 24, 14, 0, tzinfo=timezone.utc)


def turns_from(name: str) -> list[dict]:
    out = []
    for line in (ROOT / "docs" / name).read_text(encoding="utf-8").splitlines():
        if line.strip():
            role, msg = line.split(":", 1)
            out.append({"role": role.strip(), "message": msg.strip()})
    return out


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", KEY)
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_123")
    monkeypatch.setenv("ELEVENLABS_PHONE_NUMBER_ID", "phnum_456")
    monkeypatch.setenv("OFFICE_TEST_NUMBER", TEST_NUMBER)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # deterministic extraction
    monkeypatch.setattr(config, "real_now", lambda: T0)


@pytest.fixture()
def outbound(monkeypatch):
    """Fake ElevenLabs outbound-call endpoint. Records every request."""
    sent = []

    def fake_post(url, *, headers, json):
        sent.append({"url": url, "headers": headers, "json": json})
        return httpx.Response(200, json={"success": True, "message": "Success", "conversation_id": f"conv_{len(sent)}",
                                         "callSid": f"CA{len(sent)}"})
    monkeypatch.setattr(phone, "_post", fake_post)
    return sent


@pytest.fixture()
def sample(client, env, outbound):
    client.post("/api/sample-data")
    return client


def conv(status: str, turns: list[dict] | None = None, secs: int | None = 92) -> dict:
    return {"conversation_id": "x", "status": status, "metadata": {"call_duration_secs": secs},
            "transcript": [{**t, "time_in_call_secs": i} for i, t in enumerate(turns or [])]}


def place(client, rid: str) -> dict:
    r = client.post(f"/api/referrals/{rid}/call-office")
    assert r.status_code == 200, r.text
    return r.json()["call"]


def poll(call: dict, reply: dict | None, minutes: float = 0.5) -> dict:
    def fetch(cid):
        if reply is None:
            raise httpx.ConnectError("down")
        return reply
    return phone.poll_once(get_repo(), get_repo().call(call["id"]), now=T0 + timedelta(minutes=minutes), fetch=fetch)


# ---------------------------------------------------------------- placing the call

def test_config_reports_phone_calling(sample, monkeypatch):
    assert sample.get("/api/config").json() == {"voice_enabled": True, "phone_calling_enabled": True}
    monkeypatch.setenv("OFFICE_TEST_NUMBER", "")
    assert sample.get("/api/config").json()["phone_calling_enabled"] is False
    assert sample.post("/api/referrals/R-102/call-office").status_code == 503


def test_outbound_call_always_dials_the_test_number(sample, outbound):
    call = place(sample, "R-102")
    assert call["status"] == "calling" and call["conversation_id"] == "conv_1" and call["call_sid"] == "CA1"
    assert call["user_name"] == "Casey Reed"
    req = outbound[0]
    assert req["url"] == "https://api.elevenlabs.io/v1/convai/twilio/outbound-call"
    assert req["headers"] == {"xi-api-key": KEY}
    assert req["json"] == {
        "agent_id": "agent_123",
        "agent_phone_number_id": "phnum_456",
        "to_number": TEST_NUMBER,
        "conversation_initiation_client_data": {"dynamic_variables": {
            "referral_id": "R-102", "specialty": "Cardiology",
            "requesting_practice": "Quabbin Hills Family Medicine",
            "sent_date": "October 6, 2026", "patient_initials": "L. W.",
        }},
    }
    # Every sample office phone and every number in the referral is ignored.
    ref = sample.get("/api/referrals/R-101").json()["referral"]
    get_repo().update_call(call["id"], status="no_answer")
    place(sample, "R-101")
    assert outbound[1]["json"]["to_number"] == TEST_NUMBER != ref["performer"]["phone"]
    assert all(r["json"]["to_number"] == TEST_NUMBER for r in outbound)


def test_one_call_at_a_time_and_only_stuck_at_sent_or_received(sample):
    place(sample, "R-102")
    assert sample.post("/api/referrals/R-102/call-office").status_code == 409
    for rid in ("R-103", "R-104", "R-106"):
        assert sample.post(f"/api/referrals/{rid}/call-office").status_code == 403


def test_refusal_reason_is_passed_on_without_the_key(sample, monkeypatch):
    def refuse(url, *, headers, json):
        return httpx.Response(401, json={"detail": {"message": f"Key {KEY} is missing the permission convai_write"}})
    monkeypatch.setattr(phone, "_post", refuse)
    r = sample.post("/api/referrals/R-102/call-office")
    assert r.status_code == 502 and "convai_write" in r.text and KEY not in r.text
    assert sample.get("/api/referrals/R-102/calls").json() == {"calls": []}


# ---------------------------------------------------------------- the poller

def test_still_ringing_keeps_calling(sample):
    call = place(sample, "R-102")
    for status in ("initiated", "in-progress", "processing"):
        assert poll(call, conv(status))["status"] == "calling"
    assert poll(call, None)["status"] == "calling"  # network hiccup: keep waiting


def test_finished_call_is_ready_for_review(sample):
    call = place(sample, "R-102")
    out = poll(call, conv("done", turns_from("sample_call_transcript.txt"), secs=92))
    assert out["status"] == "ready_for_review" and out["duration_secs"] == 92
    res = out["result"]
    assert res["received"] == "yes" and res["missing_items"] == ["records"]
    assert res["scheduling_phone"] == "413-555-0142"
    assert res["scheduling_hours"] == "Monday through Friday 8:00 to 4:00"
    assert res["proposed_stage"] == "Received-incomplete" and res["proposed_action"] is None
    assert res["summary"] == "Received, missing records. Patient not contacted yet. Scheduling: 413-555-0142, Mon–Fri 8–4"
    assert all("[" not in t["message"] for t in out["transcript"])  # voice tags stripped
    # Never applied automatically
    assert sample.get("/api/referrals/R-102").json()["card"]["stage"] == "received"
    listed = sample.get("/api/referrals/R-102/calls").json()["calls"][0]
    assert listed["status"] == "ready_for_review" and listed["duration_label"] == "1 min 32 s"


def test_not_received_call(sample):
    call = place(sample, "R-101")
    out = poll(call, conv("done", turns_from("sample_call_not_received.txt"), secs=75))
    res = out["result"]
    assert out["status"] == "ready_for_review"
    assert res["received"] == "no" and res["resend_method"] == "portal"
    assert res["scheduling_phone"] == "413-555-0142"
    assert res["scheduling_hours"] == "Monday through Friday from 8:00 to 4:00"
    assert res["patient_contacted"] == "unknown"  # a read-back + "Yep, you too" is not an answer
    assert res["proposed_stage"] is None and res["proposed_action"] == "Resend referral via portal"
    assert res["summary"] == "Not received, resend via portal. Scheduling: 413-555-0142, Mon–Fri 8–4"

    # Apply: stage stays Sent, the row says "Office says not received" until a resend.
    r = sample.post(f"/api/referrals/R-101/calls/{call['id']}/apply")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["card"]["stage"] == "sent"
    assert [f["rule"] for f in d["card"]["stuck"]] == ["office_not_received"]
    flag = d["card"]["stuck"][0]
    assert flag["status"] == "Office says not received" and flag["action"] == "resend"
    assert flag["rule"] not in ("not_scheduled", "seen_no_plan")  # amber, not a challenge failure
    ev = d["referral"]["events"][-1]
    assert ev["kind"] == "call" and ev["source"] == "ai_call" and ev["by"] == "Casey Reed"
    assert ev["call_duration"] == "1 min 15 s" and "resend via portal" in ev["note"]
    row = next(x for x in sample.get("/api/dashboard").json()["needs_attention"] if x["referral_id"] == "R-101")
    assert row["flags"][0]["status"] == "Office says not received"

    # The coordinator resends: recorded as a Communication, flag cleared, receipt clock restarts.
    d = sample.post("/api/referrals/R-101/send", json={"channel": "email"}).json()
    assert d["card"]["stage"] == "sent" and d["card"]["stuck"] == []
    assert d["referral"]["communications"][-1]["channel"] == "email"
    assert d["referral"]["events"][-1]["kind"] == "resend"


@pytest.mark.parametrize("reply,reason", [
    (conv("done", [{"role": "agent", "message": "Hi, this is an automated assistant..."}], secs=30), phone.NO_ONE_ANSWERED),
    (conv("done", [], secs=0), phone.NO_ONE_ANSWERED),
    (conv("failed", [], secs=None), phone.CALL_FAILED),
])
def test_unanswered_and_failed_calls(sample, reply, reason):
    call = place(sample, "R-102")
    out = poll(call, reply)
    assert out["status"] == "no_answer" and out["reason"] == reason and out["result"] is None
    assert sample.post(f"/api/referrals/R-102/calls/{call['id']}/apply").status_code == 409
    place(sample, "R-102")  # try again


def test_timeout(sample):
    call = place(sample, "R-102")
    assert poll(call, conv("in-progress"), minutes=9.9)["status"] == "calling"
    out = poll(call, conv("in-progress"), minutes=10.1)
    assert out["status"] == "no_answer" and out["reason"] == phone.TIMED_OUT
    call = place(sample, "R-102")
    assert poll(call, None, minutes=11)["status"] == "no_answer"


def test_poller_resumes_open_calls(sample, monkeypatch):
    """The poller reads open calls from the database, so calls survive an API restart."""
    a = place(sample, "R-102")
    b = place(sample, "R-109")
    seen = []

    def fetch(cid):
        seen.append(cid)
        return conv("done", turns_from("sample_call_transcript.txt"))
    monkeypatch.setattr(phone, "fetch_conversation", fetch)
    phone.Poller(get_repo).tick()  # a fresh poller, as after a restart
    assert sorted(seen) == sorted([a["conversation_id"], b["conversation_id"]])
    assert get_repo().open_calls() == []


# ---------------------------------------------------------------- apply / edit

def test_apply_records_the_user_and_duration(sample):
    call = place(sample, "R-102")
    poll(call, conv("done", turns_from("sample_call_transcript.txt"), secs=92))
    r = sample.post(f"/api/referrals/R-102/calls/{call['id']}/apply")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["card"]["stage"] == "received" and d["referral"]["receipt"] == {
        "complete": False, "missing": ["records"], "note": d["referral"]["receipt"]["note"]}
    ev = d["referral"]["events"][-1]
    assert ev["source"] == "ai_call" and ev["by"] == "Casey Reed" and ev["call_duration"] == "1 min 32 s"
    assert "Scheduling phone 413-555-0142" in ev["note"]
    tl = [i for i in d["timeline"] if i["kind"] == "event"][-1]
    assert tl["by"] == "Casey Reed" and tl["call_duration"] == "1 min 32 s"
    assert d["call"]["status"] == "applied" and d["call"]["applied_by"] == "Casey Reed"
    assert sample.post(f"/api/referrals/R-102/calls/{call['id']}/apply").status_code == 409


def test_edit_then_save_marks_the_call_used(sample):
    call = place(sample, "R-102")
    poll(call, conv("done", turns_from("sample_call_transcript.txt"), secs=40))
    r = sample.post("/api/referrals/R-102/updates", json={
        "action": "received", "source": "phone", "note": "Records sent separately", "call_id": call["id"]})
    assert r.status_code == 200, r.text
    ev = r.json()["referral"]["events"][-1]
    assert ev["source"] == "ai_call" and ev["call_duration"] == "40 s" and ev["by"] == "Casey Reed"
    assert get_repo().call(call["id"])["status"] == "applied"


def test_clinicians_cannot_call_or_apply(sample, clinician):
    call = place(sample, "R-102")
    poll(call, conv("done", turns_from("sample_call_transcript.txt")))
    assert clinician.post("/api/referrals/R-102/call-office").status_code == 403
    assert clinician.post(f"/api/referrals/R-102/calls/{call['id']}/apply").status_code == 403
    assert clinician.get("/api/referrals/R-102/calls").status_code == 200  # read-only is fine


# ---------------------------------------------------------------- secrets

def test_key_never_in_responses_or_logs(sample, caplog):
    caplog.set_level(logging.DEBUG)
    call = place(sample, "R-102")
    poll(call, conv("done", turns_from("sample_call_transcript.txt")))
    texts = [
        sample.get("/api/referrals/R-102/calls").text,
        sample.get("/api/dashboard").text,
        sample.get("/api/config").text,
        sample.post(f"/api/referrals/R-102/calls/{call['id']}/apply").text,
        sample.get("/api/referrals/R-102").text,
    ]
    for t in texts:
        assert KEY not in t and TEST_NUMBER not in t
    assert KEY not in caplog.text
    assert any("conv_1" in m for m in caplog.messages)  # logging works; it just never has the key


def test_dashboard_rows_show_the_call(sample):
    call = place(sample, "R-102")
    row = next(x for x in sample.get("/api/dashboard").json()["needs_attention"] if x["referral_id"] == "R-102")
    assert row["card"]["call"]["status"] == "calling" and row["card"]["call"]["practice"]
    poll(call, conv("done", turns_from("sample_call_transcript.txt")))
    row = next(x for x in sample.get("/api/dashboard").json()["needs_attention"] if x["referral_id"] == "R-102")
    assert row["card"]["call"]["status"] == "ready_for_review"
