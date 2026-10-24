"""App configuration: paths, the clock source, and practice settings for stuck rules.

This is the only module allowed to read the real clock (tests/test_repo_rules.py).
"""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PUBLIC = ROOT / "data" / "public"
DATA_SYNTHETIC = ROOT / "data" / "synthetic"

# SQLite file. One file, created on first start. Override with RELAY_DB=/path/to/file.db.
DB_PATH = Path(os.environ.get("RELAY_DB", str(ROOT / "data" / "relay.db")))

# The date the sample data (referrals.json) was written for. Loading sample data shifts every
# sample date by (today - SAMPLE_BASE_DATE) so "days stuck" reads the same on any day.
SAMPLE_BASE_DATE: date = date(2026, 10, 24)
# Kept for scripts/build_mocks.py and archetype tests, which use the sample base date.
DEMO_TODAY: date = date.fromisoformat(os.environ.get("DEMO_TODAY", SAMPLE_BASE_DATE.isoformat()))


def real_today() -> date:
    """The real local date. Everything else goes through app.clock.today()."""
    return date.today()


# Stuck-rule thresholds. These are PRACTICE SETTINGS chosen by the practice, not clinical standards.
# The UI must label them "Practice setting".
PRACTICE_SETTINGS: dict[str, int] = {
    "sent_no_response_business_days": 3,
    "accepted_no_appointment_days": 7,
    "appointment_not_confirmed_days": 2,
    "no_show_days": 0,  # immediate
    "seen_no_plan_days": 7,
    "plan_not_acknowledged_days": 3,
    "declined_not_rerouted_days": 2,
    "barrier_open_days": 7,
}

# Finder: the exact CMS `pri_spec` strings for the four supported specialties (design.md §5).
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
