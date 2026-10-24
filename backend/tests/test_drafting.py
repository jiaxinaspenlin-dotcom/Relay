"""Template drafts: every sample stuck rule renders a draft that passes verification."""
from __future__ import annotations

from datetime import timedelta

import pytest

from app.drafting.draft import NotStuck, make_draft
from app.drafting.facts import ELAPSED_PHRASE, build_facts
from app.drafting.templates import NO_TEMPLATE, TEMPLATES, patient_message
from app.drafting.verify import verify
from app.loop.stuck import stuck_flags
from app.models import load_patients

from conftest import TODAY

PATIENTS = load_patients()
URL = "http://127.0.0.1:5173/office/abcDEF123_token"


def _cases(refs):
    for r in refs.values():
        cov = PATIENTS[r.patient_id]["coverage"]
        for d in range(15):
            day = TODAY + timedelta(days=d)
            for f in stuck_flags(r, day, coverage=cov):
                if f.rule not in NO_TEMPLATE:
                    yield r, day, f.rule


def test_every_rule_has_a_template():
    assert set(ELAPSED_PHRASE) - NO_TEMPLATE <= set(TEMPLATES)


def test_all_sample_drafts_verify(refs):
    seen = set()
    for r, day, rule in _cases(refs):
        d = make_draft(r, PATIENTS[r.patient_id], day, rule=rule, office_url=URL)
        assert d["verified"], (r.id, rule, d["problems"], d["text"])
        assert "[PATIENT]" not in d["text"]
        seen.add(rule)
    assert seen >= {"sent_no_receipt", "received_incomplete", "not_scheduled", "seen_no_plan",
                    "plan_not_acknowledged", "declined_not_rerouted", "no_show", "authorization_pending"}


def test_r102_draft_content(refs):
    d = make_draft(refs["R-102"], PATIENTS[refs["R-102"].patient_id], TODAY, office_url=URL)
    assert d["rule"] == "not_scheduled" and "14 days later" in d["text"]
    assert "transportation barrier" in d["text"] and URL in d["text"]


def test_patient_messages_address_the_patient(refs):
    for r, day, rule in _cases(refs):
        d = make_draft(r, PATIENTS[r.patient_id], day, rule=rule)
        if d["recipient"] == "patient":
            assert "the patient" not in d["text"].lower(), d["text"]


def test_patient_next_step_message(refs):
    m = patient_message(refs["R-102"], PATIENTS[refs["R-102"].patient_id])
    assert "Your referral to Pioneer Valley Heart Associates was received. Please call 413-555-0142 to schedule." in m["text"]
    assert m["needs_phone"] is False


def test_verify_catches_basic_errors(refs):
    r = refs["R-102"]
    flag = stuck_flags(r, TODAY)[0]
    facts = build_facts(r, TODAY, flag)
    eid = next(f.id for f in facts if f.key == "elapsed")
    assert verify(f"Received 13 days ago. [{eid}]", facts)
    assert verify("Some uncited sentence.", facts)
    assert verify("Seen on 2026-01-01. [F1]", facts)
    assert verify("Fine. [F99]", facts)
    assert verify("We recommend a visit. [F1]", facts)
    assert verify("Your appointment is booked. [F1]", facts)


def test_not_stuck(refs):
    with pytest.raises(NotStuck):
        make_draft(refs["R-106"], PATIENTS[refs["R-106"].patient_id], TODAY)
