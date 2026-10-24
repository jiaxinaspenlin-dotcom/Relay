"""Loop states, transitions, event logging, stuck rules, and dashboard aggregates."""
from __future__ import annotations

import sys
from datetime import date, timedelta

import pytest

from app.config import PRACTICE_SETTINGS, ROOT
from app.loop.metrics import pipeline, summary
from app.loop.states import (ALLOWED, STAGES, InvalidTransition, allowed_next, previous_stage,
                             record_field_update, transition)
from app.loop.stuck import business_days_between, needs_attention, stuck_flags
from app.models import Plan, Receipt, Referral, load_patients

from conftest import TODAY

sys.path.insert(0, str(ROOT / "scripts"))
from check_copy import violations  # noqa: E402

D = date.fromisoformat
IDS = [f"R-10{i}" for i in range(1, 10)]
COV = {pid: p["coverage"] for pid, p in load_patients().items()}


def _plan(on: date, visit: date) -> Plan:
    return Plan.model_validate({"returned_on": on, "from": "Test practice", "visit_date": visit,
                                "reason": "test", "assessment": "A.", "plan": "P."})


def _as_draft(ref: Referral) -> Referral:
    d = ref.model_copy(deep=True)
    d.stage, (d.task_status, d.business_status) = "draft", STAGES["draft"]
    d.events, d.appointment, d.plan, d.closure, d.receipt, d.contact_mode = [], None, None, None, None, None
    return d


def flags(ref, today=TODAY, **kw):
    kw.setdefault("coverage", COV.get(ref.patient_id))
    return stuck_flags(ref, today, **kw)


def rules(ref, today=TODAY, **kw):
    return {f.rule for f in flags(ref, today, **kw)}


# ---------------------------------------------------------------- sample integrity

def test_sample_has_nine_scenarios(refs):
    assert sorted(refs) == IDS
    assert all(r.sample and r.performer.fictional and r.performer.phone for r in refs.values())
    stages = {r.id: r.business_status for r in refs.values()}
    assert stages == {
        "R-101": "sent", "R-102": "received-complete", "R-103": "scheduled",
        "R-104": "visit-completed", "R-105": "plan-returned", "R-106": "closed-by-referrer",
        "R-107": "declined", "R-108": "no-show", "R-109": "received-incomplete",
    }


def test_sample_includes_masshealth_with_transport_barrier(refs):
    hits = [r for r in refs.values() if COV[r.patient_id] in ("dual",)
            and any(b.type == "transportation" and b.status == "open" for b in r.barriers)]
    assert hits, "need a MassHealth/dual-eligible patient with a transportation barrier"


@pytest.mark.parametrize("rid", IDS)
def test_sample_history_replays_through_valid_transitions(refs, rid):
    seed = refs[rid]
    cur = _as_draft(seed)
    for ev in seed.events:
        kw = {}
        if ev.stage == "received":
            kw["receipt"] = seed.receipt if ev is seed.events[-1] or seed.stage != "received" else seed.receipt
        if ev.stage == "patient_contacted":
            kw["contact_mode"] = seed.contact_mode
        if ev.stage == "scheduled":
            kw["appointment_start"], kw["appointment_time"] = seed.appointment.start, seed.appointment.time
        if ev.stage == "plan_returned":
            kw["plan"] = seed.plan
        if ev.stage == "closed":
            kw["by"] = seed.closure.by
        cur = transition(cur, ev.stage, at=ev.at, actor=ev.actor, note=ev.note, source=ev.source, **kw)
    assert (cur.stage, cur.task_status, cur.business_status) == (seed.stage, seed.task_status, seed.business_status)
    assert [(e.stage, e.at) for e in cur.events] == [(e.stage, e.at) for e in seed.events]


# ---------------------------------------------------------------- transitions

def _kw():
    return dict(receipt=Receipt(complete=True), contact_mode="office_called", appointment_start=TODAY,
                closure_reason="cancelled", note="Reason given")


@pytest.mark.parametrize("stage,to", [(s, t) for s, ts in ALLOWED.items() for t in ts])
def test_every_listed_transition_is_allowed(refs, stage, to):
    r = refs["R-101"].model_copy(deep=True)
    r.stage = stage
    r.appointment = refs["R-103"].appointment.model_copy()
    r.plan = refs["R-105"].plan.model_copy()
    out = transition(r, to, at=TODAY, actor="office", plan=r.plan, **_kw())
    assert out.stage == to and out.task_status == STAGES[to][0]


