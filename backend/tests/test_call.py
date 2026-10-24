"""AI call assistant: session gating, transcript cleaning, extraction validation, proposed stage.
The LLM is mocked so these run offline; the deterministic fallback is tested on the same fixture."""
from __future__ import annotations

import httpx
import pytest

from app.call import transcript as tr
from app.config import ROOT

FIXTURE = ROOT / "docs" / "sample_call_transcript.txt"
EXPECTED = {
    "received": "yes",
    "missing_items": ["records"],
    "patient_contacted": "no",
    "scheduling_phone": "413-555-0142",
    "scheduling_hours": "Monday through Friday 8:00 to 4:00",
}


def fixture_turns() -> list[dict]:
    turns = []
    for line in FIXTURE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        role, msg = line.split(":", 1)
        turns.append({"role": role.strip(), "message": msg.strip()})
    return turns


@pytest.fixture()
def sample(client):
    client.post("/api/sample-data")
    return client


@pytest.fixture()
def mock_llm(monkeypatch):
    calls = {}

    def set_reply(reply):
        def fake(text):
            calls["text"] = text
            return reply
        monkeypatch.setattr(tr, "llm_extract", fake)
        return calls
    return set_reply


# ---------------------------------------------------------------- transcript processing

def test_voice_tags_stripped():
    assert tr.strip_tags("[happy] Great, thank you. [slow] Could you") == "Great, thank you. Could you"
    assert "[" not in tr.as_text(tr.clean_turns(fixture_turns()))


def test_spoken_and_written_phone_are_the_same_number():
    spoken = "The scheduling phone number is four one three, five five five, zero one four two."
    written = "413-555-0142."
    assert "4135550142" in tr.digit_runs(spoken)
    assert "4135550142" in tr.digit_runs(written)


def test_fixture_with_mocked_llm(sample, mock_llm):
    calls = mock_llm({**EXPECTED, "note": "Records still needed."})
    r = sample.post("/api/referrals/R-102/call-transcript", json={"conversation_id": "c1", "turns": fixture_turns()})
    assert r.status_code == 200, r.text
    out = r.json()
    for k, v in EXPECTED.items():
        assert out[k] == v, k
    assert out["proposed_stage"] == "Received-incomplete"
    assert out["validation_errors"] == []
    assert out["applied"] is False and out["extractor"] == "llm"
    assert "[happy]" not in calls["text"] and "[slow]" not in calls["text"]
    # nothing was saved
    assert sample.get("/api/referrals/R-102").json()["referral"]["receipt"]["complete"] is True


def test_fixture_with_rules_fallback(sample, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    out = sample.post("/api/referrals/R-102/call-transcript", json={"turns": fixture_turns()}).json()
    assert out["extractor"] == "rules"
    for k, v in EXPECTED.items():
        assert out[k] == v, k
    assert out["proposed_stage"] == "Received-incomplete" and out["validation_errors"] == []


def test_phone_not_in_transcript_is_nulled(sample, mock_llm):
    mock_llm({**EXPECTED, "scheduling_phone": "617-555-0199"})
    out = sample.post("/api/referrals/R-102/call-transcript", json={"turns": fixture_turns()}).json()
    assert out["scheduling_phone"] is None
    assert any("617-555-0199" in e and "does not appear" in e for e in out["validation_errors"])


def test_hours_not_in_transcript_are_nulled(sample, mock_llm):
    mock_llm({**EXPECTED, "scheduling_hours": "Monday through Saturday 7:00 to 6:00"})
    out = sample.post("/api/referrals/R-102/call-transcript", json={"turns": fixture_turns()}).json()
    assert out["scheduling_hours"] is None and out["validation_errors"]


def test_disallowed_transition_is_rejected(sample, mock_llm):
    # R-101 is at Sent: Sent → Patient contacted skips Received, so it is not allowed.
    mock_llm({**EXPECTED, "patient_contacted": "yes"})
    out = sample.post("/api/referrals/R-101/call-transcript", json={"turns": fixture_turns()}).json()
    assert out["proposed_stage"] is None
    assert any("not an allowed next step" in e for e in out["validation_errors"])


def test_empty_transcript_is_400(sample):
    assert sample.post("/api/referrals/R-102/call-transcript", json={"turns": []}).status_code == 400
    r = sample.post("/api/referrals/R-102/call-transcript",
                    json={"turns": [{"role": "agent", "message": "[happy] [slow]"}]})
    assert r.status_code == 400


def test_bad_values_are_nulled(sample, mock_llm):
    mock_llm({"received": "maybe", "missing_items": ["cookies", "test_results"], "patient_contacted": "no",
              "scheduling_phone": "12", "scheduling_hours": None, "note": ""})
    out = sample.post("/api/referrals/R-102/call-transcript", json={"turns": fixture_turns()}).json()
    assert out["received"] == "unknown" and out["missing_items"] == [] and out["scheduling_phone"] is None
    assert len(out["validation_errors"]) == 4


# ---------------------------------------------------------------- session

def test_session_needs_env(sample, monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "")
    assert sample.post("/api/referrals/R-102/call-session").status_code == 503
    assert sample.get("/api/config").json() == {"voice_enabled": False}


def test_session_gating_and_variables(sample, monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_123")
    seen = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        seen.update(url=url, params=params, headers=headers)
        return httpx.Response(200, json={"token": "tok_abc"})
    monkeypatch.setattr("app.api.call.httpx.get", fake_get)

    r = sample.post("/api/referrals/R-102/call-session")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["conversation_token"] == "tok_abc"
    assert body["dynamic_variables"] == {
        "referral_id": "R-102", "specialty": "Cardiology", "requesting_practice": "Quabbin Hills Family Medicine",
        "sent_date": "October 6, 2026", "patient_initials": "L. W.",
    }
    assert seen["params"] == {"agent_id": "agent_123"} and seen["headers"] == {"xi-api-key": "test-key"}
    assert "test-key" not in r.text
    assert sample.get("/api/config").json() == {"voice_enabled": True}
    # Not stuck at Sent or Received → 403
    for rid in ("R-104", "R-103", "R-106"):
        assert sample.post(f"/api/referrals/{rid}/call-session").status_code == 403
