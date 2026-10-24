"""Loop states, transitions, event logging, stuck rules, and dashboard aggregates."""
from __future__ import annotations

import sys
from datetime import date, timedelta

import pytest

from app.config import PRACTICE_SETTINGS, ROOT
from app.loop.metrics import pipeline, summary
from app.loop.states import (ALLOWED, STAGES, InvalidTransition, allowed_next, previous_stage,
                             transition)
from app.loop.stuck import business_days_between, needs_attention, stuck_flags
from app.models import Plan, Referral

from conftest import TODAY

sys.path.insert(0, str(ROOT / "scripts"))
from check_copy import violations  # noqa: E402

D = date.fromisoformat


def _plan(on: date, visit: date) -> Plan:
    return Plan.model_validate({
        "returned_on": on, "from": "Test practice (fictional)", "visit_date": visit,
        "reason": "test", "assessment": "Written by specialist (synthetic).",
        "plan": "Written by specialist (synthetic).",
    })


def _as_draft(ref: Referral) -> Referral:
    d = ref.model_copy(deep=True)
    d.stage, (d.task_status, d.business_status) = "draft", STAGES["draft"]
    d.events, d.appointment, d.plan, d.closure = [], None, None, None
    return d


# ---------------------------------------------------------------- seed integrity

def test_seed_has_eight_archetypes(refs):
    assert sorted(refs) == [f"R-10{i}" for i in range(1, 9)]
    assert all(r.sample and r.performer.fictional for r in refs.values())


@pytest.mark.parametrize("rid", [f"R-10{i}" for i in range(1, 9)])
def test_seed_statuses_match_stage_table(refs, rid):
    r = refs[rid]
    assert (r.task_status, r.business_status) == STAGES[r.stage]


@pytest.mark.parametrize("rid", [f"R-10{i}" for i in range(1, 9)])
def test_seed_history_replays_through_valid_transitions(refs, rid):
    """Every seeded event sequence is reachable from Draft using only allowed transitions."""
    seed = refs[rid]
    cur = _as_draft(seed)
    for ev in seed.events:
        kw = {}
        if ev.stage == "scheduled":
            kw["appointment_start"] = seed.appointment.start
        if ev.stage == "plan_returned":
            kw["plan"] = seed.plan
        if ev.stage == "closed":
            kw["by"] = seed.closure.by
        cur = transition(cur, ev.stage, at=ev.at, actor=ev.actor, note=ev.note, **kw)
    assert cur.stage == seed.stage
    assert (cur.task_status, cur.business_status) == (seed.task_status, seed.business_status)
    assert (cur.appointment.status if cur.appointment else None) == (
        seed.appointment.status if seed.appointment else None)
    assert [(e.stage, e.at) for e in cur.events] == [(e.stage, e.at) for e in seed.events]


# ---------------------------------------------------------------- transitions

@pytest.mark.parametrize("stage,to", [(s, t) for s, ts in ALLOWED.items() for t in ts])
def test_every_listed_transition_is_allowed(refs, stage, to):
    r = refs["R-101"].model_copy(deep=True)
    r.stage = stage
    r.appointment = refs["R-103"].appointment.model_copy()
    r.plan = refs["R-105"].plan.model_copy()
    out = transition(r, to, at=TODAY, actor="coordinator", appointment_start=TODAY,
                     plan=r.plan, closure_reason="cancelled")
    assert out.stage == to
    assert (out.task_status, out.business_status) == STAGES[to]


@pytest.mark.parametrize("rid,to", [
    ("R-101", "scheduled"),   # sent → scheduled skips acceptance
    ("R-101", "closed"),
    ("R-102", "seen"),        # accepted → seen without an appointment
    ("R-104", "closed"),      # seen → closed without a plan
    ("R-104", "cancelled"),   # seen has no cancel path
    ("R-106", "sent"),        # closed is terminal
    ("R-107", "accepted"),    # declined → re-route is a new referral
    ("R-105", "seen"),
    ("R-101", "nonsense"),
])
def test_invalid_transitions_are_rejected(refs, rid, to):
    with pytest.raises(InvalidTransition):
        transition(refs[rid], to, at=TODAY, actor="coordinator", appointment_start=TODAY,
                   closure_reason="cancelled")


def test_transition_logs_event_and_does_not_mutate_input(refs):
    r = refs["R-102"]
    before = r.model_dump()
    out = transition(r, "scheduled", at=TODAY, actor="specialist", note="Late-day slot",
                     appointment_start=D("2026-11-10"))
    assert r.model_dump() == before
    ev = out.events[-1]
    assert (ev.stage, ev.at, ev.actor, ev.note) == ("scheduled", TODAY, "specialist", "Late-day slot")
    assert len(out.events) == len(r.events) + 1
    assert out.appointment.start == D("2026-11-10") and out.appointment.status == "booked"


