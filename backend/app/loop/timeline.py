"""Timeline helpers: event creation and lookups by stage."""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.models import Actor, Event, Referral


def make_event(stage: str, at: date, actor: Actor, note: str = "", source=None) -> Event:
    return Event(stage=stage, at=at, actor=actor, note=note, source=source)


def last_event_date(ref: Referral, stage: str) -> Optional[date]:
    """Date of the most recent event for `stage`, or None."""
    for ev in reversed(ref.events):
        if ev.stage == stage:
            return ev.at
    return None


def first_event_date(ref: Referral, stage: str) -> Optional[date]:
    for ev in ref.events:
        if ev.stage == stage:
            return ev.at
    return None


def timeline(ref: Referral) -> list[dict]:
    """Events and sent communications merged in date order (stable: events first on ties)."""
    items = [
        {"kind": "event", "at": ev.at, "stage": ev.stage, "actor": ev.actor, "note": ev.note,
         "source": ev.source}
        for ev in ref.events
    ]
    items += [
        {"kind": "communication", "at": c.sent, "id": c.id, "recipient": c.recipient,
         "sent_by": c.sent_by, "text": c.text, "ai_drafted": c.ai_drafted, "rule": c.rule,
         "edited": c.edited, "channel": c.channel, "message_kind": c.kind}
        for c in ref.communications
    ]
    return sorted(items, key=lambda x: (x["at"], 0 if x["kind"] == "event" else 1))
