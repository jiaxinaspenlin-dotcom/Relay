"""App configuration: paths, the clock source, practice settings, and optional voice settings.

This is the only module allowed to read the real clock (tests/test_repo_rules.py).
"""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PUBLIC = ROOT / "data" / "public"
DATA_SYNTHETIC = ROOT / "data" / "synthetic"

try:  # .env holds ELEVENLABS_* and LLM keys; never logged.
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:  # pragma: no cover
    pass

# SQLite file. One file, created on first start. Override with RELAY_DB=/path/to/file.db.
DB_PATH = Path(os.environ.get("RELAY_DB", str(ROOT / "data" / "relay.db")))

# The date the sample data (referrals.json) was written for. Loading sample data shifts every
# sample date by (today - SAMPLE_BASE_DATE) so "days stuck" reads the same on any day.
SAMPLE_BASE_DATE: date = date(2026, 10, 24)
DEMO_TODAY: date = date.fromisoformat(os.environ.get("DEMO_TODAY", SAMPLE_BASE_DATE.isoformat()))


def real_today() -> date:
    """The real local date. Everything else goes through app.clock.today()."""
    return date.today()


# Stuck-rule thresholds. PRACTICE SETTINGS chosen by the practice, not clinical standards.
PRACTICE_SETTINGS: dict[str, int] = {
    "sent_no_receipt_business_days": 2,
    "received_incomplete_days": 0,  # immediate
    "authorization_pending_business_days": 5,  # fires when pending for MORE than this
    "not_scheduled_days": 7,
    "seen_no_plan_days": 7,
    "plan_not_acknowledged_days": 3,
    "declined_not_rerouted_days": 2,
    "no_show_days": 0,  # immediate
    "pt1_lead_business_days": 3,
}

FINDER_SPECIALTIES: dict[str, str] = {
    "Cardiology": "CARDIOVASCULAR DISEASE (CARDIOLOGY)",
    "Endocrinology": "ENDOCRINOLOGY",
    "Gastroenterology": "GASTROENTEROLOGY",
    "Nephrology": "NEPHROLOGY",
}

DEFAULT_PRACTICE = {
    "practice": "Your practice",
    "clinician": "Referring clinician",
    "coordinator": "Referral coordinator",
}


def voice_settings() -> dict:
    """ElevenLabs agent settings from the environment. Values are secrets: never log them."""
    return {"api_key": os.environ.get("ELEVENLABS_API_KEY", ""),
            "agent_id": os.environ.get("ELEVENLABS_AGENT_ID", "")}


def voice_enabled() -> bool:
    v = voice_settings()
    return bool(v["api_key"] and v["agent_id"])