@pytest.mark.parametrize("rid,to", [
    ("R-101", "scheduled"),          # sent → scheduled skips receipt
    ("R-101", "patient_contacted"),
    ("R-101", "closed"),
    ("R-102", "seen"),               # received → seen without an appointment
    ("R-104", "closed"),             # seen → closed without a plan
    ("R-104", "cancelled"),
    ("R-106", "sent"),               # closed is terminal
    ("R-107", "received"),           # declined → re-route is a new referral
    ("R-105", "seen"),
    ("R-101", "nonsense"),
])
def test_invalid_transitions_are_rejected(refs, rid, to):
    with pytest.raises(InvalidTransition):
        transition(refs[rid], to, at=TODAY, actor="office", **_kw())


def test_task_status_mapping_covers_every_stage():
    fhir_task_status = {"draft", "requested", "received", "accepted", "rejected", "ready", "cancelled",
                        "in-progress", "on-hold", "failed", "completed", "entered-in-error"}
    assert {s for s, _ in STAGES.values()} <= fhir_task_status
    assert STAGES["received"][0] == "received" and STAGES["patient_contacted"][0] == "accepted"


def test_received_complete_and_incomplete(refs):
    r = refs["R-101"]
    inc = transition(r, "received", at=TODAY, actor="office", source="link",
                     receipt=Receipt(complete=False, missing=["records"], note="Office notes"))
    assert (inc.task_status, inc.business_status) == ("received", "received-incomplete")
    assert inc.events[-1].source == "link"
    done = transition(inc, "received", at=TODAY, actor="office", receipt=Receipt(complete=True))
    assert done.business_status == "received-complete"
    with pytest.raises(InvalidTransition, match="missing item"):
        transition(r, "received", at=TODAY, actor="office", receipt=Receipt(complete=False))
    with pytest.raises(InvalidTransition, match="Receipt"):
        transition(r, "received", at=TODAY, actor="office")


def test_patient_contacted_needs_mode(refs):
    with pytest.raises(InvalidTransition, match="office called"):
        transition(refs["R-102"], "patient_contacted", at=TODAY, actor="office")
    out = transition(refs["R-102"], "patient_contacted", at=TODAY, actor="office", contact_mode="patient_told_to_call")
    assert out.contact_mode == "patient_told_to_call" and out.business_status == "patient-contacted"


def test_scheduled_records_time_and_seen_needs_appointment(refs):
    out = transition(refs["R-102"], "scheduled", at=TODAY, actor="office",
                     appointment_start=D("2026-11-12"), appointment_time="09:30")
    assert out.appointment.model_dump() == {"start": D("2026-11-12"), "time": "09:30", "status": "booked"}
    with pytest.raises(InvalidTransition, match="appointment date"):
        transition(refs["R-102"], "scheduled", at=TODAY, actor="office")


def test_decline_needs_reason(refs):
    with pytest.raises(InvalidTransition, match="reason"):
        transition(refs["R-101"], "declined", at=TODAY, actor="office")


def test_transition_logs_event_and_does_not_mutate_input(refs):
    r = refs["R-102"]
    before = r.model_dump()
    out = transition(r, "patient_contacted", at=TODAY, actor="office", source="link", note="Left voicemail",
                     contact_mode="office_called")
    assert r.model_dump() == before
    ev = out.events[-1]
    assert (ev.stage, ev.at, ev.actor, ev.note, ev.source, ev.kind) == (
        "patient_contacted", TODAY, "office", "Left voicemail", "link", "stage")


def test_field_update_keeps_stage(refs):
    out = record_field_update(refs["R-102"], "authorization", at=TODAY, actor="office", note="Authorization: pending")
    assert out.stage == "received" and out.events[-1].kind == "authorization"


def test_close_requires_plan_and_cancel_requires_reason(refs):
    out = transition(refs["R-105"], "closed", at=TODAY, actor="pcp", by="Dr. Avery Lin", note="Reviewed")
    assert out.closure.reason == "plan_received" and out.closure.by == "Dr. Avery Lin"
    with pytest.raises(InvalidTransition, match="closure reason"):
        transition(refs["R-103"], "cancelled", at=TODAY, actor="coordinator")


