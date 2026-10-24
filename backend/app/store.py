"""In-memory demo state: referrals, patients, and the demo clock.

The clock starts at config.DEMO_TODAY and only moves when the "Demo clock" control moves it. No
code reads the real clock (see tests/test_repo_rules.py).
"""
from __future__ import annotations

from datetime import date, timedelta
from threading import Lock

from app.config import DEMO_TODAY
from app.models import Referral, load_patients, load_seed


class Store:
    def __init__(self) -> None:
        self._lock = Lock()
        self.reset()

    # ---- lifecycle
    def reset(self) -> None:
        """Reload the seed and reset the clock ("Reset demo")."""
        seed = load_seed()
        self.seed_meta = {k: v for k, v in seed.items() if k != "referrals"}
        self.referrals: dict[str, Referral] = {r.id: r for r in seed["referrals"]}
        self.patients: dict[str, dict] = load_patients()
        self.today: date = DEMO_TODAY

    # ---- clock
    def advance(self, days: int) -> date:
        if days < 0:
            raise ValueError("The demo clock only moves forward; use reset")
        self.today = self.today + timedelta(days=days)
        return self.today

    def reset_clock(self) -> date:
        self.today = DEMO_TODAY
        return self.today

    def clock(self) -> dict:
        return {"today": self.today.isoformat(), "base": DEMO_TODAY.isoformat(),
                "offset_days": (self.today - DEMO_TODAY).days}

    # ---- referrals
    def all(self) -> list[Referral]:
        return list(self.referrals.values())

    def get(self, rid: str) -> Referral:
        try:
            return self.referrals[rid]
        except KeyError:
            raise KeyError(f"No referral {rid}") from None

    def put(self, ref: Referral) -> Referral:
        with self._lock:
            self.referrals[ref.id] = ref
        return ref

    def next_id(self) -> str:
        with self._lock:
            nums = [int(r.split("-")[1]) for r in self.referrals if r.startswith("R-")]
            return f"R-{max(nums, default=100) + 1}"


store = Store()
