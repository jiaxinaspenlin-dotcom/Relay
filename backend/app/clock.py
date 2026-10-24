"""The app's notion of "today": always the real local date (config.real_today()).

There is no demo or simulated clock. Tests inject a fixed date by patching config.real_today.
"""
from __future__ import annotations

from datetime import date

from app import config


def today(repo=None) -> date:  # repo kept for call-site compatibility
    return config.real_today()


def info(repo=None) -> dict:
    return {"today": today().isoformat()}