def test_backdated_event_is_rejected(refs):
    with pytest.raises(InvalidTransition, match="before the last event"):
        transition(refs["R-102"], "patient_barrier", at=D("2026-10-01"), actor="coordinator")


def test_patient_barrier_returns_only_to_previous_stage(refs):
    r = transition(refs["R-102"], "patient_barrier", at=TODAY, actor="coordinator")
    assert r.task_status == "on-hold" and previous_stage(r) == "received" and allowed_next(r) == ("received",)


# ---------------------------------------------------------------- stuck rules: sample checkpoint

def _by_rule(ref, today=TODAY):
    return {f.rule: f for f in flags(ref, today)}


def test_failure_1_not_scheduled(refs):
    f = _by_rule(refs["R-102"])["not_scheduled"]
    assert f.message == "Received 14 days ago, patient not contacted"
    assert f.status == "Not scheduled, 14 days" and f.challenge_failure == 1 and f.action == "call_office"


def test_failure_2_no_plan_back(refs):
    f = _by_rule(refs["R-104"])["seen_no_plan"]
    assert (f.message, f.status, f.challenge_failure) == (
        "Seen 12 days ago, plan not received", "No plan back, 12 days", 2)


def test_sample_flags(refs):
    f = _by_rule(refs["R-101"])["sent_no_receipt"]
    assert f.status == "Not confirmed received, 5 business days" and f.action == "call_office"
    m = _by_rule(refs["R-109"])["received_incomplete"]
    assert (m.status, m.action) == ("Missing records, 3 days", "send_records")
    assert rules(refs["R-103"]) == set()  # appointment more than 3 business days out
    assert rules(refs["R-105"]) == set()  # plan returned 2 days ago, limit 3
    assert rules(refs["R-106"]) == set()
    assert _by_rule(refs["R-107"])["declined_not_rerouted"].status == "Declined Oct 20, not re-routed"
    assert _by_rule(refs["R-108"])["no_show"].status == "Missed appointment Oct 15"


def test_needs_attention_failures_first(refs):
    rows = needs_attention(list(refs.values()), TODAY, COV)
    ids = [r["referral_id"] for r in rows]
    assert ids[:2] == ["R-102", "R-104"]
    assert set(ids) == {"R-101", "R-102", "R-104", "R-107", "R-108", "R-109"}


def test_messages_pass_copy_guard(refs):
    for row in needs_attention(list(refs.values()), TODAY, COV):
        for f in row["flags"]:
            assert violations(f["message"]) == [] and violations(f["status"]) == []


# ---------------------------------------------------------------- boundaries (n−1, n)

def _boundary(ref, rule, at_n: date):
    assert rule in rules(ref, at_n) and rule not in rules(ref, at_n - timedelta(days=1))


def test_boundary_sent_no_receipt(refs):
    # sent Sat 10-17: Mon 10-19 = 1 business day, Tue 10-20 = 2
    assert business_days_between(D("2026-10-17"), D("2026-10-19")) == 1
    _boundary(refs["R-101"], "sent_no_receipt", D("2026-10-20"))


def test_boundary_not_scheduled(refs):
    _boundary(refs["R-102"], "not_scheduled", D("2026-10-10") + timedelta(days=7))


def test_not_scheduled_also_after_contact(refs):
    r = transition(refs["R-102"], "patient_contacted", at=TODAY, actor="office", contact_mode="patient_told_to_call")
    f = _by_rule(r)["not_scheduled"]
    assert f.recipient == "patient" and f.action == "message_patient"
    assert f.message == "Received 14 days ago, patient contacted but not scheduled"


def test_boundary_seen_no_plan(refs):
    _boundary(refs["R-104"], "seen_no_plan", D("2026-10-12") + timedelta(days=7))


def test_boundary_plan_not_acknowledged(refs):
    _boundary(refs["R-105"], "plan_not_acknowledged", D("2026-10-22") + timedelta(days=3))


def test_boundary_declined(refs):
    _boundary(refs["R-107"], "declined_not_rerouted", D("2026-10-20") + timedelta(days=2))
    assert flags(refs["R-107"], rerouted_ids={"R-107"}) == []


def test_received_incomplete_is_immediate(refs):
    assert "received_incomplete" in rules(refs["R-109"], D("2026-10-21"))


