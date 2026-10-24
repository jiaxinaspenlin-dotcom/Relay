"""Dashboard aggregates (R1.3). All counts are computed from synthetic referrals."""
from __future__ import annotations

from datetime import date
from statistics import median
from typing import Optional

from app.loop.states import STAGE_LABELS
from app.loop.stuck import needs_attention
from app.loop.timeline import first_event_date
from app.models import Referral

CLOSED_STAGES = frozenset({"closed", "cancelled"})

# Dashboard pipeline columns (R1.1). Declined and Patient barrier are shown as their own columns.
PIPELINE = ["sent", "accepted", "scheduled", "no_show", "seen", "plan_returned", "declined",
            "patient_barrier"]


def days_sent_to_scheduled(ref: Referral) -> Optional[int]:
    sent = first_event_date(ref, "sent")
    sched = first_event_date(ref, "scheduled")
    if sent is None or sched is None:
        return None
    return (sched - sent).days


def summary(referrals: list[Referral], today: date) -> dict:
    open_refs = [r for r in referrals if r.stage not in CLOSED_STAGES]
    stuck = needs_attention(referrals, today)
    closed_this_month = sum(
        1 for r in referrals
        if r.stage == "closed" and r.closure is not None
        and (r.closure.at.year, r.closure.at.month) == (today.year, today.month)
    )
    durations = [d for d in (days_sent_to_scheduled(r) for r in referrals) if d is not None]
    return {
        "synthetic": True,
        "as_of": today.isoformat(),
        "open": len(open_refs),
        "stuck": len(stuck),
        "closed_this_month": closed_this_month,
        "median_days_sent_to_scheduled": median(durations) if durations else None,
        "median_basis_n": len(durations),
    }


def pipeline(referrals: list[Referral]) -> list[dict]:
    return [
        {"stage": s, "label": STAGE_LABELS[s],
         "referral_ids": sorted(r.id for r in referrals if r.stage == s)}
        for s in PIPELINE
    ]
