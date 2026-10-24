"""Referral loop states and transitions (design.md §3).

How U.S. referrals actually move: the referral is sent as paperwork; the specialist office
confirms receipt (complete, or missing items); then the office and the patient arrange the
visit (the office calls, or tells the patient to call); then the visit, the plan back, and the
PCP closes the loop. Authorization is a per-referral field, not a stage.

Modeled on HL7 BSeR's ServiceRequest + Task pattern: `Task.status` uses FHIR codes and
`Task.businessStatus` uses a local code. Pure functions: `transition` returns a new Referral.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.loop.timeline import make_event
from app.models import Actor, Appointment, Closure, Plan, Receipt, Referral

# stage -> (Task.status, Task.businessStatus). "received" refines its businessStatus by
# completeness (see task_codes).
STAGES: dict[str, tuple[str, str]] = {
    "draft": ("draft", "draft"),
    "sent": ("requested", "sent"),
    "received": ("received", "received-complete"),
    "patient_contacted": ("accepted", "patient-contacted"),
    "scheduled": ("in-progress", "scheduled"),
    "no_show": ("in-progress", "no-show"),
    "seen": ("in-progress", "visit-completed"),
    "plan_returned": ("completed", "plan-returned"),
    "closed": ("completed", "closed-by-referrer"),
    "declined": ("rejected", "declined"),
    "patient_barrier": ("on-hold", "patient-barrier"),
    "cancelled": ("cancelled", "cancelled"),
}

STAGE_LABELS: dict[str, str] = {
    "draft": "Draft",
    "sent": "Sent",
    "received": "Received",
    "patient_contacted": "Patient contacted",
    "scheduled": "Scheduled",
    "no_show": "No-show",
    "seen": "Seen",
    "plan_returned": "Plan returned",
    "closed": "Closed",
    "declined": "Declined",
    "patient_barrier": "Patient barrier",
    "cancelled": "Cancelled",
}

# Static transitions. "patient_barrier" returns to the stage it was entered from.
# "received" → "received" updates completeness (missing items supplied, or something new missing).
# "declined" has no next stage: re-routing creates a new referral with `replaces` set.
ALLOWED: dict[str, tuple[str, ...]] = {
    "draft": ("sent", "cancelled"),
    "sent": ("received", "declined", "cancelled"),
    "received": ("received", "patient_contacted", "scheduled", "declined", "patient_barrier", "cancelled"),
    "patient_contacted": ("scheduled", "patient_barrier", "cancelled"),
    "scheduled": ("scheduled", "seen", "no_show", "patient_barrier", "cancelled"),
    "no_show": ("patient_contacted", "scheduled", "patient_barrier", "cancelled"),
    "seen": ("plan_returned",),
    "plan_returned": ("closed",),
    "closed": (),
    "declined": (),
    "patient_barrier": (),  # dynamic: previous stage
    "cancelled": (),
}

TERMINAL = frozenset({"closed", "cancelled", "declined"})
CANCEL_REASONS = frozenset({"patient_declined", "referred_elsewhere", "cancelled"})


class InvalidTransition(ValueError):
    """Raised when a requested stage change is not allowed by design.md §3."""


def task_codes(ref: Referral, stage: str) -> tuple[str, str]:
    status, business = STAGES[stage]
    if stage == "received" and ref.receipt is not None and not ref.receipt.complete:
        business = "received-incomplete"
    return status, business


def previous_stage(ref: Referral) -> Optional[str]:
    """The stage a referral was in before it most recently entered 'patient_barrier'."""
    stage_events = [e for e in ref.events if e.kind == "stage"]
    for i in range(len(stage_events) - 1, -1, -1):
        if stage_events[i].stage == "patient_barrier":
            for j in range(i - 1, -1, -1):
                if stage_events[j].stage != "patient_barrier":
                    return stage_events[j].stage
            return None
    return None


def allowed_next(ref: Referral) -> tuple[str, ...]:
    if ref.stage == "patient_barrier":
        prev = previous_stage(ref)
        return (prev,) if prev else ()
    return ALLOWED.get(ref.stage, ())


def _check_date(ref: Referral, at: date) -> None:
    if ref.events and at < ref.events[-1].at:
        raise InvalidTransition(f"Event date {at} is before the last event ({ref.events[-1].at})")


def transition(
    ref: Referral,
    to: str,
    *,
    at: date,
    actor: Actor,
    by: str = "",
    note: str = "",
    source: Optional[str] = None,
    appointment_start: Optional[date] = None,
    appointment_time: Optional[str] = None,
    plan: Optional[Plan] = None,
    receipt: Optional[Receipt] = None,
    contact_mode: Optional[str] = None,
    closure_reason: Optional[str] = None,
) -> Referral:
    """Return a copy of `ref` moved to stage `to`, with a dated event appended.

    Raises InvalidTransition for any change not in the transitions table, or when the data a
    stage needs (receipt, appointment date, returned plan, closure reason) is missing.
    """
    if to not in STAGES:
        raise InvalidTransition(f"Unknown stage '{to}'")
    allowed = allowed_next(ref)
    if to not in allowed:
        raise InvalidTransition(
            f"{STAGE_LABELS.get(ref.stage, ref.stage)} to {STAGE_LABELS[to]} is not allowed "
            f"(allowed: {', '.join(STAGE_LABELS[s] for s in allowed) or 'none'})"
        )
    _check_date(ref, at)
    new = ref.model_copy(deep=True)

    if to == "received":
        if receipt is None:
            raise InvalidTransition("Receipt needs complete or the missing items")
        if not receipt.complete and not receipt.missing:
            raise InvalidTransition("An incomplete receipt needs at least one missing item")
        new.receipt = receipt
    elif to == "patient_contacted":
        if contact_mode not in ("office_called", "patient_told_to_call"):
            raise InvalidTransition("Patient contact needs: office called, or patient told to call")
        new.contact_mode = contact_mode
    elif to == "scheduled":
        if appointment_start is None:
            raise InvalidTransition("Scheduling needs an appointment date")
        new.appointment = Appointment(start=appointment_start, time=appointment_time, status="booked")
    elif to == "seen":
        if new.appointment is None:
            raise InvalidTransition("Mark the appointment as scheduled before marking it seen")
        new.appointment.status = "fulfilled"
    elif to == "no_show":
        if new.appointment is None:
            raise InvalidTransition("A no-show needs a scheduled appointment")
        new.appointment.status = "noshow"
    elif to == "plan_returned":
        if plan is None:
            raise InvalidTransition("Returning a plan needs the plan content")
        new.plan = plan
    elif to == "declined":
        if not note.strip():
            raise InvalidTransition("Declining needs a reason")
    elif to == "closed":
        if new.plan is None:
            raise InvalidTransition("Closing needs a returned plan, or cancel with a closure reason")
        new.closure = Closure(at=at, by=by or actor, reason="plan_received", note=note)
    elif to == "cancelled":
        if closure_reason not in CANCEL_REASONS:
            raise InvalidTransition(f"Cancelling needs a closure reason: {', '.join(sorted(CANCEL_REASONS))}")
        new.closure = Closure(at=at, by=by or actor, reason=closure_reason, note=note)
        if new.appointment is not None and new.appointment.status == "booked":
            new.appointment.status = "cancelled"

    new.stage = to
    new.task_status, new.business_status = task_codes(new, to)
    new.events.append(make_event(to, at, actor, note, source))
    return new


def record_field_update(ref: Referral, kind: str, *, at: date, actor: Actor, note: str,
                        source: Optional[str] = None) -> Referral:
    """Append a non-stage event (authorization, barrier, transport, phone). Stage is unchanged."""
    _check_date(ref, at)
    new = ref.model_copy(deep=True)
    ev = make_event(ref.stage, at, actor, note, source)
    ev.kind = kind
    new.events.append(ev)
    return new
