"""Date display. UI shows "Oct 15"; text that leaves Relay shows "Oct 15, 2026"."""
from __future__ import annotations

from datetime import date


def short(d: date) -> str:
    return f"{d:%b} {d.day}"


def long(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"


def time12(hhmm: str | None) -> str:
    """"14:30" → "2:30 PM"."""
    if not hhmm:
        return ""
    h, m = (int(x) for x in hhmm.split(":"))
    return f"{(h + 11) % 12 + 1}:{m:02d} {'PM' if h >= 12 else 'AM'}"
