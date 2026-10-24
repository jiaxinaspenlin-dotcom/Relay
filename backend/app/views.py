"""Response shapes shared by the API and scripts/build_mocks.py. Pure functions."""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.config import PRACTICE_SETTINGS
from app.context.place import place_context
from app.finder.distance import miles_between
from app.finder.towns import resolve_town
from app.loop.metrics import pipeline, summary
from app.loop.states import STAGE_LABELS, TERMINAL, allowed_next
from app.loop.stuck import BARRIER_LABELS, missing_text, needs_attention, stuck_flags
from app.loop.timeline import stage_entered, timeline
from app.models import AUTH_LABELS, COVERAGE_LABELS, MASSHEALTH, MEDICARE, Referral

# Update actions shared by the office link and coordinator Log update -> target stage.
# "authorization" changes a field, not the stage.
UPDATE_ACTIONS: dict[str, Optional[str]] = {
    "received": "received",
    "missing": "received",
    "authorization": None,
    "patient_contacted": "patient_contacted",
    "scheduled": "scheduled",
    "seen": "seen",
    "no_show": "no_show",
    "declined": "declined",
    "plan_returned": "plan_returned",
}

# Route track (design.md): 7 nodes. Authorization is a badge, not a node.
STEPPER = [("sent", "Sent"), ("received", "Received"), ("patient_contacted", "Contacted"),
           ("scheduled", "Scheduled"), ("seen", "Seen"), ("plan_returned", "Plan back"),
           ("closed", "Closed")]

# Referral-requirement hint (B2). A hint for the coordinator, never a decision.
HINT_ORIGINAL_MEDICARE = "Original Medicare generally doesn't require a referral to see a specialist."
HINT_MASSHEALTH_PCC = ("MassHealth requires referrals for certain specialty services (130 CMR 450.118(J)). "
                       "Primary Care ACOs may have a Referral Circle. Confirm for this service.")
HINT_OTHER = "Referral and authorization rules depend on the plan. Check with the plan."
PT1_URL = "https://www.mass.gov/how-to/request-transportation-for-a-member"


def referral_hint(coverage: Optional[str]) -> str:
    if coverage == "original_medicare":
        return HINT_ORIGINAL_MEDICARE
    if coverage in ("masshealth_pcc", "masshealth_pcaco"):
        return HINT_MASSHEALTH_PCC
    return HINT_OTHER


def age_on(dob: Optional[str], today: date) -> Optional[int]:
    if not dob:
        return None
    b = date.fromisoformat(dob)
    return today.year - b.year - ((today.month, today.day) < (b.month, b.day))


def initials(name: str) -> str:
    return " ".join(f"{p[0].upper()}." for p in name.split() if p)


def patient_brief(p: dict, today: date) -> dict:
    cov = p.get("coverage", "unknown")
    return {
        "id": p["id"], "name": p["name"], "town": p["town"], "county": p.get("county"),
        "dob": p.get("dob"), "age": age_on(p.get("dob"), today),
        "coverage": cov, "coverage_label": COVERAGE_LABELS.get(cov, "Unknown"),
        "masshealth": cov in MASSHEALTH, "medicare": cov in MEDICARE,
        "sample": bool(p.get("sample")), "has_chart": bool(p.get("chart_id")),
    }


def referral_distance(ref: Referral) -> int | None:
    a, b = resolve_town(ref.patient_town), resolve_town(ref.performer.town)
    return miles_between(a, b) if a and b else None


def stepper(ref: Referral) -> list[dict]:
    reached: dict[str, date] = {}
    for ev in ref.events:
        if ev.kind == "stage":
            reached.setdefault(ev.stage, ev.at)
    # A referral scheduled straight from Received still passed the Contacted step.
    if "scheduled" in reached and "patient_contacted" not in reached and "received" in reached:
        reached["patient_contacted"] = reached["scheduled"]
    return [{"stage": s, "label": label, "at": reached[s].isoformat() if s in reached else None}
            for s, label in STEPPER]


def _coverage_map(patients: dict[str, dict]) -> dict[str, str]:
    return {pid: p.get("coverage", "unknown") for pid, p in patients.items()}


def referral_card(ref: Referral, patients: dict[str, dict], today: date, rerouted: set[str]) -> dict:
    p = patients[ref.patient_id]
    entered = stage_entered(ref) or ref.authored_on
    flags = stuck_flags(ref, today, rerouted_ids=rerouted, coverage=p.get("coverage"))
    return {
        "id": ref.id,
        "sample": ref.sample,
        "patient": patient_brief(p, today),
        "specialty": ref.specialty,
        "priority": ref.priority,
        "performer": ref.performer.model_dump(),
        "stage": ref.stage,
        "stage_label": STAGE_LABELS[ref.stage],
        "status_label": (f"Missing {missing_text(ref.receipt.missing)}"
                         if ref.stage == "received" and ref.receipt and not ref.receipt.complete
                         else STAGE_LABELS[ref.stage]),
        "stepper": stepper(ref),
        "last_update": (ref.events[-1].at if ref.events else ref.authored_on).isoformat(),
        "days_in_stage": (today - entered).days,
        "miles": referral_distance(ref),
        "appointment": ref.appointment.model_dump(mode="json") if ref.appointment else None,
        "authorization": ref.authorization,
        "authorization_label": AUTH_LABELS[ref.authorization],
        "open_barriers": [{"type": b.type, "label": BARRIER_LABELS[b.type], "opened": b.opened.isoformat()}
                          for b in ref.barriers if b.status == "open"],
        "stuck": [f.to_dict() for f in flags],
        "can_call": bool(flags) and ref.stage in ("sent", "received"),
    }