def test_authorization_pending_more_than_5_business_days(refs):
    r = refs["R-109"]  # pending since Wed 10-21
    assert business_days_between(D("2026-10-21"), D("2026-10-28")) == 5
    assert "authorization_pending" not in rules(r, D("2026-10-28"))
    assert "authorization_pending" in rules(r, D("2026-10-29"))


def test_no_show_is_immediate(refs):
    assert _by_rule(refs["R-108"], D("2026-10-15"))["no_show"].message == "Missed appointment on Oct 15"


def test_pt1_rule(refs):
    r = refs["R-103"]  # dual eligible, transportation barrier, appointment Tue 11-03
    assert "pt1_not_requested" not in rules(r, D("2026-10-28"))  # 4 business days out
    assert "pt1_not_requested" in rules(r, D("2026-10-29"))      # 3 business days out
    r2 = r.model_copy(deep=True)
    r2.pt1_status = "requested"
    assert "pt1_not_requested" not in rules(r2, D("2026-10-29"))
    assert "pt1_not_requested" not in rules(r, D("2026-10-29"), coverage="original_medicare")


def test_thresholds_are_practice_settings(refs):
    s = {**PRACTICE_SETTINGS, "not_scheduled_days": 30}
    assert "not_scheduled" not in rules(refs["R-102"], settings=s)
    f = _by_rule(refs["R-102"])["not_scheduled"]
    assert (f.setting_key, f.threshold) == ("not_scheduled_days", 7)


# ---------------------------------------------------------------- dashboard aggregates

def test_summary_counts(refs):
    s = summary(list(refs.values()), TODAY, COV)
    assert (s["open"], s["stuck"], s["lost"], s["closed_this_month"], s["unread_plans"]) == (8, 6, 2, 1, 1)


def test_pipeline_columns(refs):
    cols = {c["stage"]: c["referral_ids"] for c in pipeline(list(refs.values()))}
    assert cols["received"] == ["R-102", "R-109"] and cols["seen"] == ["R-104"]
    assert "closed" not in cols


# ---------------------------------------------------------------- dashboard tabs and status text

def test_cards_tab_status_and_next_action(client):
    """Lost = challenge failures only; every status carries its time; one sentence on detail;
    the row button and the detail primary share one next action."""
    from app.store import get_repo
    from app.views import referral_card
    client.post("/api/sample-data")
    repo = get_repo()
    pts = repo.patients()
    cards = {r.id: referral_card(r, pts, TODAY, set()) for r in repo.all()}
    assert {i for i, c in cards.items() if c["tab"] == "lost"} == {"R-102", "R-104"}
    assert cards["R-102"]["row_status"] == "Not scheduled, 14 days"
    assert cards["R-104"]["row_status"] == "No plan back, 12 days"
    assert cards["R-101"]["tab"] == "waiting" and cards["R-101"]["row_status"] == "Not confirmed received, 5 business days"
    assert cards["R-108"]["row_status"].startswith("Missed appointment ")
    assert cards["R-103"]["tab"] == "ontrack" and cards["R-103"]["row_status"].startswith("Scheduled ")
    assert cards["R-103"]["next_action"] is None
    assert cards["R-102"]["next_action"] == {"key": "call_office", "label": "Call office"}
    assert cards["R-109"]["next_action"] == {"key": "send_records", "label": "Send records"}
    assert cards["R-102"]["status_sentence"] == "Received Oct 10. Patient not contacted for 14 days (limit 7)."
    assert cards["R-109"]["status_sentence"].startswith("Received ") and "missing records for 3 days" in cards["R-109"]["status_sentence"].lower()
    for c in cards.values():
        assert "limit 0" not in c["status_sentence"].lower(), c["status_sentence"]


def test_several_rules_lead_with_the_challenge_failure(refs):
    from app.loop.stuck import stuck_flags
    from app.models import Receipt
    from app.views import next_action, ordered_flags
    r = refs["R-102"].model_copy(deep=True)
    r.receipt = Receipt(complete=False, missing=["insurance_authorization"])
    flags = ordered_flags(stuck_flags(r, TODAY))
    assert flags[0].rule == "not_scheduled"
    assert " · ".join([flags[0].status] + [f.label for f in flags[1:]]) == "Not scheduled, 14 days · Missing insurance authorization"
    assert next_action(flags, True)["label"] == "Call office"
