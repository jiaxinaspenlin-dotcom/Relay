from __future__ import annotations

from datetime import date

import pytest

from app.models import load_seed

TODAY = date(2026, 10, 24)


@pytest.fixture(scope="session")
def seed() -> dict:
    return load_seed()


@pytest.fixture()
def refs(seed) -> dict:
    """Fresh deep copies so tests can't leak state into each other."""
    return {r.id: r.model_copy(deep=True) for r in seed["referrals"]}