def test_scheduling_requires_a_date(refs):
    with pytest.raises(InvalidTransition, match="appointment date"):
        transition(refs["R-102"], "scheduled", at=TODAY, actor="specialist")


def test_plan_return_requires_plan(refs):
    with pytest.raises(InvalidTransition, match="plan"):
        transition(refs["R-104"], "plan_returned", at=TODAY, actor="specialist")


def test_close_requires_returned_plan_and_records_closure(refs):
    out = transition(refs["R-105"], "closed", at=TODAY, actor="pcp", by="Dr. Avery Lin",
                     note="Reviewed")
    assert out.closure.reason == "plan_received" and out.closure.by == "Dr. Avery Lin"
    assert out.closure.at == TODAY and out.business_status == "closed-by-referrer"


def test_cancel_requires_explicit_closure_reason(refs):
    with pytest.raises(InvalidTransition, match="closure reason"):
        transition(refs["R-103"], "cancelled", at=TODAY, actor="coordinator")
    out = transition(refs["R-103"], "cancelled", at=TODAY, actor="coordinator",
                     closure_reason="referred_elsewhere")
    assert out.closure.reason == "referred_elsewhere"
    assert out.appointment.status == "cancelled"


def test_backdated_event_is_rejected(refs):
    with pytest.raises(InvalidTransition, match="before the last event"):
        transition(refs["R-102"], "patient_barrier", at=D("2026-10-01"), actor="coordinator")


def test_patient_barrier_returns_only_to_previous_stage(refs):
    r = transition(refs["R-102"], "patient_barrier", at=TODAY, actor="coordinator")
    assert r.task_status == "on-hold"
    assert previous_stage(r) == "accepted"
    assert allowed_next(r) == ("accepted",)
    with pytest.raises(InvalidTransition):
        transition(r, "scheduled", at=TODAY, actor="coordinator", appointment_start=TODAY)
    back = transition(r, "accepted", at=TODAY, actor="coordinator")
    assert back.stage == "accepted" and back.task_status == "accepted"


def test_patient_barrier_from_scheduled_keeps_appointment(refs):
    r = transition(refs["R-103"], "patient_barrier", at=TODAY, actor="coordinator")
    back = transition(r, "scheduled", at=TODAY, actor="coordinator",
                      appointment_start=D("2026-11-05"))
    assert back.appointment.start == D("2026-11-05")


# ---------------------------------------------------------------- stuck rules: seed checkpoint

def _msgs(ref, today=TODAY, **kw):
    return [f.message for f in stuck_flags(ref, today, **kw)]


def test_checkpoint_r102_challenge_failure_1(refs):
    flags = stuck_flags(refs["R-102"], TODAY)
    assert flags[0].message == "Accepted 14 days ago — no appointment yet"
    assert flags[0].challenge_failure == 1
    assert "Transportation barrier open 12 days" in [f.message for f in flags]


def test_checkpoint_r104_challenge_failure_2(refs):
    flags = stuck_flags(refs["R-104"], TODAY)
    assert [f.message for f in flags] == ["Seen 12 days ago — plan not received"]
    assert flags[0].challenge_failure == 2


def test_seed_flags(refs):
    assert _msgs(refs["R-101"]) == [
        "Sent 5 business days ago — no response from Connecticut River Endocrine Group (fictional)"]
    assert _msgs(refs["R-103"]) == []
    assert _msgs(refs["R-105"]) == []  # plan returned 2 days ago, threshold 3
    assert _msgs(refs["R-106"]) == []
    assert _msgs(refs["R-107"]) == ["Declined 4 days ago — no new referral"]
    assert _msgs(refs["R-108"]) == ["Missed appointment on 2026-10-15",
                                    "Schedule/work barrier open 8 days"]


def test_needs_attention_sorted_by_days_stuck(refs):
    rows = needs_attention(list(refs.values()), TODAY)
    # R-102 14d, R-104 12d, R-108 9d, R-101 5 business days, R-107 4d
    assert [r["referral_id"] for r in rows] == ["R-102", "R-104", "R-108", "R-101", "R-107"]
    assert rows[0]["open_barriers"] == ["transportation"]


def test_flag_messages_pass_copy_guard(refs):
    for row in needs_attention(list(refs.values()), TODAY):
        for f in row["flags"]:
            assert violations(f["message"]) == []


# ---------------------------------------------------------------- stuck rules: boundaries (n−1, n)

