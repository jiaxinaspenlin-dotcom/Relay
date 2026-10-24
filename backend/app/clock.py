"""The app's notion of "today".

Real mode (default): the real local date from config.real_today().
Demo mode (Settings → Demo mode): real date + a forward offset in days, so a demo can simulate time
passing without ever moving behind the real date (which would back-date events).
"""
from __future__ import annotations

from datetime import date, timedelta

from app import config
from app.db import Repo


def today(repo: Repo) -> date:
    base = config.real_today()
    if repo.setting("demo_mode"):
        return base + timedelta(days=int(repo.setting("demo_offset_days") or 0))
    return base


def info(repo: Repo) -> dict:
    demo = bool(repo.setting("demo_mode"))
    offset = int(repo.setting("demo_offset_days") or 0) if demo else 0
    return {"today": today(repo).isoformat(), "real_today": config.real_today().isoformat(),
            "demo_mode": demo, "offset_days": offset}


def set_demo_mode(repo: Repo, on: bool) -> dict:
    repo.set_setting("demo_mode", bool(on))
    if not on:
        repo.set_setting("demo_offset_days", 0)
    return info(repo)


def advance(repo: Repo, days: int) -> dict:
    if not repo.setting("demo_mode"):
        raise ValueError("Turn on Demo mode in Settings to simulate time passing")
    if days not in (1, 7):
        raise ValueError("Advance by 1 or 7 days")
    repo.set_setting("demo_offset_days", int(repo.setting("demo_offset_days") or 0) + days)
    return info(repo)


def reset(repo: Repo) -> dict:
    repo.set_setting("demo_offset_days", 0)
    return info(repo)
