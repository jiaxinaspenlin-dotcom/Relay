#!/usr/bin/env python3
"""Build the seeded referral scenarios R-101…R-108 (design.md §2.2) around the selected patients.

    python3 scripts/seed_referrals.py

Reads  data/synthetic/selected_patients.json   (from select_patients.py)
Writes data/synthetic/referrals.json

Everything here is SYNTHETIC. Seeded referrals go to FICTIONAL practices placed in real towns, so
distances are real but no real office is shown as slow (product.md). The live-demo patient is left
without a referral so it can be created live in the finder.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYN = ROOT / "data" / "synthetic"
DEMO_TODAY = date(2026, 10, 24)

PCP = {
    "practice": "Quabbin Hills Family Medicine (fictional)",
    "clinician": "Dr. Avery Lin (synthetic)",
    "coordinator": "Sam Ortiz, referral coordinator (synthetic)",
}

# Fictional specialist practices, one per specialty, in real towns (distance is computed in the app).
PRACTICES = {
    "Cardiology": {"id": "fx-cardio", "name": "Pioneer Valley Heart Associates (fictional)", "town": "Springfield"},
    "Nephrology": {"id": "fx-neph", "name": "Central Mass Kidney Care (fictional)", "town": "Worcester"},
    "Gastroenterology": {"id": "fx-gi", "name": "Berkshire Digestive Health (fictional)", "town": "Pittsfield"},
    "Endocrinology": {"id": "fx-endo", "name": "Connecticut River Endocrine Group (fictional)", "town": "Northampton"},
}

# Stage -> (Task.status, businessStatus) per design.md §3
TASK = {
    "sent": ("requested", "sent"), "accepted": ("accepted", "accepted"),
    "scheduled": ("in-progress", "scheduled"), "no_show": ("in-progress", "no-show"),
    "seen": ("in-progress", "visit-completed"), "plan_returned": ("completed", "plan-returned"),
    "closed": ("completed", "closed-by-referrer"), "declined": ("rejected", "declined"),
    "patient_barrier": ("on-hold", "patient-barrier"), "cancelled": ("cancelled", "cancelled"),
}

# Simulated specialist plan text (clinician-authored in the real world; synthetic here).
PLANS = {
    "Cardiology": ("Findings reviewed; cardiac evaluation completed at visit (synthetic).",
                   "Follow-up visit in 6 months. Repeat imaging per cardiology before next visit. "
                   "Telehealth follow-up acceptable to this office."),
    "Nephrology": ("Kidney function reviewed; stable at this visit (synthetic).",
                   "Repeat kidney labs in 3 months, ordered by nephrology. Follow-up in 6 months; "
                   "telehealth acceptable if labs are drawn locally."),
    "Gastroenterology": ("Colon polyp history reviewed (synthetic).",
                         "Surveillance procedure to be scheduled by this office. Results will be sent to the PCP."),
    "Endocrinology": ("Diabetes-related findings reviewed (synthetic).",
                      "Follow-up in 3 months. Endocrinology will send updated lab orders to the PCP."),
}


def d(month: int, day: int) -> str:
    return date(2026, month, day).isoformat()


def ev(stage: str, at: str, actor: str, note: str = "") -> dict:
    return {"stage": stage, "at": at, "actor": actor, "note": note}


# (ref id, list of events, appointment, barriers, closure info) — dates from design.md §2.2
SCENARIOS = [
    ("R-101", [ev("sent", d(10, 17), "pcp")], None, [], None),
    ("R-102", [ev("sent", d(10, 6), "pcp"), ev("accepted", d(10, 10), "specialist")], None,
     [{"type": "transportation", "status": "open", "opened": d(10, 12),
       "note": "No car; daughter works weekdays (synthetic)."}], None),
    ("R-103", [ev("sent", d(10, 1), "pcp"), ev("accepted", d(10, 3), "specialist"),
               ev("scheduled", d(10, 8), "specialist")], {"start": d(11, 3), "status": "booked"}, [], None),
    ("R-104", [ev("sent", d(9, 15), "pcp"), ev("accepted", d(9, 17), "specialist"),
               ev("scheduled", d(9, 19), "specialist"), ev("seen", d(10, 12), "specialist")],
     {"start": d(10, 12), "status": "fulfilled"}, [], None),
    ("R-105", [ev("sent", d(9, 8), "pcp"), ev("accepted", d(9, 10), "specialist"),
               ev("scheduled", d(9, 12), "specialist"), ev("seen", d(10, 15), "specialist"),
               ev("plan_returned", d(10, 22), "specialist")], {"start": d(10, 15), "status": "fulfilled"}, [], None),
    ("R-106", [ev("sent", d(8, 25), "pcp"), ev("accepted", d(8, 27), "specialist"),
               ev("scheduled", d(8, 29), "specialist"), ev("seen", d(9, 23), "specialist"),
               ev("plan_returned", d(9, 30), "specialist"),
               ev("closed", d(10, 5), "pcp", "Plan reviewed; added to problem list (synthetic).")],
     {"start": d(9, 23), "status": "fulfilled"}, [], None),
    ("R-107", [ev("sent", d(10, 14), "pcp"),
               ev("declined", d(10, 20), "specialist", "No new-patient capacity this quarter (synthetic).")],
     None, [], None),
    ("R-108", [ev("sent", d(9, 22), "pcp"), ev("accepted", d(9, 24), "specialist"),
               ev("scheduled", d(9, 26), "specialist"), ev("no_show", d(10, 15), "specialist")],
     {"start": d(10, 15), "status": "noshow"},
     [{"type": "schedule_work", "status": "open", "opened": d(10, 16),
       "note": "Works weekday shifts; asked about late-day slots (synthetic)."}], None),
]


def main() -> None:
    sel = json.loads((SYN / "selected_patients.json").read_text())
    live_id = sel.get("live_demo_patient")
    pool = [p for p in sel["patients"] if p["id"] != live_id]
    if len(pool) < len(SCENARIOS):
        raise SystemExit(f"Need {len(SCENARIOS)} non-live patients, have {len(pool)}. Rerun select_patients.py --n 10")

    referrals = []
    for (rid, events, appt, barriers, _), p in zip(SCENARIOS, pool):
        spec = p["specialty"]
        stage = events[-1]["stage"]
        status, business = TASK[stage]
        practice = dict(PRACTICES[spec], fictional=True)
        cond = p["reason_condition"]
        ref = {
            "id": rid,
            "synthetic": True,
            "patient_id": p["id"],
            "patient_town": p["town"],
            "specialty": spec,
            "pri_spec": p["pri_spec"],
            "priority": "routine",  # set by the PCP; Relay never changes it
            "reason_text": f"Please evaluate: {cond['DESCRIPTION']} (synthetic referral).",
            "reason_condition": {"code": cond.get("CODE"), "system": cond.get("SYSTEM", "SNOMED-CT"),
                                 "display": cond["DESCRIPTION"], "onset": cond.get("START")},
            "requester": PCP,
            "performer": practice,
            "stage": stage,
            "task_status": status,
            "business_status": business,
            "authored_on": events[0]["at"],
            "events": events,
            "appointment": appt,
            "barriers": barriers,
            "communications": [],
            "plan": None,
            "closure": None,
        }
        if stage in ("plan_returned", "closed"):
            assessment, plan = PLANS[spec]
            returned = next(e["at"] for e in events if e["stage"] == "plan_returned")
            ref["plan"] = {
                "simulated": True,
                "returned_on": returned,
                "from": practice["name"],
                "visit_date": appt["start"],
                "reason": cond["DESCRIPTION"],
                "assessment": assessment,
                "plan": plan,
                "actions_for_pcp": "Please review and update the problem list (synthetic).",
                "questions_contact": f"{practice['name']} referral line (fictional)",
                "omitted_fields_note": "ACCESS-specific fields (track, OAP measures) omitted: not an ACCESS referral.",
            }
        if stage == "closed":
            ce = events[-1]
            ref["closure"] = {"at": ce["at"], "by": PCP["clinician"], "reason": "plan_received", "note": ce["note"]}
        referrals.append(ref)

    out = {
        "note": "SYNTHETIC referrals. Specialist practices are fictional; responses are simulated.",
        "demo_today": DEMO_TODAY.isoformat(),
        "pcp": PCP,
        "fictional_practices": list(PRACTICES.values()),
        "live_demo_patient": live_id,
        "referrals": referrals,
    }
    (SYN / "referrals.json").write_text(json.dumps(out, indent=2))

    print(f"{'ref':<6}{'stage':<15}{'specialty':<17}{'patient town':<18}practice")
    for r in referrals:
        print(f"{r['id']:<6}{r['stage']:<15}{r['specialty']:<17}{r['patient_town']:<18}{r['performer']['name']}")
    print(f"\nLive demo patient (no referral yet): {live_id}")
    print(f"Wrote {SYN / 'referrals.json'}")


if __name__ == "__main__":
    main()
