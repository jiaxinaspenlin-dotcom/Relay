"""Facts: the only material drafts are built from (ai-guardrails.md).

Each fact has an ID (F1, F2, …), a label, a value string, and the numbers and dates that appear in
it. Verification checks every number and date in a draft sentence against its cited facts. No
patient name, DOB, or address is a fact; drafts use the [PATIENT] token instead.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date

from app.loop.states import STAGE_LABELS
from app.loop.stuck import BARRIER_LABELS, StuckFlag
from app.loop.timeline import last_event_date
from app.models import Referral

DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def dates_in(text: str) -> list[str]:
    return DATE_RE.findall(text)


def numbers_in(text: str) -> list[str]:
    """Numbers outside ISO dates."""
    return NUM_RE.findall(DATE_RE.sub(" ", text))


@dataclass
class Fact:
    id: str
    key: str
    label: str
    value: str
    source: str
    numbers: list[str] = field(default_factory=list)
    dates: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


ELAPSED_PHRASE = {
    "sent_no_response": "since sending",
    "accepted_no_appointment": "since acceptance",
    "appointment_not_confirmed": "since the appointment date",
    "no_show": "since the missed appointment",
    "seen_no_plan": "since the visit",
    "plan_not_acknowledged": "since the plan arrived",
    "declined_not_rerouted": "since the decline",
    "barrier_open": "since the barrier was noted",
}


def build_facts(ref: Referral, today: date, flag: StuckFlag | None = None) -> list[Fact]:
    raw: list[tuple[str, str, str, str]] = []  # key, label, value, source

    def add(key, label, value, source):
        raw.append((key, label, value, source))

    sent = last_event_date(ref, "sent")
    add("referral", "Referral", f"{ref.specialty} referral sent {sent.isoformat() if sent else 'not yet'}",
        "Referral timeline")
    add("performer", "Specialist practice", ref.performer.name, "Referral")
    add("reason", "Reason for referral (PCP's words)", ref.reason_text, "Referral")
    add("priority", "Priority (set by PCP)", ref.priority, "Referral")
    stage_date = ref.events[-1].at.isoformat() if ref.events else ""
    add("stage", "Current stage", f"{STAGE_LABELS[ref.stage]} on {stage_date}", "Referral timeline")
    if ref.appointment:
        add("appointment", "Appointment", f"Appointment on {ref.appointment.start.isoformat()}",
            "Referral timeline")
    declined_note = next((e.note for e in reversed(ref.events) if e.stage == "declined" and e.note), "")
    if declined_note:
        add("decline_note", "Office note on decline", declined_note, "Referral timeline")
    if ref.plan:
        add("plan_returned", "Plan received", ref.plan.returned_on.isoformat(), "Referral timeline")
    for b in ref.barriers:
        if b.status == "open":
            add(f"barrier_{b.type}", f"Open barrier: {BARRIER_LABELS[b.type]}",
                f"{BARRIER_LABELS[b.type]} barrier noted {b.opened.isoformat()}: {b.note}",
                "Barriers panel")
    if flag is not None:
        unit = "business days" if flag.unit == "business days" else "days"
        n = flag.days
        unit = unit[:-1] if n == 1 else unit
        add("elapsed", "Elapsed time",
            f"{n} {unit} {ELAPSED_PHRASE[flag.rule]}, as of {today.isoformat()}", "Demo clock")
    add("requester", "Referring practice",
        f"{ref.requester.coordinator}, {ref.requester.practice}", "Referral")

    out = []
    for i, (key, label, value, source) in enumerate(raw, 1):
        out.append(Fact(id=f"F{i}", key=key, label=label, value=value, source=source,
                        numbers=numbers_in(value), dates=dates_in(value)))
    return out
