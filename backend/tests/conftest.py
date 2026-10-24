from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import config
from app.db import Repo
from app.models import load_seed
from app.store import set_repo

TODAY = date(2026, 10, 24)


@pytest.fixture(scope="session")
def seed() -> dict:
    return load_seed()


@pytest.fixture()
def refs(seed) -> dict:
    """Fresh deep copies of the sample archetypes so tests can't leak state into each other."""
    return {r.id: r.model_copy(deep=True) for r in seed["referrals"]}


@pytest.fixture()
def real_today(monkeypatch):
    """Pin the 'real' clock for API tests. Returns a setter to move it."""
    state = {"today": TODAY}
    monkeypatch.setattr(config, "real_today", lambda: state["today"])

    def set_today(d: date) -> None:
        state["today"] = d
    return set_today


@pytest.fixture()
def repo(real_today) -> Repo:
    r = Repo(":memory:")
    set_repo(r)
    yield r
    set_repo(None)


@pytest.fixture()
def client(repo) -> TestClient:
    from app.main import app
    return TestClient(app)
