"""App configuration: fixed demo clock, data paths, and practice settings for stuck rules."""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PUBLIC = ROOT / "data" / "public"
DATA_SYNTHETIC = ROOT / "data" / "synthetic"

# Fixed clock so "days stuck" is reproducible. Override with DEMO_TODAY=YYYY-MM-DD.
DEMO_TODAY: date = date.fromisoformat(os.environ.get("DEMO_TODAY", "2026-10-24"))

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

# Finder: the exact CMS `pri_spec` strings for the four demo specialties (design.md §5).
FINDER_SPECIALTIES: dict[str, str] = {
    "Cardiology": "CARDIOVASCULAR DISEASE (CARDIOLOGY)",
    "Endocrinology": "ENDOCRINOLOGY",
    "Gastroenterology": "GASTROENTEROLOGY",
    "Nephrology": "NEPHROLOGY",
}
