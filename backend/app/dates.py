"""Date display. UI shows "Oct 15"; text that leaves Relay shows "Oct 15, 2026"."""
from __future__ import annotations

from datetime import date


def short(d: date) -> str:
    return f"{d:%b} {d.day}"


def long(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"
