"""View shapes used by the API and by frontend mocks."""
from __future__ import annotations

import json

from app.models import load_patients
from app.views import dashboard_view, referral_detail_view

from conftest import TODAY


def test_dashboard_view(refs):
    v = dashboard_view(list(refs.values()), load_patients(), TODAY)
    json.dumps(v)
    assert v["synthetic"] is True
    top = v["needs_attention"][0]
    assert top["referral_id"] == "R-102"
    assert top["card"]["stuck"][0]["message"] == "Accepted 14 days ago — no appointment yet"
    assert top["card"]["miles"] is not None
    assert v["practice_settings"]["label"] == "Practice setting"


def test_detail_view_for_every_referral(refs):
    patients = load_patients()
    for r in refs.values():
        v = referral_detail_view(r, list(refs.values()), patients, TODAY)
        json.dumps(v)
        assert [s["stage"] for s in v["card"]["stepper"]][0] == "sent"
        assert v["place_context"]["town"] == r.patient_town
        assert len(v["timeline"]) == len(r.events)
