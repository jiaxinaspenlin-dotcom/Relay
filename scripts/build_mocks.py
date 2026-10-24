#!/usr/bin/env python3
"""Write frontend design fixtures (frontend/src/mock/*.json) from the sample data, using the same
view functions as the API. Screens must not import these (tests/test_repo_rules.py); they are for
offline design work only.

    .venv/bin/python scripts/build_mocks.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.config import FINDER_SPECIALTIES, SAMPLE_BASE_DATE  # noqa: E402
from app.db import Repo  # noqa: E402
from app.finder.rank import find  # noqa: E402
from app.views import dashboard_view, referral_detail_view  # noqa: E402

OUT = ROOT / "frontend" / "src" / "mock"


def write(name: str, obj) -> None:
    path = OUT / name
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    repo = Repo(":memory:")
    repo.load_sample(SAMPLE_BASE_DATE)
    refs, patients = repo.all(), repo.patients()
    write("dashboard.json", dashboard_view(refs, patients, SAMPLE_BASE_DATE))
    write("referrals.json", {r.id: referral_detail_view(r, refs, patients, SAMPLE_BASE_DATE) for r in refs})
    live = next(p for p in patients.values() if p["town"] == "North Adams")
    write("finder.json", {s: find(s, live["town"], coverage=live["coverage"]) for s in FINDER_SPECIALTIES})


if __name__ == "__main__":
    main()
