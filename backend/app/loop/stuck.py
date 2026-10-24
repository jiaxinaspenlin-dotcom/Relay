"""Stuck rules (design.md §4). Thresholds are practice settings from config.PRACTICE_SETTINGS,
never clinical standards. A rule fires when elapsed time >= threshold, except authorization
pending, which fires when pending for MORE than its threshold.

Each flag has a long `message` (detail status line, drafts) and a short `status` (dashboard row),
plus the one `action` the dashboard row offers. Pure functions: pass `today` explicitly.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Iterable, Optional

from app.config import PRACTICE_SETTINGS
from app.dates import short
from app.loop.states import TERMINAL
from app.loop.timeline import first_event_date, last_event_date
from app.models import MASSHEALTH, MISSING_LABELS, Referral

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
    status: str  # short dashboard status, e.g. "Not scheduled, 14 days"
    setting_key: str
    threshold: int
    unit: str  # "days" or "business days"
    recipient: str  # who a follow-up goes to: specialist | patient | pcp | none
    action: str  # call_office | follow_up | send_records | message_patient | resend | open
    challenge_failure: Optional[int] = None  # 1 = never scheduled, 2 = plan never returned

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


def missing_text(items: Iterable[str]) -> str:
    labels = [MISSING_LABELS[i] for i in items]
    if len(labels) <= 1:
        return "".join(labels)
    return ", ".join(labels[:-1]) + " and " + labels[-1]


def stuck_flags(
    ref: Referral,
    today: date,
    *,
    rerouted_ids: Iterable[str] = (),
    coverage: Optional[str] = None,
    settings: Optional[dict[str, int]] = None,
) -> list[StuckFlag]:
    """All stuck rules that match `ref` on `today`. `coverage` is the patient's insurance type
    (needed for the MassHealth ride rule)."""
    s = settings or PRACTICE_SETTINGS
    out: list[StuckFlag] = []
    stage = ref.stage

    def flag(rule, days, message, status, key, unit, recipient, action, failure=None):
        out.append(StuckFlag(rule, days, message, status, key, s[key], unit, recipient, action, failure))

    if stage == "sent" and ref.office_not_received is not None:
        # The office said on a call that it never got the referral: resend now (replaces the
        # "not confirmed received" timer until the coordinator resends).
        how = ref.office_resend_method if ref.office_resend_method not in (None, "unknown") else ""
        n = (today - ref.office_not_received).days
        flag("office_not_received", n,
             "Office says the referral was not received" + (f", resend via {how}" if how else ", resend it"),
             "Office says not received", "office_not_received_days", "days", "specialist", "resend")
    elif stage == "sent":
        sent = last_event_date(ref, "sent")
        resent = [e.at for e in ref.events if e.kind == "resend"]
        if sent is not None and resent:
            sent = max(sent, max(resent))  # a resend restarts the receipt clock
        if sent is not None:
            n = business_days_between(sent, today)
            if n >= s["sent_no_receipt_business_days"]:
                flag("sent_no_receipt", n,
                     f"Sent {_plural(n, 'business day')} ago, not confirmed received",
                     f"Not confirmed received, {_plural(n, 'business day')}",
                     "sent_no_receipt_business_days", "business days", "specialist", "call_office")

    if stage == "received" and ref.receipt is not None and not ref.receipt.complete:
        since = last_event_date(ref, "received")
        n = (today - since).days if since else 0
        items = missing_text(ref.receipt.missing)
        if n >= s["received_incomplete_days"]:
            flag("received_incomplete", n, f"Received incomplete, missing {items}",
                 f"Missing {items}", "received_incomplete_days", "days", "specialist",
                 "send_records" if "records" in ref.receipt.missing else "follow_up")

    if stage in ("received", "patient_contacted"):
        got = first_event_date(ref, "received")
        if got is not None:
            n = (today - got).days
            if n >= s["not_scheduled_days"]:
                detail = ("patient not contacted" if stage == "received"
                          else "patient contacted but not scheduled")
                flag("not_scheduled", n, f"Received {_plural(n, 'day')} ago, {detail}",
                     f"Not scheduled, {_plural(n, 'day')}", "not_scheduled_days", "days",
                     "specialist" if stage == "received" else "patient",
                     "call_office" if stage == "received" else "message_patient", failure=1)

    if stage == "seen":
        seen = last_event_date(ref, "seen")
        if seen is not None:
            n = (today - seen).days
            if n >= s["seen_no_plan_days"]:
                flag("seen_no_plan", n, f"Seen {_plural(n, 'day')} ago, plan not received",
                     f"No plan back, {_plural(n, 'day')}", "seen_no_plan_days", "days",
                     "specialist", "follow_up", failure=2)

    if stage == "plan_returned":
        returned = ref.plan.returned_on if ref.plan else last_event_date(ref, "plan_returned")
        if returned is not None:
            n = (today - returned).days
            if n >= s["plan_not_acknowledged_days"]:
                flag("plan_not_acknowledged", n,
                     f"Plan received {_plural(n, 'day')} ago, not yet reviewed by PCP",
                     f"Plan not reviewed, {_plural(n, 'day')}", "plan_not_acknowledged_days",
                     "days", "pcp", "follow_up")

    if stage == "declined":
        dec = last_event_date(ref, "declined")
        if dec is not None and ref.id not in set(rerouted_ids):
            n = (today - dec).days
            if n >= s["declined_not_rerouted_days"]:
                flag("declined_not_rerouted", n, f"Declined {_plural(n, 'day')} ago, no new referral",
                     "Declined, not re-routed", "declined_not_rerouted_days", "days", "pcp", "follow_up")

    if stage == "no_show":
        appt = ref.appointment
        missed = appt.start if appt else last_event_date(ref, "no_show")
        if missed is not None:
            n = max((today - missed).days, 0)
            if n >= s["no_show_days"]:
                flag("no_show", n, f"Missed appointment on {short(missed)}", "Missed appointment",
                     "no_show_days", "days", "patient", "message_patient")

    if stage not in TERMINAL and ref.authorization == "pending" and ref.authorization_since:
        n = business_days_between(ref.authorization_since, today)
        if n > s["authorization_pending_business_days"]:
            flag("authorization_pending", n, f"Authorization pending for {_plural(n, 'business day')}",
                 f"Authorization pending, {_plural(n, 'business day')}",
                 "authorization_pending_business_days", "business days", "specialist", "follow_up")

    # MassHealth ride (PT-1): appointment within the lead time and no ride requested yet.
    # Applies when a transportation barrier is open, since not every member needs a ride.
    appt = ref.appointment
    transport_open = any(b.type == "transportation" and b.status == "open" for b in ref.barriers)
    if (stage == "scheduled" and appt is not None and appt.status == "booked" and coverage in MASSHEALTH
            and transport_open and ref.pt1_status == "not_started" and appt.start >= today):
        n = business_days_between(today, appt.start)
        if n <= s["pt1_lead_business_days"]:
            flag("pt1_not_requested", n,
                 f"Appointment on {short(appt.start)}, MassHealth ride (PT-1) not requested",
                 "Ride not requested", "pt1_lead_business_days", "business days", "none", "open")
    return out


def needs_attention(referrals: list[Referral], today: date,
                    coverage_by_patient: Optional[dict[str, str]] = None) -> list[dict]:
    """Stuck referrals: challenge failures first, then by days stuck (largest first), then ID."""
    rerouted = {r.replaces for r in referrals if r.replaces}
    cov = coverage_by_patient or {}
    rows = []
    for r in referrals:
        flags = stuck_flags(r, today, rerouted_ids=rerouted, coverage=cov.get(r.patient_id))
        if flags:
            rows.append({
                "referral_id": r.id,
                "stage": r.stage,
                "days_stuck": max(f.days for f in flags),
                "failure": any(f.challenge_failure for f in flags),
                "flags": [f.to_dict() for f in flags],
                "open_barriers": [b.type for b in r.barriers if b.status == "open"],
            })
    return sorted(rows, key=lambda x: (not x["failure"], -x["days_stuck"], x["referral_id"]))
