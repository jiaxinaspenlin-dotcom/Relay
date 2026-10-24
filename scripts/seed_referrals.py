#!/usr/bin/env python3
"""Build the sample referral scenarios R-101…R-109 around the selected Synthea patients.

    .venv/bin/python scripts/seed_referrals.py

Reads  data/synthetic/selected_patients.json and data/synthetic/patients/*.json
Writes data/synthetic/referrals.json

Workflow (design.md §3): Sent → Received (complete / incomplete) → Patient contacted → Scheduled →
Seen → Plan returned → Closed, with Declined, No-show, Cancelled, Patient barrier on the side.
Sample referrals go to FICTIONAL practices in real towns, with fictional 555-01xx phone numbers.
Dates are written for 2026-10-24 and shifted to "today" when the app loads sample data.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYN = ROOT / "data" / "synthetic"
BASE = date(2026, 10, 24)

PCP = {
    "practice": "Quabbin Hills Family Medicine",
    "clinician": "Dr. Avery Lin",
    "coordinator": "Sam Ortiz, referral coordinator",
}

PRACTICES = {
    "Cardiology": {"id": "fx-cardio", "name": "Pioneer Valley Heart Associates", "town": "Springfield",
                   "phone": "413-555-0142"},
    "Nephrology": {"id": "fx-neph", "name": "Central Mass Kidney Care", "town": "Worcester",
                   "phone": "508-555-0167"},
    "Gastroenterology": {"id": "fx-gi", "name": "Berkshire Digestive Health", "town": "Pittsfield",
                         "phone": "413-555-0118"},
    "Endocrinology": {"id": "fx-endo", "name": "Connecticut River Endocrine Group", "town": "Northampton",
                      "phone": "413-555-0193"},
}
PRI_SPEC = {
    "Cardiology": "CARDIOVASCULAR DISEASE (CARDIOLOGY)", "Nephrology": "NEPHROLOGY",
    "Gastroenterology": "GASTROENTEROLOGY", "Endocrinology": "ENDOCRINOLOGY",
}

TASK = {
    "sent": ("requested", "sent"), "received": ("received", "received-complete"),
    "patient_contacted": ("accepted", "patient-contacted"), "scheduled": ("in-progress", "scheduled"),
    "no_show": ("in-progress", "no-show"), "seen": ("in-progress", "visit-completed"),
    "plan_returned": ("completed", "plan-returned"), "closed": ("completed", "closed-by-referrer"),
    "declined": ("rejected", "declined"),
}

PLANS = {
    "Cardiology": ("Cardiac history and current symptoms reviewed at the visit.",
                   "Echocardiogram in 6 weeks, ordered by cardiology. Follow-up visit after results."),
    "Nephrology": ("Kidney function reviewed; stable at this visit.",
                   "Repeat kidney labs in 3 months, ordered by nephrology. Follow-up in 6 months."),
    "Gastroenterology": ("Colon polyp history reviewed.",
                         "Surveillance procedure to be arranged by this office. Results will be sent to the PCP."),
    "Endocrinology": ("Diabetes-related findings reviewed.",
                      "Follow-up in 3 months. Endocrinology will send updated lab orders to the PCP."),
}


def d(month: int, day: int) -> str:
    return date(2026, month, day).isoformat()


def ev(stage: str, at: str, actor: str, note: str = "", source: str | None = None) -> dict:
    return {"stage": stage, "at": at, "actor": actor, "note": note, "source": source, "kind": "stage"}


def chart_condition(pid: str, code: str) -> dict:
    """Active condition `code` from the patient's Synthea bundle."""
    bundle = json.loads((SYN / "patients" / f"{pid}.json").read_text())
    for e in bundle["entry"]:
        r = e["resource"]
        if r["resourceType"] == "Condition" and any(c.get("code") == code for c in r["code"]["coding"]):
            c = next(c for c in r["code"]["coding"] if c.get("code") == code)
            return {"code": code, "system": "SNOMED-CT", "display": c.get("display", ""),
                    "onset": (r.get("onsetDateTime") or "")[:10] or None}
    raise SystemExit(f"{pid} has no condition {code}")


RECEIVED = lambda at, note="": ev("received", at, "specialist", note, "fax")  # noqa: E731

