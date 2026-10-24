#!/usr/bin/env python3
"""Write frontend mock fixtures (task 1.6) from data/synthetic/referrals.json using the same view
functions the API uses, so the shapes match.

    .venv/bin/python scripts/build_mocks.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.config import DEMO_TODAY, FINDER_SPECIALTIES  # noqa: E402
from app.finder.rank import find  # noqa: E402
from app.models import load_patients, load_seed  # noqa: E402
from app.views import dashboard_view, referral_detail_view  # noqa: E402

OUT = ROOT / "frontend" / "src" / "mock"


def write(name: str, obj) -> None:
    path = OUT / name
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    seed = load_seed()
    refs = seed["referrals"]
    patients = load_patients()
    write("dashboard.json", dashboard_view(refs, patients, DEMO_TODAY))
    write("referrals.json", {r.id: referral_detail_view(r, refs, patients, DEMO_TODAY) for r in refs})
    live = patients[seed["live_demo_patient"]]
    write("finder.json", {
        "live_demo_patient": {k: live[k] for k in ("id", "synthetic_name", "town", "payer", "specialty")},
        "results": {s: find(s, live["town"], payer=live["payer"], limit=10) for s in FINDER_SPECIALTIES},
    })


if __name__ == "__main__":
    main()
