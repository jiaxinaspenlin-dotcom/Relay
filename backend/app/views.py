"""Response shapes shared by the API (Block 3) and the frontend mock fixtures (task 1.6).

Keep these functions pure so scripts/build_mocks.py and the API produce identical JSON.
"""
from __future__ import annotations

from datetime import date

from app.config import PRACTICE_SETTINGS
from app.context.place import place_context
from app.finder.distance import miles_between
from app.finder.towns import resolve_town
from app.loop.metrics import pipeline, summary
from app.loop.states import STAGE_LABELS, allowed_next
from app.loop.stuck import BARRIER_LABELS, needs_attention, stuck_flags
from app.loop.timeline import timeline
from app.models import Referral

# The LoopStepper's main path (design.md §9).
STEPPER = ["sent", "accepted", "scheduled", "seen", "plan_returned", "closed"]


def patient_brief(p: dict) -> dict:
    """Synthetic patient fields safe for screens (no FHIR payload)."""
    return {k: p.get(k) for k in ("id", "synthetic_name", "town", "county", "age", "sex", "payer")}


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
        "synthetic": True,
        "patient": patient_brief(patients[ref.patient_id]),
        "specialty": ref.specialty,
        "priority": ref.priority,
        "performer": ref.performer.model_dump(),
        "stage": ref.stage,
        "stage_label": STAGE_LABELS[ref.stage],
        "stepper": stepper(ref),
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
        "synthetic": True,
        "as_of": today.isoformat(),
        "summary": summary(referrals, today),
        "needs_attention": [{**row, "card": cards[row["referral_id"]]}
                            for row in needs_attention(referrals, today)],
        "pipeline": [{**col, "cards": [cards[i] for i in col["referral_ids"]]}
                     for col in pipeline(referrals)],
        "practice_settings": {"label": "Practice setting", "values": PRACTICE_SETTINGS},
    }


def referral_detail_view(ref: Referral, referrals: list[Referral], patients: dict[str, dict],
                         today: date) -> dict:
    rerouted = {r.replaces for r in referrals if r.replaces}
    return {
        "synthetic": True,
        "card": referral_card(ref, patients, today, rerouted),
        "referral": ref.model_dump(mode="json", by_alias=True),
        "allowed_next": [{"stage": s, "label": STAGE_LABELS[s]} for s in allowed_next(ref)],
        "timeline": [{**t, "at": t["at"].isoformat()} for t in timeline(ref)],
        "place_context": place_context(ref.patient_town),
        "packet": None,  # built in Block 3 (drafting/facts.py)
    }
