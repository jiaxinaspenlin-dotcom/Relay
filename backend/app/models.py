"""Pydantic models for referrals. Stored as JSON documents in SQLite (app/db.py).

Sample data (data/synthetic/referrals.json) uses the same models and carries `sample = True`.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.config import DATA_SYNTHETIC

Actor = Literal["pcp", "coordinator", "specialist", "office", "patient", "system"]
BarrierType = Literal["transportation", "coverage", "language", "schedule_work", "cost", "other"]
# How an update reached the practice. "link" = the office used its update link.
UpdateSource = Literal["phone", "fax", "portal", "link", "other"]
Channel = Literal["copy", "email", "print", "manual"]
Coverage = Literal["medicare", "medicaid", "commercial", "other", "unknown"]
COVERAGE_LABELS = {"medicare": "Medicare", "medicaid": "Medicaid", "commercial": "Commercial",
                   "other": "Other", "unknown": "Unknown"}


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Event(_Model):
    stage: str
    at: date
    actor: Actor
    note: str = ""
    source: Optional[UpdateSource] = None


class Appointment(_Model):
    start: date
    time: Optional[str] = None  # "HH:MM" local, when the office gave one
    status: Literal["booked", "fulfilled", "noshow", "cancelled"]


class Barrier(_Model):
    type: BarrierType
    status: Literal["open", "addressed"]
    opened: date
    note: str = ""
    addressed: Optional[date] = None


class Communication(_Model):
    id: str = ""
    sent: date
    recipient: Literal["specialist", "patient", "pcp"]
    text: str
    sent_by: str
    kind: Literal["referral", "follow_up"] = "follow_up"
    channel: Channel = "manual"
    ai_drafted: bool = False
    rule: str = ""  # stuck rule the draft addressed, if any
    edited: bool = False  # True when the sender changed the drafted text


class Plan(_Model):
    simulated: bool = False
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
    code: str = ""  # SNOMED code when linked from a chart; empty for a typed condition
    system: str = ""
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
    fictional: bool = False
    # Set for real practices chosen in the finder (CMS directory).
    address: str = ""
    zip5: str = ""
    org_pac_id: str = ""


class Referral(_Model):
    id: str
    sample: bool = Field(default=False, validation_alias=AliasChoices("sample", "synthetic"))
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

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# ---------------------------------------------------------------- sample data

_SYNTH_SUFFIX = re.compile(r"\s*\(synthetic(?: referral)?\)")


def strip_synthetic_suffixes(obj):
    """Remove '(synthetic)' / '(synthetic referral)' from sample strings. Sample status is shown by
    the banner and the Sample tag, not inside generated text."""
    if isinstance(obj, str):
        return _SYNTH_SUFFIX.sub("", obj)
    if isinstance(obj, list):
        return [strip_synthetic_suffixes(v) for v in obj]
    if isinstance(obj, dict):
        return {k: strip_synthetic_suffixes(v) for k, v in obj.items()}
    return obj


def load_seed(path: Path | None = None) -> dict:
    """Load referrals.json (sample data) with `referrals` parsed into models."""
    path = path or DATA_SYNTHETIC / "referrals.json"
    doc = strip_synthetic_suffixes(json.loads(path.read_text(encoding="utf-8")))
    doc["referrals"] = [Referral.model_validate(r) for r in doc["referrals"]]
    return doc


def _display_name(synthea_name: str) -> str:
    """Synthea appends digits to names ("Shalanda398 Dicki44"); drop them for display."""
    return re.sub(r"\d+", "", synthea_name).strip()


def load_patients(path: Path | None = None) -> dict[str, dict]:
    """Sample patients (Synthea) in the app's patient shape."""
    from app.chart import patient_resource  # local import: chart reads bundles lazily

    path = path or DATA_SYNTHETIC / "selected_patients.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for p in doc["patients"]:
        res = patient_resource(p["id"])
        out[p["id"]] = {
            "id": p["id"],
            "name": _display_name(p["synthetic_name"]),
            "town": p["town"],
            "county": p["county"],
            "coverage": "medicare" if p.get("payer") in ("Medicare", "Dual Eligible") else "unknown",
            "dob": res.get("birthDate"),
            "sex": p.get("sex"),
            "sample": True,
            "chart_id": p["id"],
            "suggested_specialty": p.get("specialty"),
            "suggested_condition_code": (p.get("reason_condition") or {}).get("CODE"),
        }
    return out
