"""API-level checks for the five acceptance tests, in real mode (SQLite, real clock), plus the
persistence, sample-data, office-link, and send behaviors they rely on."""
from __future__ import annotations

from datetime import date, timedelta

from app.db import Repo
from app.store import set_repo

from conftest import TODAY

PLAN = {"assessment": "Findings reviewed at visit.", "plan": "Echo in 6 weeks, ordered by cardiology.",
        "actions_for_pcp": "Update problem list.", "questions_contact": "Office line"}


def _add_patient(c, **kw) -> dict:
    body = {"name": "Maria Santos", "town": "Athol", "coverage": "medicare", "dob": "1951-03-02", **kw}
    r = c.post("/api/patients", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _create_and_send(c, pid: str, channel: str = "copy") -> tuple[str, str]:
    f = c.get("/api/finder", params={"specialty": "Cardiology", "patient_id": pid}).json()
    r = c.post("/api/referrals", json={
        "patient_id": pid, "specialty": "Cardiology", "practice_id": f["results"][0]["id"],
        "reason_text": "New exertional chest discomfort; please evaluate.", "priority": "routine",
        "condition_text": "Chest pain on exertion"})
    assert r.status_code == 201, r.text
    d = r.json()
    rid = d["card"]["id"]
    assert d["card"]["stage"] == "draft"
    s = c.post(f"/api/referrals/{rid}/send", json={"channel": channel})
    assert s.status_code == 200, s.text
    return rid, d["office_path"].rsplit("/", 1)[1]


# ---------------------------------------------------------------- empty start + persistence

def test_starts_empty(client):
    d = client.get("/api/dashboard").json()
    assert d["total"] == 0 and d["needs_attention"] == [] and d["has_sample"] is False
    assert client.get("/api/patients").json()["patients"] == []
    s = client.get("/api/settings").json()
    assert s["clock"]["demo_mode"] is False and s["clock"]["today"] == TODAY.isoformat()


def test_data_persists_in_sqlite_file(tmp_path, real_today):
    db = tmp_path / "relay.db"
    set_repo(Repo(db))
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    p = _add_patient(c)
    rid, _ = _create_and_send(c, p["id"])
    set_repo(Repo(db))  # simulate a restart
    d = c.get(f"/api/referrals/{rid}").json()
    assert d["card"]["stage"] == "sent" and d["card"]["patient"]["name"] == "Maria Santos"
    set_repo(None)


# ---------------------------------------------------------------- M1: dashboard (sample data)

def test_m1_dashboard_with_sample(client):
    assert client.post("/api/sample-data").status_code == 200
    assert client.post("/api/sample-data").status_code == 409  # only once
    d = client.get("/api/dashboard").json()
    msgs = {row["referral_id"]: [f["message"] for f in row["flags"]] for row in d["needs_attention"]}
    assert "Accepted 14 days ago — no appointment yet" in msgs["R-102"]
    assert "Seen 12 days ago — plan not received" in msgs["R-104"]
    s = d["summary"]
    assert (s["open"], s["stuck"], s["closed_this_month"]) == (7, 5, 1)
    assert all(row["card"]["sample"] for row in d["needs_attention"])


def test_sample_dates_shift_to_today(client, real_today):
    later = TODAY + timedelta(days=40)
    real_today(later)
    client.post("/api/sample-data")
    d = client.get("/api/dashboard").json()
    msgs = {row["referral_id"]: [f["message"] for f in row["flags"]] for row in d["needs_attention"]}
    assert "Accepted 14 days ago — no appointment yet" in msgs["R-102"]
    ev = client.get("/api/referrals/R-102").json()["referral"]["events"][-1]
    assert ev["at"] == (date(2026, 10, 10) + timedelta(days=40)).isoformat()


def test_no_synthetic_suffix_in_generated_text(client):
    client.post("/api/sample-data")
    d = client.get("/api/referrals/R-102/draft").json()
    assert "(synthetic" not in d["text"]
    assert "Lajuana Wilkinson" in d["text"]


# ---------------------------------------------------------------- M2: add patient → referral → send

def test_m2_add_patient_referral_send(client):
    assert client.post("/api/patients", json={"name": "X", "town": "Atlantis"}).status_code == 422
    p = _add_patient(client)
    assert (p["town"], p["county"], p["coverage_label"], p["sample"]) == ("Athol", "Worcester", "Medicare", False)
    f = client.get("/api/finder", params={"specialty": "Cardiology", "patient_id": p["id"]}).json()
    assert f["medicare_prominent"] is True and len(f["results"]) == 10 and f["has_more"]
    rid, token = _create_and_send(client, p["id"], channel="email")
    d = client.get(f"/api/referrals/{rid}").json()
    assert d["card"]["stage"] == "sent" and d["card"]["sample"] is False
    comm = d["referral"]["communications"][0]
    assert (comm["kind"], comm["channel"], comm["recipient"]) == ("referral", "email", "specialist")
    assert f"/office/{token}" in comm["text"] and "Maria Santos" in comm["text"]
    sent = next(c for c in client.get("/api/dashboard").json()["pipeline"] if c["stage"] == "sent")
    assert rid in sent["referral_ids"]
    # resend records another Communication but stays Sent
    client.post(f"/api/referrals/{rid}/send", json={"channel": "print"})
    d = client.get(f"/api/referrals/{rid}").json()
    assert d["card"]["stage"] == "sent" and len(d["referral"]["communications"]) == 2
    assert len(token) >= 32


def test_referral_needs_condition(client):
    p = _add_patient(client)
    f = client.get("/api/finder", params={"specialty": "Cardiology", "patient_id": p["id"]}).json()
    r = client.post("/api/referrals", json={"patient_id": p["id"], "specialty": "Cardiology",
                                           "practice_id": f["results"][0]["id"], "reason_text": "x",
                                           "priority": "routine"})
    assert r.status_code == 422


# ---------------------------------------------------------------- M3: office link → demo +7 → stuck

def test_m3_office_accepts_then_demo_clock(client):
    p = _add_patient(client)
    rid, token = _create_and_send(client, p["id"])
    o = client.get(f"/api/office/{token}").json()
    assert o["referral_id"] == rid and "accepted" in o["actions"] and o["patient"]["name"] == "Maria Santos"
    assert client.post(f"/api/office/{token}", json={"action": "accepted"}).status_code == 200
    ev = client.get(f"/api/referrals/{rid}").json()["referral"]["events"][-1]
    assert (ev["stage"], ev["actor"], ev["source"]) == ("accepted", "office", "link")
    # Clock only moves in Demo mode
    assert client.post("/api/clock", json={"advance_days": 7}).status_code == 409
    client.post("/api/settings", json={"demo_mode": True})
    assert client.post("/api/clock", json={"advance_days": 7}).json()["today"] == "2026-10-31"
    rows = {r["referral_id"]: r for r in client.get("/api/dashboard").json()["needs_attention"]}
    assert rows[rid]["flags"][0]["message"] == "Accepted 7 days ago — no appointment yet"
    client.post("/api/settings", json={"demo_mode": False})
    assert client.get("/api/clock").json()["today"] == TODAY.isoformat()


def test_office_link_rules(client):
    assert client.get("/api/office/not-a-real-token").status_code == 404
    p = _add_patient(client)
    rid, token = _create_and_send(client, p["id"])
    assert client.post(f"/api/office/{token}", json={"action": "seen"}).status_code == 409
    assert client.post(f"/api/office/{token}", json={"action": "declined"}).status_code == 422  # reason
    client.post(f"/api/office/{token}", json={"action": "accepted"})
    assert client.post(f"/api/office/{token}", json={"action": "scheduled",
                                                    "appointment_date": "2026-11-12"}).status_code == 422
    r = client.post(f"/api/office/{token}", json={"action": "scheduled", "appointment_date": "2026-11-12",
                                                 "appointment_time": "09:30"})
    assert r.json()["appointment"] == {"start": "2026-11-12", "time": "09:30", "status": "booked"}


def test_sample_referrals_have_working_office_links(client):
    client.post("/api/sample-data")
    path = client.get("/api/referrals/R-102").json()["office_path"]
    o = client.get(f"/api{path}").json()
    assert o["referral_id"] == "R-102" and o["sample"] is True and "scheduled" in o["actions"]


def test_coordinator_log_update_still_works(client):
    p = _add_patient(client)
    rid, _ = _create_and_send(client, p["id"])
    r = client.post(f"/api/referrals/{rid}/updates", json={"action": "accepted", "source": "phone"})
    assert r.json()["referral"]["events"][-1]["source"] == "phone"


# ---------------------------------------------------------------- M4: follow-up

def test_m4_follow_up(client):
    p = _add_patient(client)
    rid, token = _create_and_send(client, p["id"])
    client.post(f"/api/office/{token}", json={"action": "accepted"})
    client.post("/api/settings", json={"demo_mode": True})
    client.post("/api/clock", json={"advance_days": 7})
    d = client.get(f"/api/referrals/{rid}/draft").json()
    assert d["verified"], d["problems"]
    assert d["rule"] == "accepted_no_appointment" and "[F" in d["text"] and f"/office/{token}" in d["text"]
    edited = d["text"] + "\nThank you."
    r = client.post(f"/api/referrals/{rid}/communications", json={
        "recipient": d["recipient"], "text": edited, "rule": d["rule"], "drafted_text": d["text"],
        "channel": "email"})
    comms = [t for t in r.json()["timeline"] if t["kind"] == "communication"]
    assert comms[-1]["edited"] is True and comms[-1]["channel"] == "email"


# ---------------------------------------------------------------- M5: plan via link → close → FHIR

def test_m5_plan_via_link_close_fhir(client):
    p = _add_patient(client)
    rid, token = _create_and_send(client, p["id"])
    for body in ({"action": "accepted"},
                 {"action": "scheduled", "appointment_date": "2026-11-03", "appointment_time": "10:15"},
                 {"action": "seen"},
                 {"action": "plan_returned", "plan": PLAN}):
        r = client.post(f"/api/office/{token}", json=body)
        assert r.status_code == 200, (body, r.text)
    assert r.json()["actions"] == []
    items = {i["card"]["id"]: i for i in client.get("/api/inbox").json()["items"]}
    assert items[rid]["reason_text"].startswith("New exertional") and items[rid]["plan"]["plan"] == PLAN["plan"]
    assert client.post(f"/api/referrals/{rid}/close", json={"note": "Reviewed"}).status_code == 200
    fh = client.get(f"/api/referrals/{rid}/fhir")
    assert fh.status_code == 200 and fh.json()["resourceType"] == "Bundle"
