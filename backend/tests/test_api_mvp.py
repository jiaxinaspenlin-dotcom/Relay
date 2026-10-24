"""API-level checks for the five MVP acceptance tests (tasks.md M1–M5)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

LIVE = "46ee9d82-b52c-856d-069b-5064ff052225"  # North Adams, Medicare (synthetic)


@pytest.fixture()
def client():
    c = TestClient(app)
    assert c.post("/api/reset").status_code == 200
    yield c
    c.post("/api/reset")


def _new_cardiology_referral(c) -> dict:
    f = c.get("/api/finder", params={"specialty": "Cardiology", "patient_id": LIVE}).json()
    practice = f["results"][0]
    conds = c.get(f"/api/patients/{LIVE}/conditions").json()["conditions"]
    code = next(x["code"] for x in conds if x["code"] == "274531002")
    r = c.post("/api/referrals", json={
        "patient_id": LIVE, "specialty": "Cardiology", "practice_id": practice["id"],
        "reason_text": "Abnormal cardiac imaging; please evaluate (synthetic).",
        "priority": "routine", "condition_code": code})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- M1

def test_m1_dashboard(client):
    d = client.get("/api/dashboard").json()
    msgs = {row["referral_id"]: [f["message"] for f in row["flags"]] for row in d["needs_attention"]}
    assert "Accepted 14 days ago — no appointment yet" in msgs["R-102"]
    assert "Seen 12 days ago — plan not received" in msgs["R-104"]
    assert {c["stage"] for c in d["pipeline"]} >= {"sent", "accepted", "scheduled", "seen",
                                                   "plan_returned", "declined", "patient_barrier"}
    s = d["summary"]
    assert (s["open"], s["stuck"], s["closed_this_month"]) == (7, 5, 1) and s["synthetic"]


# ---------------------------------------------------------------- M2

def test_m2_finder_and_send(client):
    pts = client.get("/api/patients").json()["patients"]
    assert pts[0]["id"] == LIVE and pts[0]["live_demo"] and pts[0]["town"] == "North Adams"
    f = client.get("/api/finder", params={"specialty": "Cardiology", "patient_id": LIVE}).json()
    first = f["results"][0]
    assert first["miles"] is not None and first["medicare_label"].startswith(("Accepts", "May accept"))
    assert first["nearest_hospital"]["beds_label"] == "med/surg + ICU + pediatric beds"
    assert f["medicare_prominent"] is True
    detail = _new_cardiology_referral(client)
    rid = detail["card"]["id"]
    assert rid == "R-109" and detail["card"]["stage"] == "sent"
    assert detail["referral"]["performer"]["fictional"] is False
    sent_col = next(c for c in client.get("/api/dashboard").json()["pipeline"] if c["stage"] == "sent")
    assert rid in sent_col["referral_ids"]


def test_m2_rejects_unknown_practice_and_condition(client):
    base = {"patient_id": LIVE, "specialty": "Cardiology", "reason_text": "x", "priority": "routine"}
    assert client.post("/api/referrals", json={**base, "practice_id": "p-nope",
                                               "condition_code": "274531002"}).status_code == 422
    f = client.get("/api/finder", params={"specialty": "Cardiology", "patient_id": LIVE}).json()
    assert client.post("/api/referrals", json={**base, "practice_id": f["results"][0]["id"],
                                               "condition_code": "000"}).status_code == 422


# ---------------------------------------------------------------- M3

def test_m3_log_update_and_demo_clock(client):
    rid = _new_cardiology_referral(client)["card"]["id"]
    r = client.post(f"/api/referrals/{rid}/updates", json={"action": "accepted", "source": "phone",
                                                          "note": "Office called back"})
    assert r.status_code == 200, r.text
    ev = r.json()["referral"]["events"][-1]
    assert (ev["stage"], ev["source"], ev["at"]) == ("accepted", "phone", "2026-10-24")
    assert client.post("/api/clock", json={"advance_days": 7}).json()["today"] == "2026-10-31"
    rows = {row["referral_id"]: row for row in client.get("/api/dashboard").json()["needs_attention"]}
    assert rows[rid]["flags"][0]["message"] == "Accepted 7 days ago — no appointment yet"
    assert client.post("/api/clock", json={"reset": True}).json()["today"] == "2026-10-24"


def test_m3_clock_controls(client):
    assert client.post("/api/clock", json={"advance_days": 1}).json()["offset_days"] == 1
    assert client.post("/api/clock", json={"advance_days": 3}).status_code == 422
    assert client.get("/api/health").json()["today"] == "2026-10-25"


def test_m3_invalid_update_is_409(client):
    r = client.post("/api/referrals/R-101/updates", json={"action": "seen", "source": "fax"})
    assert r.status_code == 409 and "not allowed" in r.json()["detail"]
    r = client.post("/api/referrals/R-102/updates", json={"action": "scheduled", "source": "portal"})
    assert r.status_code == 409 and "appointment date" in r.json()["detail"]


def test_m3_scheduled_with_date(client):
    r = client.post("/api/referrals/R-102/updates", json={
        "action": "scheduled", "source": "portal", "appointment_date": "2026-11-12"})
    assert r.json()["referral"]["appointment"] == {"start": "2026-11-12", "status": "booked"}
    assert "R-102" not in {x["referral_id"] for x in client.get("/api/dashboard").json()["needs_attention"]
                           if any(f["rule"] == "accepted_no_appointment" for f in x["flags"])}


# ---------------------------------------------------------------- M4

def test_m4_draft_edit_send(client):
    d = client.get("/api/referrals/R-102/draft").json()
    assert d["rule"] == "accepted_no_appointment" and d["recipient"] == "specialist"
    assert d["verified"] is True, d["problems"]
    assert "[F" in d["text"] and "Lajuana164 Wilkinson796 (synthetic)" in d["text"]
    edited = d["text"] + "\nThanks for your help."
    r = client.post("/api/referrals/R-102/communications", json={
        "recipient": d["recipient"], "text": edited, "rule": d["rule"], "drafted_text": d["text"]})
    assert r.status_code == 201
    comms = [t for t in r.json()["timeline"] if t["kind"] == "communication"]
    assert len(comms) == 1 and comms[0]["edited"] is True and comms[0]["at"] == "2026-10-24"


def test_m4_not_stuck_is_409(client):
    assert client.get("/api/referrals/R-103/draft").status_code == 409


# ---------------------------------------------------------------- M5

PLAN = {"assessment": "Findings reviewed at visit (synthetic).",
        "plan": "Echo in 6 weeks, ordered by cardiology (synthetic).",
        "actions_for_pcp": "Update problem list (synthetic).", "questions_contact": "Office line"}


def test_m5_plan_inbox_close_fhir(client):
    r = client.post("/api/referrals/R-104/updates", json={"action": "plan_received", "source": "fax",
                                                         "plan": PLAN})
    assert r.status_code == 200, r.text
    assert r.json()["referral"]["plan"]["returned_on"] == "2026-10-24"
    items = {i["card"]["id"]: i for i in client.get("/api/inbox").json()["items"]}
    assert items["R-104"]["reason_text"].startswith("Please evaluate")
    assert items["R-104"]["plan"]["plan"] == PLAN["plan"]
    assert items["R-104"]["plan"]["from"] == "Pioneer Valley Heart Associates (fictional)"
    c = client.post("/api/referrals/R-104/close", json={"note": "Reviewed"})
    assert c.status_code == 200 and c.json()["referral"]["closure"]["reason"] == "plan_received"
    assert "R-104" not in {i["card"]["id"] for i in client.get("/api/inbox").json()["items"]}
    assert client.get("/api/dashboard").json()["summary"]["closed_this_month"] == 2
    fh = client.get("/api/referrals/R-104/fhir")
    assert fh.status_code == 200 and fh.json()["resourceType"] == "Bundle"
    assert "attachment" in fh.headers.get("content-disposition", "")


def test_m5_plan_requires_form_and_close_requires_plan(client):
    assert client.post("/api/referrals/R-104/updates",
                       json={"action": "plan_received", "source": "fax"}).status_code == 422
    assert client.post("/api/referrals/R-104/close", json={}).status_code == 409
