"""Pydantic models mirroring data/synthetic/referrals.json (all synthetic)."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.config import DATA_SYNTHETIC

Actor = Literal["pcp", "coordinator", "specialist", "patient", "system"]
BarrierType = Literal["transportation", "coverage", "language", "schedule_work", "cost", "other"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Event(_Model):
    stage: str
    at: date
    actor: Actor
    note: str = ""


class Appointment(_Model):
    start: date
    status: Literal["booked", "fulfilled", "noshow", "cancelled"]


class Barrier(_Model):
    type: BarrierType
    status: Literal["open", "addressed"]
    opened: date
    note: str = ""
    addressed: Optional[date] = None


class Communication(_Model):
    sent: date
    recipient: Literal["specialist", "patient", "pcp"]
    text: str
    sent_by: str
    ai_drafted: bool = False


class Plan(_Model):
    simulated: bool = True
    returned_on: date
    # "from" is a Python keyword, so the field is aliased.
    from_: str = Field(alias="from")
    visit_date: date
    reason: str
    assessment: str
    plan: str
    actions_for_pcp: str = ""
    questions_contact: str = ""
    omitted_fields_note: str = ""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Closure(_Model):
    at: date
    by: str
    reason: Literal["plan_received", "patient_declined", "referred_elsewhere", "cancelled"]
    note: str = ""


class Condition(_Model):
    code: str
    system: str
    display: str
    onset: Optional[date] = None


class Party(_Model):
    practice: str
    clinician: str
    coordinator: str


class Performer(_Model):
    id: str
    name: str
    town: str
    fictional: bool = True


class Referral(_Model):
    id: str
    synthetic: bool = True
    patient_id: str
    patient_town: str
    specialty: str
    pri_spec: str
    priority: Literal["routine", "urgent"]
    reason_text: str
    reason_condition: Condition
    requester: Party
    performer: Performer
    stage: str
    task_status: str
    business_status: str
    authored_on: date
    events: list[Event]
    appointment: Optional[Appointment] = None
    barriers: list[Barrier] = []
    communications: list[Communication] = []
    plan: Optional[Plan] = None
    closure: Optional[Closure] = None
    replaces: Optional[str] = None  # set when this referral re-routes a declined one


def load_seed(path: Path | None = None) -> dict:
    """Load referrals.json. Returns the raw document with `referrals` parsed into models."""
    path = path or DATA_SYNTHETIC / "referrals.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["referrals"] = [Referral.model_validate(r) for r in doc["referrals"]]
    return doc


def load_patients(path: Path | None = None) -> dict[str, dict]:
    path = path or DATA_SYNTHETIC / "selected_patients.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    return {p["id"]: p for p in doc["patients"]}