def _boundary(ref, rule, at_n: date):
    hit = {f.rule for f in stuck_flags(ref, at_n)}
    miss = {f.rule for f in stuck_flags(ref, at_n - timedelta(days=1))}
    assert rule in hit and rule not in miss


def test_boundary_accepted_no_appointment(refs):
    _boundary(refs["R-102"], "accepted_no_appointment", D("2026-10-10") + timedelta(days=7))


def test_boundary_seen_no_plan(refs):
    _boundary(refs["R-104"], "seen_no_plan", D("2026-10-12") + timedelta(days=7))


def test_boundary_appointment_not_confirmed(refs):
    _boundary(refs["R-103"], "appointment_not_confirmed", D("2026-11-03") + timedelta(days=2))
    assert stuck_flags(refs["R-103"], D("2026-11-05"))[0].message == (
        "Appointment was 2026-11-03 — visit not confirmed")


def test_boundary_plan_not_acknowledged(refs):
    _boundary(refs["R-105"], "plan_not_acknowledged", D("2026-10-22") + timedelta(days=3))


def test_boundary_declined_not_rerouted(refs):
    _boundary(refs["R-107"], "declined_not_rerouted", D("2026-10-20") + timedelta(days=2))
    assert stuck_flags(refs["R-107"], TODAY, rerouted_ids={"R-107"}) == []


def test_boundary_barrier_open(refs):
    _boundary(refs["R-102"], "barrier_open", D("2026-10-12") + timedelta(days=7))


def test_barrier_rule_ignores_addressed_and_terminal(refs):
    r = refs["R-102"].model_copy(deep=True)
    r.barriers[0].status = "addressed"
    assert "barrier_open" not in {f.rule for f in stuck_flags(r, TODAY)}
    r = refs["R-102"].model_copy(deep=True)
    r.stage = "cancelled"
    assert stuck_flags(r, TODAY) == []


def test_no_show_is_immediate(refs):
    assert stuck_flags(refs["R-108"], D("2026-10-15"))[0].message == "Missed appointment on 2026-10-15"


def test_boundary_sent_business_days(refs):
    r = refs["R-101"]  # sent Sat 2026-10-17; Mon 10-19 is business day 1
    assert business_days_between(D("2026-10-17"), D("2026-10-18")) == 0  # Sunday
    assert business_days_between(D("2026-10-17"), D("2026-10-21")) == 3
    assert business_days_between(D("2026-10-17"), TODAY) == 5           # Sat 10-24 not counted
    assert "sent_no_response" not in {f.rule for f in stuck_flags(r, D("2026-10-20"))}
    assert "sent_no_response" in {f.rule for f in stuck_flags(r, D("2026-10-21"))}


def test_singular_day_wording(refs):
    settings = {**PRACTICE_SETTINGS, "accepted_no_appointment_days": 1}
    msgs = _msgs(refs["R-102"], D("2026-10-11"), settings=settings)
    assert msgs[0] == "Accepted 1 day ago — no appointment yet"


def test_thresholds_are_practice_settings(refs):
    settings = {**PRACTICE_SETTINGS, "accepted_no_appointment_days": 30}
    assert "accepted_no_appointment" not in {
        f.rule for f in stuck_flags(refs["R-102"], TODAY, settings=settings)}
    flag = stuck_flags(refs["R-102"], TODAY)[0]
    assert (flag.setting_key, flag.threshold) == ("accepted_no_appointment_days", 7)


# ---------------------------------------------------------------- dashboard aggregates

def test_summary_counts(refs):
    s = summary(list(refs.values()), TODAY)
    assert s["open"] == 7            # all but R-106 (closed)
    assert s["stuck"] == 5           # R-101, R-102, R-104, R-107, R-108
    assert s["closed_this_month"] == 1
    # sent→scheduled: R-103 7, R-104 4, R-105 4, R-106 4, R-108 4
    assert s["median_days_sent_to_scheduled"] == 4 and s["median_basis_n"] == 5


def test_summary_updates_after_close(refs):
    rs = dict(refs)
    rs["R-105"] = transition(rs["R-105"], "closed", at=TODAY, actor="pcp")
    s = summary(list(rs.values()), TODAY)
    assert (s["open"], s["closed_this_month"]) == (6, 2)


def test_pipeline_columns(refs):
    cols = {c["stage"]: c["referral_ids"] for c in pipeline(list(refs.values()))}
    assert cols["accepted"] == ["R-102"] and cols["seen"] == ["R-104"]
    assert cols["declined"] == ["R-107"] and cols["no_show"] == ["R-108"]
    assert "closed" not in cols