def dashboard_view(referrals: list[Referral], patients: dict[str, dict], today: date) -> dict:
    rerouted = {r.replaces for r in referrals if r.replaces}
    cards = {r.id: referral_card(r, patients, today, rerouted) for r in referrals}
    cov = _coverage_map(patients)
    return {
        "as_of": today.isoformat(),
        "total": len(referrals),
        "has_sample": any(r.sample for r in referrals),
        "summary": summary(referrals, today, cov),
        "needs_attention": [{**row, "card": cards[row["referral_id"]]}
                            for row in needs_attention(referrals, today, cov)],
        "pipeline": [{**col, "cards": [cards[i] for i in col["referral_ids"]]}
                     for col in pipeline(referrals)],
        "practice_settings": {"label": "Practice setting", "values": PRACTICE_SETTINGS},
    }


def update_actions(ref: Referral) -> list[str]:
    nxt = allowed_next(ref)
    out = []
    for action, stage in UPDATE_ACTIONS.items():
        if stage is None:  # authorization: only matters before the visit
            if ref.stage in ("sent", "received", "patient_contacted", "scheduled", "patient_barrier"):
                out.append(action)
        elif stage in nxt:
            out.append(action)
    return out


def transport_view(ref: Referral, patient: dict) -> dict:
    masshealth = patient.get("coverage") in MASSHEALTH
    barrier = any(b.type == "transportation" and b.status == "open" for b in ref.barriers)
    return {
        "masshealth": masshealth,
        "barrier_open": barrier,
        "show_pt1": masshealth and barrier,
        "pt1_status": ref.pt1_status,
        "pt1_url": PT1_URL,
        "show_plan_note": barrier and not masshealth,
        "transport_plan": ref.transport_plan,
    }


def referral_detail_view(ref: Referral, referrals: list[Referral], patients: dict[str, dict],
                         today: date, office_path: Optional[str] = None) -> dict:
    rerouted = {r.replaces for r in referrals if r.replaces}
    p = patients[ref.patient_id]
    return {
        "card": referral_card(ref, patients, today, rerouted),
        "referral": ref.model_dump(mode="json", by_alias=True),
        "timeline": [{**t, "at": t["at"].isoformat()} for t in timeline(ref)],
        "update_actions": update_actions(ref),
        "can_send": ref.stage not in TERMINAL,
        "can_close": "closed" in allowed_next(ref),
        "can_message_patient": ref.stage in ("received", "patient_contacted", "no_show", "scheduled"),
        "office_path": office_path,
        "hint": referral_hint(p.get("coverage")),
        "transport": transport_view(ref, p),
        "place_context": place_context(ref.patient_town),
    }


def inbox_view(referrals: list[Referral], patients: dict[str, dict], today: date) -> dict:
    """Returned plans awaiting PCP acknowledgement, oldest first."""
    rerouted = {r.replaces for r in referrals if r.replaces}
    rows = [r for r in referrals if r.stage == "plan_returned" and r.plan is not None]
    rows.sort(key=lambda r: (r.plan.returned_on, r.id))
    return {
        "as_of": today.isoformat(),
        "items": [{
            "card": referral_card(r, patients, today, rerouted),
            "reason_text": r.reason_text,
            "reason_condition": r.reason_condition.model_dump(mode="json"),
            "priority": r.priority,
            "plan": r.plan.model_dump(mode="json", by_alias=True),
            "timeline": [{**t, "at": t["at"].isoformat()} for t in timeline(r)],
        } for r in rows],
    }


def office_view(ref: Referral, patient: dict, today: date) -> dict:
    """What the specialist office sees at its update link: the minimum needed to act."""
    return {
        "referral_id": ref.id,
        "sample": ref.sample,
        "today": today.isoformat(),
        "stage": ref.stage,
        "stage_label": STAGE_LABELS[ref.stage],
        "status_label": (f"Missing {missing_text(ref.receipt.missing)}"
                         if ref.stage == "received" and ref.receipt and not ref.receipt.complete
                         else STAGE_LABELS[ref.stage]),
        "stepper": stepper(ref),
        "to": ref.performer.name,
        "from": {"practice": ref.requester.practice, "clinician": ref.requester.clinician,
                 "coordinator": ref.requester.coordinator},
        "patient": {"name": patient["name"], "dob": patient.get("dob"), "town": patient["town"]},
        "specialty": ref.specialty,
        "priority": ref.priority,
        "condition": ref.reason_condition.display,
        "reason_text": ref.reason_text,
        "authorization": ref.authorization,
        "receipt": ref.receipt.model_dump() if ref.receipt else None,
        "appointment": ref.appointment.model_dump(mode="json") if ref.appointment else None,
        "plan": ref.plan.model_dump(mode="json", by_alias=True) if ref.plan else None,
        "actions": update_actions(ref),
        "history": [{"at": e.at.isoformat(), "stage": e.stage, "kind": e.kind, "note": e.note,
                     "label": STAGE_LABELS.get(e.stage, e.stage)} for e in ref.events],
    }
