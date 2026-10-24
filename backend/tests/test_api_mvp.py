"""API-level versions of the five acceptance tests (D1–D5), starting from an empty app in real
mode, plus persistence, sample data, office link, and Massachusetts-specific behavior."""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import Repo
from app.store import set_repo

from conftest import TODAY

PLAN = {"assessment": "Exertional symptoms reviewed.", "plan": "Stress echo in 2 weeks, ordered by cardiology.",
        "actions_for_pcp": "Update problem list.", "questions_contact": "Office line"}


def _add_patient(c, **kw) -> dict:
    body = {"name": "Maria Santos", "town": "Orange", "coverage": "dual", "dob": "1951-03-02", **kw}
    r = c.post("/api/patients", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _create_and_send(c, pid: str, channel: str = "copy") -> tuple[str, str]:
    f = c.get("/api/finder", params={"specialty": "Cardiology", "patient_id": pid}).json()
    practice = next(p for p in f["results"] if p["phone"])
    r = c.post("/api/referrals", json={
        "patient_id": pid, "specialty": "Cardiology", "practice_id": practice["id"],
        "reason_text": "New exertional chest discomfort; please evaluate.", "priority": "routine",
        "condition_text": "Chest pain on exertion"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["card"]["stage"] == "draft"
    s = c.post(f"/api/referrals/{d['card']['id']}/send", json={"channel": channel})
    assert s.status_code == 200, s.text
    return d["card"]["id"], d["office_path"].rsplit("/", 1)[1]


def _office(c, token, **body):
    r = c.post(f"/api/office/{token}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _later(set_today, days):
    """Move the injected test clock forward."""
    set_today(TODAY + timedelta(days=days))


def _row(c, rid):
    return next((r for r in c.get("/api/dashboard").json()["needs_attention"] if r["referral_id"] == rid), None)


# ---------------------------------------------------------------- empty start + persistence

def test_starts_empty(client):
    d = client.get("/api/dashboard").json()
    assert d["total"] == 0 and d["needs_attention"] == []
    s = client.get("/api/settings").json()
    assert s["today"] == TODAY.isoformat() and s["has_sample"] is False


def test_data_persists_in_sqlite_file(tmp_path, real_today):
    from conftest import COORD, signed_in
    db = tmp_path / "relay.db"
    r = Repo(db)
    r.users.create(name=COORD["name"], email=COORD["email"], role="coordinator", practice="P", password=COORD["password"])
    set_repo(r)
    c = signed_in(COORD)
    rid, _ = _create_and_send(c, _add_patient(c)["id"])
    set_repo(Repo(db))  # restart
    assert c.get(f"/api/referrals/{rid}").json()["card"]["stage"] == "sent"
    set_repo(None)


def test_sample_data_load_and_remove(client):
    rid, _ = _create_and_send(client, _add_patient(client)["id"])  # a real referral survives removal
    assert client.post("/api/sample-data").status_code == 200
    assert client.post("/api/sample-data").status_code == 409
    d = client.get("/api/dashboard").json()
    lost = {r["referral_id"]: [f["status"] for f in r["flags"]] for r in d["needs_attention"] if r["failure"]}
    sample_ids = {r: k for r, k in ((c["id"], c["patient"]["name"]) for col in d["pipeline"] for c in col["cards"])}
    assert any("Not scheduled, 14 days" in v for v in lost.values())
    assert any("No plan back, 12 days" in v for v in lost.values())
    assert d["summary"]["lost"] == 2 and len(sample_ids) > 1
    r = client.delete("/api/sample-data").json()
    assert r["removed"] == 9 and r["has_sample"] is False
    d = client.get("/api/dashboard").json()
    assert d["total"] == 1 and d["pipeline"][1]["referral_ids"] == [rid]
    assert all(not p["sample"] for p in client.get("/api/patients").json()["patients"])


@pytest.mark.parametrize("days_later", [0, 1, 40, 365])
def test_sample_dates_are_relative_to_load_time(client, real_today, days_later):
    """Whenever the app runs, the sample reads the same: 14 days not scheduled, 12 days no plan."""
    real_today(TODAY + timedelta(days=days_later))
    client.post("/api/sample-data")
    assert "Not scheduled, 14 days" in [f["status"] for f in _row(client, "R-102")["flags"]]
    assert "No plan back, 12 days" in [f["status"] for f in _row(client, "R-104")["flags"]]
    ev = client.get("/api/referrals/R-102").json()["referral"]["events"]
    assert ev[-1]["at"] == (TODAY + timedelta(days=days_later - 14)).isoformat()


def test_no_synthetic_suffix_and_sample_tag(client):
    client.post("/api/sample-data")
    d = client.get("/api/referrals/R-102/draft").json()
    assert "(synthetic" not in d["text"] and "Lajuana Wilkinson" in d["text"]
    assert client.get("/api/referrals/R-102").json()["card"]["sample"] is True


# ---------------------------------------------------------------- D1: coordinator enters a real referral

def test_d1_enter_referral(client):
    p = _add_patient(client)
    assert (p["town"], p["county"], p["coverage_label"], p["masshealth"], p["medicare"]) == (
        "Orange", "Franklin", "Dual eligible (Medicare + MassHealth)", True, True)
    f = client.get("/api/finder", params={"specialty": "Cardiology", "patient_id": p["id"]}).json()
    assert f["medicare_prominent"] and len(f["results"]) == 10 and f["has_more"]
    first = f["results"][0]
    assert first["miles"] is not None and first["nearest_hospital"]["beds_label"]
    rid, _ = _create_and_send(client, p["id"])
    open_ids = {i for c in client.get("/api/dashboard").json()["pipeline"] for i in c["referral_ids"]}
    assert rid in open_ids


# ---------------------------------------------------------------- D2: may not have arrived → missing

def test_d2_not_confirmed_received_then_missing(client, real_today):
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    assert _row(client, rid) is None
    _later(real_today, 3)  # Sat 10-24 → Tue 10-27: 2 business days
    row = _row(client, rid)
    assert row and row["flags"][0]["status"].startswith("Not confirmed received")
    assert row["card"]["can_call"] is True
    v = _office(client, token, action="missing", missing=["records"], note="Last two office notes")
    assert v["status_label"] == "Missing records"
    assert client.get(f"/api/referrals/{rid}").json()["card"]["status_label"] == "Missing records"


# ---------------------------------------------------------------- D3: patient next step + PT-1

def test_d3_patient_message_and_pt1(client):
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    assert client.get(f"/api/referrals/{rid}/patient-message").status_code == 409
    _office(client, token, action="received")
    m = client.get(f"/api/referrals/{rid}/patient-message").json()
    ref = client.get(f"/api/referrals/{rid}").json()["referral"]
    assert m["phone"] == ref["performer"]["phone"] and m["phone"] in m["text"]
    assert f"Your referral to {ref['performer']['name']} was received. Please call {m['phone']} to schedule." in m["text"]
    r = client.post(f"/api/referrals/{rid}/communications", json={
        "recipient": "patient", "text": m["text"], "kind": "patient_message", "channel": "print",
        "drafted_text": m["text"]})
    assert r.json()["timeline"][-1]["message_kind"] == "patient_message"
    d = client.get(f"/api/referrals/{rid}").json()
    assert d["transport"]["show_pt1"] is False
    client.post(f"/api/referrals/{rid}/barriers", json={"type": "transportation", "note": "No car"})
    d = client.get(f"/api/referrals/{rid}").json()
    assert d["transport"]["show_pt1"] is True and d["transport"]["pt1_url"].startswith("https://www.mass.gov/")
    d = client.post(f"/api/referrals/{rid}/transport", json={"pt1_status": "requested"}).json()
    assert d["transport"]["pt1_status"] == "requested"


def test_non_masshealth_gets_transport_plan_note(client):
    rid, _ = _create_and_send(client, _add_patient(client, coverage="commercial_ppo")["id"])
    client.post(f"/api/referrals/{rid}/barriers", json={"type": "transportation", "note": "No car"})
    t = client.get(f"/api/referrals/{rid}").json()["transport"]
    assert (t["show_pt1"], t["show_plan_note"]) == (False, True)


def test_phone_entered_when_directory_has_none(client):
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    _office(client, token, action="received")
    d = client.post(f"/api/referrals/{rid}/office-phone", json={"phone": "978-555-0100"}).json()
    assert d["referral"]["performer"]["phone"] == "978-555-0100"


# ---------------------------------------------------------------- D4: lost in the handoff

def test_d4_not_scheduled_then_contacted_scheduled_seen(client, real_today):
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    _office(client, token, action="received")
    _later(real_today, 7)
    row = _row(client, rid)
    assert row["failure"] and row["flags"][0]["status"] == "Not scheduled, 7 days"
    _office(client, token, action="patient_contacted", contact_mode="office_called")
    _office(client, token, action="scheduled", appointment_date="2026-12-01", appointment_time="10:15")
    v = _office(client, token, action="seen")
    assert v["stage"] == "seen" and "plan_returned" in v["actions"]
    ev = client.get(f"/api/referrals/{rid}").json()["referral"]["events"]
    assert all(e["actor"] == "office" and e["source"] == "link" for e in ev[1:])


# ---------------------------------------------------------------- D5: plan back, loop closes

def test_d5_plan_back_close_fhir(client, clinician):
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    for body in ({"action": "received"}, {"action": "patient_contacted", "contact_mode": "patient_told_to_call"},
                 {"action": "scheduled", "appointment_date": "2026-11-03", "appointment_time": "10:15"},
                 {"action": "seen"}, {"action": "plan_returned", "plan": PLAN}):
        v = _office(client, token, **body)
    assert v["actions"] == []
    before = client.get("/api/dashboard").json()["summary"]
    items = {i["card"]["id"]: i for i in client.get("/api/inbox").json()["items"]}
    assert items[rid]["plan"]["plan"] == PLAN["plan"] and items[rid]["reason_text"].startswith("New exertional")
    assert before["unread_plans"] == 1
    assert client.post(f"/api/referrals/{rid}/close", json={"note": "Reviewed"}).status_code == 403  # coordinator
    assert clinician.post(f"/api/referrals/{rid}/close", json={"note": "Reviewed"}).status_code == 200
    closed = client.get(f"/api/referrals/{rid}").json()["referral"]
    assert closed["closure"]["by"] == "Dr. Jo Park" and closed["events"][-1]["by"] == "Dr. Jo Park"
    after = client.get("/api/dashboard").json()["summary"]
    assert (after["closed_this_month"], after["unread_plans"], after["open"]) == (
        before["closed_this_month"] + 1, 0, before["open"] - 1)
    assert client.get(f"/api/referrals/{rid}/fhir").json()["resourceType"] == "Bundle"


# ---------------------------------------------------------------- office link and Log update rules

def test_office_link_rules(client):
    assert client.get("/api/office/not-a-real-token").status_code == 404
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    assert client.post(f"/api/office/{token}", json={"action": "seen"}).status_code == 409
    assert client.post(f"/api/office/{token}", json={"action": "declined"}).status_code == 422
    assert client.post(f"/api/office/{token}", json={"action": "missing"}).status_code == 422
    v = _office(client, token, action="authorization", authorization="pending")
    assert v["authorization"] == "pending" and v["stage"] == "sent"
    _office(client, token, action="received")
    assert client.post(f"/api/office/{token}", json={"action": "scheduled",
                                                    "appointment_date": "2026-11-12"}).status_code == 422


def test_log_update_sources(client):
    rid, _ = _create_and_send(client, _add_patient(client)["id"])
    r = client.post(f"/api/referrals/{rid}/updates", json={"action": "received", "source": "fax"})
    assert r.json()["referral"]["events"][-1]["source"] == "fax"
    r = client.post(f"/api/referrals/{rid}/updates", json={"action": "patient_contacted", "source": "ai_call",
                                                          "contact_mode": "office_called"})
    assert r.json()["referral"]["events"][-1]["source"] == "ai_call"
    assert client.post(f"/api/referrals/{rid}/updates", json={"action": "seen", "source": "link"}).status_code == 422


def test_referral_hint_by_insurance(client):
    hints = {}
    for cov in ("original_medicare", "masshealth_pcc", "masshealth_pcaco", "commercial_hmo", "dual"):
        rid, _ = _create_and_send(client, _add_patient(client, coverage=cov)["id"])
        hints[cov] = client.get(f"/api/referrals/{rid}").json()["hint"]
    assert hints["original_medicare"].startswith("Original Medicare generally doesn't require")
    assert "130 CMR 450.118(J)" in hints["masshealth_pcc"] and hints["masshealth_pcc"] == hints["masshealth_pcaco"]
    assert hints["commercial_hmo"] == hints["dual"] == "Referral and authorization rules depend on the plan. Check with the plan."


def test_follow_up_draft_verifies(client, real_today):
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    _office(client, token, action="received")
    _later(real_today, 7)
    d = client.get(f"/api/referrals/{rid}/draft").json()
    assert d["verified"], d["problems"]
    assert d["rule"] == "not_scheduled" and f"/office/{token}" in d["text"] and "Mass HIway" in d["text"]


def test_concurrent_reads_and_writes_stay_consistent(client):
    """Regression: one sqlite3 connection is shared by FastAPI's threadpool. Unlocked reads
    interleaved with writes returned missing rows (found as an intermittent e2e failure)."""
    from concurrent.futures import ThreadPoolExecutor

    client.post("/api/sample-data")
    ids = [f"R-10{i}" for i in range(1, 10)]

    def read(i):
        d = client.get("/api/dashboard").json()
        assert d["total"] == 9, d.get("total")
        r = client.get(f"/api/referrals/{ids[i % 9]}")
        assert r.status_code == 200
        return True

    def write(i):
        rid = "R-102"
        return client.post(f"/api/referrals/{rid}/barriers",
                           json={"type": "other", "note": f"n{i}"}).status_code in (201, 409)

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(read if i % 3 else write, i) for i in range(60)]
        assert all(f.result() for f in futures)


def test_new_referral_declined_via_office_link(client, real_today):
    rid, token = _create_and_send(client, _add_patient(client)["id"])
    v = _office(client, token, action="declined", note="Not accepting new patients")
    assert v["stage"] == "declined" and v["actions"] == []
    ev = client.get(f"/api/referrals/{rid}").json()["referral"]["events"][-1]
    assert (ev["stage"], ev["actor"], ev["source"], ev["note"]) == ("declined", "office", "link", "Not accepting new patients")
    _later(real_today, 2)
    assert _row(client, rid)["flags"][0]["status"] == "Declined, not re-routed"
