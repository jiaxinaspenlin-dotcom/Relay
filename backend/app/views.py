"""Response shapes shared by the API and scripts/build_mocks.py. Pure functions."""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.config import PRACTICE_SETTINGS
from app.context.place import place_context
from app.finder.distance import miles_between
from app.finder.towns import resolve_town
from app.loop.metrics import pipeline, summary
from app.loop.states import STAGE_LABELS, allowed_next
from app.loop.stuck import BARRIER_LABELS, needs_attention, stuck_flags
from app.loop.timeline import timeline
from app.models import COVERAGE_LABELS, Referral

# Log update actions (R2.5) -> loop stage.
LOG_ACTIONS = {"accepted": "accepted", "declined": "declined", "scheduled": "scheduled",
               "seen": "seen", "no_show": "no_show", "plan_received": "plan_returned"}

# The LoopStepper's main path (design.md §9).
STEPPER = ["sent", "accepted", "scheduled", "seen", "plan_returned", "closed"]


def age_on(dob: Optional[str], today: date) -> Optional[int]:
    if not dob:
        return None
    b = date.fromisoformat(dob)
    return today.year - b.year - ((today.month, today.day) < (b.month, b.day))


def patient_brief(p: dict, today: date) -> dict:
    """Patient fields for screens (no chart payload)."""
    return {
        "id": p["id"], "name": p["name"], "town": p["town"], "county": p.get("county"),
        "dob": p.get("dob"), "age": age_on(p.get("dob"), today),
        "coverage": p.get("coverage", "unknown"),
        "coverage_label": COVERAGE_LABELS.get(p.get("coverage", "unknown"), "Unknown"),
        "sample": bool(p.get("sample")), "has_chart": bool(p.get("chart_id")),
    }


def referral_distance(ref: Referral) -> int | None:
    a, b = resolve_town(ref.patient_town), resolve_town(ref.performer.town)
    return miles_between(a, b) if a and b else None


def stepper(ref: Referral) -> list[dict]:
    reached = {}
    for ev in ref.events:
        reached.setdefault(ev.stage, ev.at)
    return [{"stage": s, "label": STAGE_LABELS[s],
             "at": reached[s].isoformat() if s in reached else None} for s in STEPPER]


def referral_card(ref: Referral, patients: dict[str, dict], today: date,
                  rerouted: set[str]) -> dict:
    return {
        "id": ref.id,
        "sample": ref.sample,
        "patient": patient_brief(patients[ref.patient_id], today),
        "specialty": ref.specialty,
        "priority": ref.priority,
        "performer": ref.performer.model_dump(),
        "stage": ref.stage,
        "stage_label": STAGE_LABELS[ref.stage],
        "stepper": stepper(ref),
        "last_update": (ref.events[-1].at if ref.events else ref.authored_on).isoformat(),
        "days_in_stage": (today - (ref.events[-1].at if ref.events else ref.authored_on)).days,
        "miles": referral_distance(ref),
        "appointment": ref.appointment.model_dump(mode="json") if ref.appointment else None,
        "open_barriers": [{"type": b.type, "label": BARRIER_LABELS[b.type], "opened": b.opened.isoformat()}
                          for b in ref.barriers if b.status == "open"],
        "stuck": [f.to_dict() for f in stuck_flags(ref, today, rerouted_ids=rerouted)],
    }


def dashboard_view(referrals: list[Referral], patients: dict[str, dict], today: date) -> dict:
    rerouted = {r.replaces for r in referrals if r.replaces}
    cards = {r.id: referral_card(r, patients, today, rerouted) for r in referrals}
    return {
        "as_of": today.isoformat(),
        "total": len(referrals),
        "has_sample": any(r.sample for r in referrals),
        "summary": summary(referrals, today),
        "needs_attention": [{**row, "card": cards[row["referral_id"]]}
                            for row in needs_attention(referrals, today)],
        "pipeline": [{**col, "cards": [cards[i] for i in col["referral_ids"]]}
                     for col in pipeline(referrals)],
        "practice_settings": {"label": "Practice setting", "values": PRACTICE_SETTINGS},
    }


def referral_detail_view(ref: Referral, referrals: list[Referral], patients: dict[str, dict],
                         today: date, office_path: Optional[str] = None) -> dict:
    rerouted = {r.replaces for r in referrals if r.replaces}
    return {
        "card": referral_card(ref, patients, today, rerouted),
        "referral": ref.model_dump(mode="json", by_alias=True),
        "allowed_next": [{"stage": s, "label": STAGE_LABELS[s]} for s in allowed_next(ref)],
        "timeline": [{**t, "at": t["at"].isoformat()} for t in timeline(ref)],
        "log_update_actions": [a for a, stage in LOG_ACTIONS.items() if stage in allowed_next(ref)],
        "can_send": ref.stage not in ("closed", "cancelled", "declined"),
        "can_close": "closed" in allowed_next(ref),
        "office_path": office_path,
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
    office_actions = {"accepted": "accepted", "declined": "declined", "scheduled": "scheduled",
                      "seen": "seen", "no_show": "no_show", "plan_returned": "plan_returned"}
    nxt = allowed_next(ref)
    return {
        "referral_id": ref.id,
        "sample": ref.sample,
        "today": today.isoformat(),
        "stage": ref.stage,
        "stage_label": STAGE_LABELS[ref.stage],
        "stepper": stepper(ref),
        "to": ref.performer.name,
        "from": {"practice": ref.requester.practice, "clinician": ref.requester.clinician,
                 "coordinator": ref.requester.coordinator},
        "patient": {"name": patient["name"], "dob": patient.get("dob"), "town": patient["town"]},
        "specialty": ref.specialty,
        "priority": ref.priority,
        "condition": ref.reason_condition.display,
        "reason_text": ref.reason_text,
        "appointment": ref.appointment.model_dump(mode="json") if ref.appointment else None,
        "plan": ref.plan.model_dump(mode="json", by_alias=True) if ref.plan else None,
        "actions": [a for a, s in office_actions.items() if s in nxt],
        "history": [{"at": e.at.isoformat(), "stage": e.stage, "label": STAGE_LABELS.get(e.stage, e.stage)}
                    for e in ref.events],
    }
