"""Referral loop states and transitions (design.md §3).

Modeled on HL7 BSeR's ServiceRequest + Task pattern: `Task.status` uses FHIR codes and
`Task.businessStatus` uses a local code for the finer stage. Pure functions: `transition` returns a
new Referral and never mutates its input.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.loop.timeline import make_event
from app.models import Actor, Appointment, Closure, Plan, Referral

# stage -> (Task.status, Task.businessStatus)
STAGES: dict[str, tuple[str, str]] = {
    "draft": ("draft", "draft"),
    "sent": ("requested", "sent"),
    "accepted": ("accepted", "accepted"),
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
    "accepted": "Accepted",
    "scheduled": "Scheduled",
    "no_show": "No-show",
    "seen": "Seen",
    "plan_returned": "Plan returned",
    "closed": "Closed",
    "declined": "Declined",
    "patient_barrier": "Patient barrier",
    "cancelled": "Cancelled",
}

# Static transitions. "patient_barrier" returns to the stage it was entered from (see allowed_next).
# "declined" has no next stage: re-routing creates a new referral with `replaces` set.
ALLOWED: dict[str, tuple[str, ...]] = {
    "draft": ("sent", "cancelled"),
    "sent": ("accepted", "declined", "cancelled"),
    "accepted": ("scheduled", "patient_barrier", "cancelled"),
    "scheduled": ("seen", "no_show", "patient_barrier", "cancelled"),
    "no_show": ("scheduled", "patient_barrier", "cancelled"),
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


def previous_stage(ref: Referral) -> Optional[str]:
    """The stage a referral was in before it most recently entered 'patient_barrier'."""
    events = ref.events
    for i in range(len(events) - 1, -1, -1):
        if events[i].stage == "patient_barrier":
            for j in range(i - 1, -1, -1):
                if events[j].stage != "patient_barrier":
                    return events[j].stage
            return None
    return None


def allowed_next(ref: Referral) -> tuple[str, ...]:
    if ref.stage == "patient_barrier":
        prev = previous_stage(ref)
        return (prev,) if prev else ()
    return ALLOWED.get(ref.stage, ())


def transition(
    ref: Referral,
    to: str,
    *,
    at: date,
    actor: Actor,
    by: str = "",
    note: str = "",
    appointment_start: Optional[date] = None,
    plan: Optional[Plan] = None,
    closure_reason: Optional[str] = None,
) -> Referral:
    """Return a copy of `ref` moved to stage `to`, with a timestamped event appended.

    Raises InvalidTransition for any change not in the transitions table, or when the data a stage
    needs (appointment date, returned plan, closure reason) is missing.
    """
    if to not in STAGES:
        raise InvalidTransition(f"Unknown stage '{to}'")
    allowed = allowed_next(ref)
    if to not in allowed:
        raise InvalidTransition(
            f"{STAGE_LABELS.get(ref.stage, ref.stage)} → {STAGE_LABELS[to]} is not allowed "
            f"(allowed: {', '.join(STAGE_LABELS[s] for s in allowed) or 'none'})"
        )
    if ref.events and at < ref.events[-1].at:
        raise InvalidTransition(f"Event date {at} is before the last event ({ref.events[-1].at})")

    new = ref.model_copy(deep=True)

    if to == "scheduled":
        if appointment_start is None:
            raise InvalidTransition("Scheduling needs an appointment date")
        new.appointment = Appointment(start=appointment_start, status="booked")
    elif to == "seen":
        if new.appointment is None:
            raise InvalidTransition("Cannot mark seen without an appointment")
        new.appointment.status = "fulfilled"
    elif to == "no_show":
        if new.appointment is None:
            raise InvalidTransition("Cannot mark no-show without an appointment")
        new.appointment.status = "noshow"
    elif to == "plan_returned":
        if plan is None:
            raise InvalidTransition("Returning a plan needs the plan content")
        new.plan = plan
    elif to == "closed":
        # R8.3: closing requires a returned plan. Other endings go through 'cancelled' with a reason.
        if new.plan is None:
            raise InvalidTransition("Closing needs a returned plan, or cancel with a closure reason")
        new.closure = Closure(at=at, by=by or actor, reason="plan_received", note=note)
    elif to == "cancelled":
        if closure_reason not in CANCEL_REASONS:
            raise InvalidTransition(
                f"Cancelling needs a closure reason: {', '.join(sorted(CANCEL_REASONS))}"
            )
        new.closure = Closure(at=at, by=by or actor, reason=closure_reason, note=note)
        if new.appointment is not None and new.appointment.status == "booked":
            new.appointment.status = "cancelled"

    new.stage = to
    new.task_status, new.business_status = STAGES[to]
    new.events.append(make_event(to, at, actor, note))
    return new
