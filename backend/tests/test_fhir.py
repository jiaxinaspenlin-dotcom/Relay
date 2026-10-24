"""FHIR R4 bundles validate with fhir.resources.R4B for every archetype and for an MVP-created
referral. fhir.resources does not enforce code value sets, so key status codes are checked here."""
from __future__ import annotations

import json

import pytest
from fhir.resources.R4B import get_fhir_model_class
from fhir.resources.R4B.bundle import Bundle

from app.export.fhir import DIRECTORY_TAG, SYNTHETIC_TAG, build_bundle
from app.models import load_patients

from conftest import TODAY

TASK_STATUS = {"draft", "requested", "received", "accepted", "rejected", "ready", "cancelled",
               "in-progress", "on-hold", "failed", "completed", "entered-in-error"}
SR_STATUS = {"draft", "active", "on-hold", "revoked", "completed", "entered-in-error", "unknown"}
APPT_STATUS = {"proposed", "pending", "booked", "arrived", "fulfilled", "cancelled", "noshow",
               "entered-in-error", "checked-in", "waitlist"}
COMM_STATUS = {"preparation", "in-progress", "not-done", "on-hold", "stopped", "completed",
               "entered-in-error", "unknown"}


def _validate(bundle: dict, sample: bool = True) -> dict[str, list[dict]]:
    Bundle.model_validate(bundle)
    by_type: dict[str, list[dict]] = {}
    ids = set()
    for e in bundle["entry"]:
        r = e["resource"]
        get_fhir_model_class(r["resourceType"]).model_validate(r)
        if sample:
            assert SYNTHETIC_TAG in r["meta"]["tag"], r["resourceType"]
        else:
            assert SYNTHETIC_TAG not in r.get("meta", {}).get("tag", []), r["resourceType"]
        key = f"{r['resourceType']}/{r['id']}"
        assert key not in ids, f"duplicate {key}"
        ids.add(key)
        by_type.setdefault(r["resourceType"], []).append(r)
    # every relative reference resolves inside the bundle
    for ref in _references(bundle):
        assert ref in ids, f"dangling reference {ref}"
    return by_type


def _references(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "reference" and isinstance(v, str):
                yield v
            else:
                yield from _references(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _references(v)


@pytest.mark.parametrize("rid", [f"R-10{i}" for i in range(1, 9)])
def test_archetype_bundle_validates(refs, rid):
    r = refs[rid]
    b = build_bundle(r, load_patients()[r.patient_id], TODAY)
    t = _validate(b)
    assert b["type"] == "collection"
    task, = t["Task"]
    sr, = t["ServiceRequest"]
    assert task["status"] in TASK_STATUS and task["status"] == r.task_status
    assert task["businessStatus"]["coding"][0]["code"] == r.business_status
    assert task["focus"]["reference"] == f"ServiceRequest/{sr['id']}"
    assert sr["status"] in SR_STATUS and sr["intent"] == "order"
    assert sr["category"][0]["coding"][0]["code"] == "3457005"
    assert len(t["Provenance"]) == len(r.events)
    if r.appointment:
        appt, = t["Appointment"]
        assert appt["status"] in APPT_STATUS
    else:
        assert "Appointment" not in t
    if r.plan:
        comp, = t["Composition"]
        titles = [s["title"] for s in comp["section"]]
        assert titles[:8] == ["Patient", "From", "Reason/Conditions", "Visit date", "Assessment",
                              "Plan", "Actions for the PCP", "Questions/contact"]
        assert task["output"][0]["valueReference"]["reference"] == f"Composition/{comp['id']}"
    for c in t.get("Communication", []):
        assert c["status"] in COMM_STATUS
    # fictional practices are not tagged as public-directory
    org = next(o for o in t["Organization"] if o["id"] != "requester")
    assert DIRECTORY_TAG not in org["meta"]["tag"]


def test_real_mode_referral_bundle_validates(client):
    """Hand-entered patient → office link updates → follow-up → PCP close. Directory org,
    Communications, Composition, closed Task, appointment time; no synthetic tag."""
    pid = client.post("/api/patients", json={"name": "Maria Santos", "town": "Orange",
                                             "coverage": "dual"}).json()["id"]
    f = client.get("/api/finder", params={"specialty": "Cardiology", "patient_id": pid}).json()
    practice = next(p for p in f["results"] if p["org_pac_id"])
    d = client.post("/api/referrals", json={
        "patient_id": pid, "specialty": "Cardiology", "practice_id": practice["id"],
        "reason_text": "Please evaluate.", "priority": "routine",
        "condition_text": "Chest pain on exertion"}).json()
    rid, token = d["card"]["id"], d["office_path"].rsplit("/", 1)[1]
    client.post(f"/api/referrals/{rid}/send", json={"channel": "print"})
    for body in ({"action": "missing", "missing": ["records"], "note": "Office notes"},
                 {"action": "authorization", "authorization": "approved"},
                 {"action": "received"},
                 {"action": "patient_contacted", "contact_mode": "office_called"},
                 {"action": "scheduled", "appointment_date": "2026-11-03", "appointment_time": "14:30"},
                 {"action": "seen"},
                 {"action": "plan_returned", "plan": {"assessment": "A.", "plan": "P."}}):
        r = client.post(f"/api/office/{token}", json=body)
        assert r.status_code == 200, (body, r.text)
    client.post(f"/api/referrals/{rid}/communications",
                json={"recipient": "specialist", "text": "Thanks.", "channel": "copy"})
    client.post(f"/api/referrals/{rid}/close", json={"note": "Reviewed"})
    resp = client.get(f"/api/referrals/{rid}/fhir")
    assert resp.headers["content-type"].startswith("application/fhir+json")
    b = resp.json()
    t = _validate(b, sample=False)
    org = next(o for o in t["Organization"] if o["id"] != "requester")
    assert DIRECTORY_TAG in org["meta"]["tag"]
    assert org["identifier"][0]["value"] == practice["org_pac_id"]
    assert t["Task"][0]["status"] == "completed"
    assert t["Task"][0]["businessStatus"]["coding"][0]["code"] == "closed-by-referrer"
    appt = t["Appointment"][0]
    assert appt["status"] == "fulfilled" and appt["start"].startswith("2026-11-03T14:30")
    assert t["Condition"][0]["code"] == {"text": "Chest pain on exertion"}
    assert t["Patient"][0]["name"][0]["family"] == "Santos"
    assert len(t["Communication"]) == 2
    assert {p["activity"]["text"] for p in t["Provenance"]} >= {"Stage → Received (via link)",
                                                               "Stage → Patient contacted (via link)",
                                                               "Update: authorization (via link)"}
    assert t["Coverage"][0]["type"]["text"] == "Dual eligible (Medicare + MassHealth)"
    assert t["ServiceRequest"][0]["insurance"][0]["reference"] == "Coverage/" + t["Coverage"][0]["id"]
    inputs = {i["type"]["text"]: i["valueString"] for i in t["Task"][0]["input"]}
    assert inputs["Authorization status"] == "Approved" and inputs["Patient contact"] == "Office called the patient"
    json.dumps(b)