# Each scenario names its patient, so the cast is stable when selected_patients changes order.
SCENARIOS = [
    {"id": "R-101", "patient": "6c82ee38-33d8-5667-c9c7-a4c869857230",  # Athol, no receipt confirmation
     "events": [ev("sent", d(10, 17), "coordinator")]},
    {"id": "R-102", "patient": "a94cbdb3-6379-0fdc-1a9b-28ae9399782c",  # failure 1: received, patient not contacted
     "specialty": "Cardiology", "condition": "399211009",
     "events": [ev("sent", d(10, 6), "coordinator"), RECEIVED(d(10, 10))],
     "receipt": {"complete": True, "missing": [], "note": ""},
     "barriers": [{"type": "transportation", "status": "open", "opened": d(10, 12),
                   "note": "No car; daughter works weekdays."}],
     "transport_plan": "Daughter may be able to drive on a Friday."},
    {"id": "R-103", "patient": "a4fd2a0e-8bd8-d073-c7bf-38b30dbfab69",  # Orange, dual eligible, scheduled
     "events": [ev("sent", d(10, 1), "coordinator"), RECEIVED(d(10, 3)),
                ev("patient_contacted", d(10, 6), "specialist", "Office called the patient.", "phone"),
                ev("scheduled", d(10, 8), "specialist", "", "phone")],
     "receipt": {"complete": True, "missing": [], "note": ""}, "contact_mode": "office_called",
     "appointment": {"start": d(11, 3), "time": "10:30", "status": "booked"},
     "authorization": "approved", "authorization_since": d(10, 7),
     "barriers": [{"type": "transportation", "status": "open", "opened": d(10, 8),
                   "note": "Doesn't drive; lives alone."}]},
    {"id": "R-104", "patient": "b7791785-0a80-6c8f-9111-d0d6eae834f1",  # failure 2: seen, no plan back
     "events": [ev("sent", d(9, 15), "coordinator"), RECEIVED(d(9, 17)),
                ev("patient_contacted", d(9, 18), "specialist", "Patient told to call.", "fax"),
                ev("scheduled", d(9, 19), "specialist", "", "phone"),
                ev("seen", d(10, 12), "specialist", "", "phone")],
     "receipt": {"complete": True, "missing": [], "note": ""}, "contact_mode": "patient_told_to_call",
     "appointment": {"start": d(10, 12), "time": "09:00", "status": "fulfilled"}},
    {"id": "R-105", "patient": "3a3de94d-c3ab-76c1-1893-d73a17848fc1",  # plan returned, awaiting PCP
     "events": [ev("sent", d(9, 8), "coordinator"), RECEIVED(d(9, 10)),
                ev("patient_contacted", d(9, 11), "specialist", "", "phone"),
                ev("scheduled", d(9, 12), "specialist", "", "phone"),
                ev("seen", d(10, 15), "specialist", "", "phone"),
                ev("plan_returned", d(10, 22), "specialist", "", "fax")],
     "receipt": {"complete": True, "missing": [], "note": ""}, "contact_mode": "office_called",
     "appointment": {"start": d(10, 15), "time": "13:15", "status": "fulfilled"}},
    {"id": "R-106", "patient": "c86c400e-ff88-a1e3-2e23-caa4d8311f47",  # closed
     "events": [ev("sent", d(8, 25), "coordinator"), RECEIVED(d(8, 26)),
                ev("patient_contacted", d(8, 27), "specialist", "", "phone"),
                ev("scheduled", d(8, 29), "specialist", "", "phone"),
                ev("seen", d(9, 23), "specialist", "", "phone"),
                ev("plan_returned", d(9, 30), "specialist", "", "fax"),
                ev("closed", d(10, 5), "pcp", "Plan reviewed; added to problem list.")],
     "receipt": {"complete": True, "missing": [], "note": ""}, "contact_mode": "office_called",
     "appointment": {"start": d(9, 23), "time": "11:00", "status": "fulfilled"}},
    {"id": "R-107", "patient": "aa616abe-1761-0c9a-7959-07544679dafd",  # declined
     "events": [ev("sent", d(10, 14), "coordinator"),
                ev("declined", d(10, 20), "specialist", "No new-patient capacity this quarter.", "fax")]},
    {"id": "R-108", "patient": "76b20010-c318-5754-8c85-983aa538522f",  # no-show
     "events": [ev("sent", d(9, 22), "coordinator"), RECEIVED(d(9, 23)),
                ev("patient_contacted", d(9, 24), "specialist", "", "phone"),
                ev("scheduled", d(9, 26), "specialist", "", "phone"),
                ev("no_show", d(10, 15), "specialist", "", "phone")],
     "receipt": {"complete": True, "missing": [], "note": ""}, "contact_mode": "office_called",
     "appointment": {"start": d(10, 15), "time": "08:30", "status": "noshow"},
     "barriers": [{"type": "schedule_work", "status": "open", "opened": d(10, 16),
                   "note": "Works weekday shifts; asked about late-day slots."}]},
    {"id": "R-109", "patient": "2256d4ea-bced-66a5-4c23-50cbdca2708e",  # received incomplete: records
     "events": [ev("sent", d(10, 19), "coordinator"),
                ev("received", d(10, 21), "specialist", "Need last two office notes and recent labs.", "fax")],
     "receipt": {"complete": False, "missing": ["records"], "note": "Need last two office notes and recent labs."},
     "authorization": "pending", "authorization_since": d(10, 21)},
]


