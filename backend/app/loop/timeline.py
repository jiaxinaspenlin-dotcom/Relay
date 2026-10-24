"""Timeline helpers: event creation and lookups by stage."""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.models import Actor, Event, Referral


def make_event(stage: str, at: date, actor: Actor, note: str = "", source=None, by: str = "",
               user_id: str = "") -> Event:
    return Event(stage=stage, at=at, actor=actor, note=note, source=source, by=by, user_id=user_id)


def _stage_events(ref: Referral) -> list[Event]:
    return [e for e in ref.events if e.kind == "stage"]


def last_event_date(ref: Referral, stage: str) -> Optional[date]:
    """Date of the most recent stage event for `stage`, or None."""
    for ev in reversed(_stage_events(ref)):
        if ev.stage == stage:
            return ev.at
    return None


def first_event_date(ref: Referral, stage: str) -> Optional[date]:
    for ev in _stage_events(ref):
        if ev.stage == stage:
            return ev.at
    return None


def stage_entered(ref: Referral) -> Optional[date]:
    """When the referral entered its current stage (first event of the current run of that stage)."""
    evs = _stage_events(ref)
    if not evs:
        return None
    i = len(evs) - 1
    while i > 0 and evs[i - 1].stage == evs[-1].stage:
        i -= 1
    return evs[i].at


def timeline(ref: Referral) -> list[dict]:
    """Events and sent communications merged in date order (stable: events first on ties)."""
    items = [
        {"kind": "event", "event_kind": ev.kind, "at": ev.at, "stage": ev.stage, "actor": ev.actor,
         "note": ev.note, "source": ev.source, "by": ev.by,
         "call_duration": ev.call_duration}
        for ev in ref.events
    ]
    items += [
        {"kind": "communication", "at": c.sent, "id": c.id, "recipient": c.recipient,
         "sent_by": c.sent_by, "text": c.text, "ai_drafted": c.ai_drafted, "rule": c.rule,
         "edited": c.edited, "channel": c.channel, "message_kind": c.kind}
        for c in ref.communications
    ]
    return sorted(items, key=lambda x: (x["at"], 0 if x["kind"] == "event" else 1))
