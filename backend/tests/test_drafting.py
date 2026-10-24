"""Template drafts: every seeded stuck rule renders a draft that passes verification.
(Adversarial verify cases are task 3.2 / test_verify.py.)"""
from __future__ import annotations

from datetime import timedelta

import pytest

from app.drafting.draft import NotStuck, make_draft
from app.drafting.facts import build_facts
from app.drafting.templates import TEMPLATES
from app.drafting.verify import verify
from app.loop.stuck import stuck_flags
from app.models import load_patients

from conftest import TODAY

PATIENTS = load_patients()


def _all_flag_cases(refs):
    """Every (referral, day, rule) that fires within 14 days of the demo date."""
    for r in refs.values():
        for d in range(15):
            day = TODAY + timedelta(days=d)
            for f in stuck_flags(r, day):
                yield r, day, f.rule


def test_every_rule_has_a_template():
    from app.drafting.facts import ELAPSED_PHRASE
    assert set(TEMPLATES) == set(ELAPSED_PHRASE)


def test_all_seed_drafts_verify(refs):
    seen = set()
    for r, day, rule in _all_flag_cases(refs):
        d = make_draft(r, PATIENTS[r.patient_id], day, rule=rule)
        assert d["verified"], (r.id, rule, d["problems"], d["text"])
        assert "[PATIENT]" not in d["text"]
        seen.add(rule)
    assert seen >= {"sent_no_response", "accepted_no_appointment", "appointment_not_confirmed",
                    "no_show", "seen_no_plan", "plan_not_acknowledged", "declined_not_rerouted",
                    "barrier_open"}


def test_r102_draft_content(refs):
    d = make_draft(refs["R-102"], PATIENTS[refs["R-102"].patient_id], TODAY)
    assert "14 days after acceptance" in d["text"]
    assert "transportation barrier" in d["text"]
    assert d["text"].count("[F") >= 4


def test_verify_catches_basic_errors(refs):
    r = refs["R-102"]
    flag = stuck_flags(r, TODAY)[0]
    facts = build_facts(r, TODAY, flag)
    assert verify("Accepted 13 days ago. [F5]", facts)  # wrong number
    assert verify("Some uncited sentence.", facts)
    assert verify("Seen on 2026-01-01. [F1]", facts)  # invented date
    assert verify("Fine. [F99]", facts)
    assert verify("We recommend a visit. [F1]", facts)  # copy guard


def test_patient_messages_address_the_patient(refs):
    for r, day, rule in _all_flag_cases(refs):
        d = make_draft(r, PATIENTS[r.patient_id], day, rule=rule)
        if d["recipient"] == "patient":
            assert "the patient" not in d["text"].lower(), d["text"]


def test_not_stuck(refs):
    with pytest.raises(NotStuck):
        make_draft(refs["R-103"], PATIENTS[refs["R-103"].patient_id], TODAY)