def main() -> None:
    sel = {p["id"]: p for p in json.loads((SYN / "selected_patients.json").read_text())["patients"]}
    referrals = []
    for sc in SCENARIOS:
        p = sel[sc["patient"]]
        spec = sc.get("specialty", p["specialty"])
        if "condition" in sc:
            cond = chart_condition(p["id"], sc["condition"])
        else:
            rc = p["reason_condition"]
            cond = {"code": rc["CODE"], "system": "SNOMED-CT", "display": rc["DESCRIPTION"], "onset": rc.get("START")}
        events = sc["events"]
        stage = events[-1]["stage"]
        status, business = TASK[stage]
        receipt = sc.get("receipt")
        if stage == "received" and receipt and not receipt["complete"]:
            business = "received-incomplete"
        practice = dict(PRACTICES[spec], fictional=True)
        ref = {
            "id": sc["id"], "sample": True, "patient_id": p["id"], "patient_town": p["town"],
            "specialty": spec, "pri_spec": PRI_SPEC[spec], "priority": "routine",
            "reason_text": f"Please evaluate: {cond['display']}.",
            "reason_condition": cond, "requester": PCP, "performer": practice,
            "stage": stage, "task_status": status, "business_status": business,
            "authored_on": events[0]["at"], "events": events,
            "appointment": sc.get("appointment"), "barriers": sc.get("barriers", []),
            "communications": [], "plan": None, "closure": None,
            "receipt": receipt, "contact_mode": sc.get("contact_mode"),
            "authorization": sc.get("authorization", "not_set"),
            "authorization_since": sc.get("authorization_since"),
            "pt1_status": "not_started", "transport_plan": sc.get("transport_plan", ""),
        }
        if stage in ("plan_returned", "closed"):
            assessment, plan = PLANS[spec]
            returned = next(e["at"] for e in events if e["stage"] == "plan_returned")
            ref["plan"] = {
                "simulated": True, "returned_on": returned, "from": practice["name"],
                "visit_date": sc["appointment"]["start"], "reason": cond["display"],
                "assessment": assessment, "plan": plan,
                "actions_for_pcp": "Please review and update the problem list.",
                "questions_contact": f"{practice['name']}, {practice['phone']}",
                "omitted_fields_note": "ACCESS-specific fields (track, OAP measures) omitted: not an ACCESS referral.",
            }
        if stage == "closed":
            ref["closure"] = {"at": events[-1]["at"], "by": PCP["clinician"], "reason": "plan_received",
                              "note": events[-1]["note"]}
        referrals.append(ref)

    out = {
        "note": "Sample referrals: synthetic patients, fictional practices and phone numbers.",
        "demo_today": BASE.isoformat(),
        "pcp": PCP,
        "fictional_practices": list(PRACTICES.values()),
        "referrals": referrals,
    }
    (SYN / "referrals.json").write_text(json.dumps(out, indent=2) + "\n")
    for r in referrals:
        name = sel[r["patient_id"]]["synthetic_name"]
        print(f"{r['id']:<6}{r['business_status']:<20}{r['specialty']:<17}{r['patient_town']:<18}"
              f"{sel[r['patient_id']]['payer']:<14}{name}")


if __name__ == "__main__":
    main()
