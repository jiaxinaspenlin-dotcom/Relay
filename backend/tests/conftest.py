from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import config
from app.db import Repo
from app.models import load_seed
from app.store import set_repo

TODAY = date(2026, 10, 24)

COORD = {"name": "Casey Reed", "email": "casey@example.test", "role": "coordinator", "password": "coord-pass-1"}
CLIN = {"name": "Dr. Jo Park", "email": "jo@example.test", "role": "clinician", "password": "clin-pass-1"}


@pytest.fixture(autouse=True)
def no_real_phone_calls(monkeypatch):
    """Tests never place a real call or reach ElevenLabs: the poller is off and both network
    functions fail loudly unless a test replaces them."""
    from app.call import phone
    monkeypatch.setattr(phone, "POLLER_ENABLED", False)
    def blocked(*a, **k):
        raise AssertionError("a test tried to reach ElevenLabs")
    monkeypatch.setattr(phone, "_post", blocked)
    monkeypatch.setattr(phone, "fetch_conversation", blocked)


@pytest.fixture(scope="session")
def seed() -> dict:
    """Sample archetypes as of the fixed test date (sample dates are offsets from load time)."""
    return load_seed(TODAY)


@pytest.fixture()
def refs(seed) -> dict:
    """Fresh deep copies of the sample archetypes so tests can't leak state into each other."""
    return {r.id: r.model_copy(deep=True) for r in seed["referrals"]}


@pytest.fixture()
def real_today(monkeypatch):
    """Injected test clock: pins config.real_today for API tests. Returns a setter to move it.
    This is the only way tests move time; the app itself always uses the real date."""
    state = {"today": TODAY}
    monkeypatch.setattr(config, "real_today", lambda: state["today"])

    def set_today(d: date) -> None:
        state["today"] = d
    return set_today


@pytest.fixture()
def repo(real_today) -> Repo:
    r = Repo(":memory:")
    for u in (COORD, CLIN):
        r.users.create(name=u["name"], email=u["email"], role=u["role"], practice="Test Family Practice",
                       password=u["password"])
    set_repo(r)
    yield r
    set_repo(None)


def signed_in(account: dict) -> TestClient:
    from app.main import app
    c = TestClient(app)
    r = c.post("/api/auth/sign-in", json={"email": account["email"], "password": account["password"]})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture()
def client(repo) -> TestClient:
    """Signed in as a coordinator."""
    return signed_in(COORD)


@pytest.fixture()
def clinician(repo) -> TestClient:
    """Signed in as a clinician (only clinicians can acknowledge and close)."""
    return signed_in(CLIN)


@pytest.fixture()
def anon(repo) -> TestClient:
    from app.main import app
    return TestClient(app)
