"""Sign-in: hashing, sessions, roles, public routes, sample accounts, and acting-user records."""
from __future__ import annotations

from datetime import timedelta

from app import config
from app.auth import COOKIE, SAMPLE_USERS

from conftest import CLIN, COORD, signed_in


def test_api_requires_sign_in(anon):
    for path in ("/api/dashboard", "/api/patients", "/api/inbox", "/api/settings", "/api/referrals/R-101"):
        assert anon.get(path).status_code == 401, path
    assert anon.post("/api/referrals/R-101/call-session").status_code == 401
    # public
    assert anon.get("/api/health").status_code == 200
    assert anon.get("/api/config").status_code == 200
    assert anon.get("/api/auth/status").status_code == 200
    assert anon.get("/api/office/not-a-token").status_code == 404  # token-only, no account


def test_passwords_are_hashed_and_wrong_password_fails(repo, anon):
    row = repo.users.by_email(COORD["email"])
    assert row["password_hash"].startswith("$argon2") and COORD["password"] not in row["password_hash"]
    r = anon.post("/api/auth/sign-in", json={"email": COORD["email"], "password": "wrong"})
    assert r.status_code == 401
    r2 = anon.post("/api/auth/sign-in", json={"email": "nobody@example.test", "password": "wrong"})
    assert r2.status_code == 401 and r.json()["detail"] == r2.json()["detail"]


def test_cookie_is_httponly_and_sign_out_ends_session(anon):
    r = anon.post("/api/auth/sign-in", json={"email": COORD["email"], "password": COORD["password"]})
    cookie = r.headers["set-cookie"].lower()
    assert f"{COOKIE}=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert r.json()["home"] == "/"
    assert anon.get("/api/dashboard").status_code == 200
    anon.post("/api/auth/sign-out")
    assert anon.get("/api/dashboard").status_code == 401


def test_session_stored_hashed_and_expires(repo, anon, monkeypatch):
    anon.post("/api/auth/sign-in", json={"email": COORD["email"], "password": COORD["password"]})
    token = anon.cookies.get(COOKIE)
    stored = [r["token_hash"] for r in repo._all("SELECT token_hash FROM sessions")]
    assert token not in stored and len(stored) == 1
    later = config.real_now() + timedelta(hours=13)
    monkeypatch.setattr(config, "real_now", lambda: later)
    assert anon.get("/api/dashboard").status_code == 401


def test_roles(client, clinician):
    assert clinician.get("/api/auth/me").json()["home"] == "/inbox"
    assert clinician.get("/api/dashboard").status_code == 200  # clinicians can view the dashboard
    client.post("/api/sample-data")
    assert client.post("/api/referrals/R-105/close", json={}).status_code == 403
    assert clinician.post("/api/referrals/R-105/close", json={}).status_code == 200
    assert clinician.post("/api/referrals/R-102/call-session").status_code == 403
    assert clinician.post("/api/referrals/R-102/call-transcript", json={"turns": [{"role": "user", "message": "yes"}]}).status_code == 403


def test_sample_accounts_exist_only_with_sample_data(client, anon):
    assert anon.get("/api/auth/status").json()["sample_accounts"] == []
    assert anon.post("/api/auth/sample-sign-in", json={"role": "coordinator"}).status_code == 404
    client.post("/api/sample-data")
    st = anon.get("/api/auth/status").json()
    assert {a["role"] for a in st["sample_accounts"]} == {"coordinator", "clinician"}
    for u in SAMPLE_USERS:  # README passwords work
        assert signed_in(u).get("/api/auth/me").json()["user"]["name"] == u["name"]
    r = anon.post("/api/auth/sample-sign-in", json={"role": "clinician"})
    assert r.json()["user"]["name"] == "Dr. Avery Lin" and r.json()["home"] == "/inbox"
    client.delete("/api/sample-data")
    assert anon.get("/api/auth/status").json()["sample_accounts"] == []
    assert anon.get("/api/dashboard").status_code == 401  # sample account and its session are gone


def test_first_run_setup(real_today):
    from fastapi.testclient import TestClient

    from app.db import Repo
    from app.main import app
    from app.store import set_repo
    set_repo(Repo(":memory:"))
    c = TestClient(app)
    assert c.get("/api/auth/status").json()["has_users"] is False
    # brand-new install: sample data can be loaded to get the sample accounts
    r = c.post("/api/auth/setup", json={"name": "Pat Lee", "email": "pat@example.test", "password": "longenough",
                                        "practice": "Hilltown Health"})
    assert r.status_code == 201 and c.get("/api/settings").json()["practice"]["practice"] == "Hilltown Health"
    assert c.post("/api/auth/setup", json={"name": "X", "email": "x@example.test", "password": "longenough",
                                           "practice": "P"}).status_code == 409
    set_repo(None)


def test_new_install_can_load_sample_without_account(real_today):
    from fastapi.testclient import TestClient

    from app.db import Repo
    from app.main import app
    from app.store import set_repo
    set_repo(Repo(":memory:"))
    c = TestClient(app)
    assert c.post("/api/sample-data").status_code == 200
    assert c.post("/api/sample-data").status_code == 401  # accounts exist now: sign in first
    set_repo(None)


def test_acting_user_recorded_everywhere(client, clinician):
    pid = client.post("/api/patients", json={"name": "Ana Cruz", "town": "Orange", "coverage": "dual"}).json()["id"]
    f = client.get("/api/finder", params={"specialty": "Cardiology", "patient_id": pid}).json()
    d = client.post("/api/referrals", json={"patient_id": pid, "specialty": "Cardiology", "practice_id": f["results"][0]["id"],
                                            "reason_text": "Evaluate.", "priority": "routine", "condition_text": "Chest pain"}).json()
    rid, token = d["card"]["id"], d["office_path"].split("/")[-1]
    assert d["referral"]["requester"]["coordinator"] == COORD["name"]
    client.post(f"/api/referrals/{rid}/send", json={"channel": "copy"})
    client.post(f"/api/office/{token}", json={"action": "received"})
    client.post(f"/api/referrals/{rid}/updates", json={"action": "patient_contacted", "source": "ai_call",
                                                      "contact_mode": "office_called"})
    client.post(f"/api/referrals/{rid}/barriers", json={"type": "transportation", "note": "No car"})
    client.post(f"/api/referrals/{rid}/communications", json={"recipient": "patient", "text": "Hi", "kind": "patient_message"})
    for body in ({"action": "scheduled", "appointment_date": "2026-11-03", "appointment_time": "10:00"},
                 {"action": "seen"}, {"action": "plan_returned", "plan": {"assessment": "A", "plan": "P"}}):
        client.post(f"/api/office/{token}", json=body)
    clinician.post(f"/api/referrals/{rid}/close", json={})
    ref = client.get(f"/api/referrals/{rid}").json()
    ev = [(e["stage"], e["kind"], e["by"], e["source"]) for e in ref["referral"]["events"]]
    assert ev[0] == ("sent", "stage", COORD["name"], None)
    assert ("received", "stage", "", "link") in ev  # office link: no account
    assert ("patient_contacted", "stage", COORD["name"], "ai_call") in ev
    assert ("patient_contacted", "barrier", COORD["name"], None) in ev
    assert ev[-1] == ("closed", "stage", CLIN["name"], None)
    assert all(c["sent_by"] == COORD["name"] for c in ref["referral"]["communications"])
    assert ref["referral"]["closure"]["by"] == CLIN["name"]
