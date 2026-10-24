"""Stuck rules (design.md §4). Thresholds are practice settings from config.PRACTICE_SETTINGS,
never clinical standards. A rule fires when elapsed days >= threshold.

Pure functions: pass `today` explicitly (callers use config.DEMO_TODAY).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Iterable, Optional

from app.config import PRACTICE_SETTINGS
from app.loop.states import TERMINAL
from app.loop.timeline import last_event_date
from app.models import Referral

BARRIER_LABELS = {
    "transportation": "Transportation",
    "coverage": "Coverage",
    "language": "Language/interpreter",
    "schedule_work": "Schedule/work",
    "cost": "Cost",
    "other": "Other",
}


@dataclass(frozen=True)
class StuckFlag:
    rule: str
    days: int
    message: str
    setting_key: str
    threshold: int
    unit: str  # "days" or "business days"
    recipient: str  # who a follow-up would go to: specialist | patient | pcp
    challenge_failure: Optional[int] = None  # 1 or 2 when the rule maps to the brief's failures

    def to_dict(self) -> dict:
        return asdict(self)


def business_days_between(start: date, end: date) -> int:
    """Weekdays d with start < d <= end. No holiday calendar."""
    if end <= start:
        return 0
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def _flag(rule, days, message, key, unit, recipient, failure=None, settings=None) -> StuckFlag:
    return StuckFlag(rule, days, message, key, (settings or PRACTICE_SETTINGS)[key], unit,
                     recipient, failure)


def stuck_flags(
    ref: Referral,
    today: date,
    *,
    rerouted_ids: Iterable[str] = (),
    settings: Optional[dict[str, int]] = None,
) -> list[StuckFlag]:
    """All stuck rules that match `ref` on `today`.

    `rerouted_ids` are referral IDs that some other referral `replaces` (declined → re-routed).
    """
    s = settings or PRACTICE_SETTINGS
    out: list[StuckFlag] = []
    stage = ref.stage

    def since(stage_name: str) -> Optional[int]:
        d = last_event_date(ref, stage_name)
        return None if d is None else (today - d).days

    if stage == "sent":
        sent = last_event_date(ref, "sent")
        if sent is not None:
            n = business_days_between(sent, today)
            if n >= s["sent_no_response_business_days"]:
                out.append(_flag(
                    "sent_no_response", n,
                    f"Sent {_plural(n, 'business day')} ago — no response from {ref.performer.name}",
                    "sent_no_response_business_days", "business days", "specialist", settings=s))

    elif stage == "accepted":
        n = since("accepted")
        if n is not None and n >= s["accepted_no_appointment_days"]:
            out.append(_flag(
                "accepted_no_appointment", n,
                f"Accepted {_plural(n, 'day')} ago — no appointment yet",
                "accepted_no_appointment_days", "days", "specialist", failure=1, settings=s))

    elif stage == "scheduled":
        appt = ref.appointment
        if appt is not None and appt.start < today:
            n = (today - appt.start).days
            if n >= s["appointment_not_confirmed_days"]:
                out.append(_flag(
                    "appointment_not_confirmed", n,
                    f"Appointment was {appt.start.isoformat()} — visit not confirmed",
                    "appointment_not_confirmed_days", "days", "specialist", settings=s))

    elif stage == "no_show":
        appt = ref.appointment
        missed = appt.start if appt else last_event_date(ref, "no_show")
        if missed is not None:
            n = max((today - missed).days, 0)
            if n >= s["no_show_days"]:
                out.append(_flag(
                    "no_show", n, f"Missed appointment on {missed.isoformat()}",
                    "no_show_days", "days", "patient", settings=s))

    elif stage == "seen":
        n = since("seen")
        if n is not None and n >= s["seen_no_plan_days"]:
            out.append(_flag(
                "seen_no_plan", n, f"Seen {_plural(n, 'day')} ago — plan not received",
                "seen_no_plan_days", "days", "specialist", failure=2, settings=s))

    elif stage == "plan_returned":
        returned = ref.plan.returned_on if ref.plan else last_event_date(ref, "plan_returned")
        if returned is not None:
            n = (today - returned).days
            if n >= s["plan_not_acknowledged_days"]:
                out.append(_flag(
                    "plan_not_acknowledged", n,
                    f"Plan received {_plural(n, 'day')} ago — not yet reviewed by PCP",
                    "plan_not_acknowledged_days", "days", "pcp", failure=2, settings=s))

    elif stage == "declined":
        n = since("declined")
        if n is not None and ref.id not in set(rerouted_ids) and n >= s["declined_not_rerouted_days"]:
            out.append(_flag(
                "declined_not_rerouted", n,
                f"Declined {_plural(n, 'day')} ago — no new referral",
                "declined_not_rerouted_days", "days", "pcp", settings=s))

    if stage not in TERMINAL:
        for b in ref.barriers:
            if b.status != "open":
                continue
            n = (today - b.opened).days
            if n >= s["barrier_open_days"]:
                out.append(_flag(
                    "barrier_open", n,
                    f"{BARRIER_LABELS[b.type]} barrier open {_plural(n, 'day')}",
                    "barrier_open_days", "days", "patient", settings=s))
    return out


def needs_attention(referrals: list[Referral], today: date) -> list[dict]:
    """Stuck referrals sorted by days stuck (largest first), then ID."""
    rerouted = {r.replaces for r in referrals if r.replaces}
    rows = []
    for r in referrals:
        flags = stuck_flags(r, today, rerouted_ids=rerouted)
        if flags:
            rows.append({
                "referral_id": r.id,
                "stage": r.stage,
                "days_stuck": max(f.days for f in flags),
                "flags": [f.to_dict() for f in flags],
                "open_barriers": [b.type for b in r.barriers if b.status == "open"],
            })
    return sorted(rows, key=lambda x: (-x["days_stuck"], x["referral_id"]))
