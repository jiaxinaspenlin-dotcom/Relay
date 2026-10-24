"""Pydantic models for referrals. Stored as JSON documents in SQLite (app/db.py).

Sample data (data/synthetic/referrals.json) uses the same models and carries `sample = True`.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.config import DATA_SYNTHETIC

Actor = Literal["pcp", "coordinator", "specialist", "office", "patient", "system"]
BarrierType = Literal["transportation", "coverage", "language", "schedule_work", "cost", "other"]
# How an update reached the practice. "link" = the office used its update link.
UpdateSource = Literal["phone", "fax", "portal", "link", "ai_call", "email", "other"]
Channel = Literal["copy", "email", "print", "manual"]

# Massachusetts insurance types (patient form and data).
Coverage = Literal[
    "original_medicare", "medicare_advantage", "masshealth_pcc", "masshealth_pcaco",
    "masshealth_acpp", "masshealth_mco", "dual", "commercial_hmo", "commercial_ppo", "unknown",
]
COVERAGE_LABELS: dict[str, str] = {
    "original_medicare": "Original Medicare",
    "medicare_advantage": "Medicare Advantage",
    "masshealth_pcc": "MassHealth PCC Plan",
    "masshealth_pcaco": "MassHealth Primary Care ACO",
    "masshealth_acpp": "MassHealth Accountable Care Partnership Plan",
    "masshealth_mco": "MassHealth MCO",
    "dual": "Dual eligible (Medicare + MassHealth)",
    "commercial_hmo": "Commercial HMO",
    "commercial_ppo": "Commercial PPO/other",
    "unknown": "Unknown",
}
MASSHEALTH = frozenset({"masshealth_pcc", "masshealth_pcaco", "masshealth_acpp", "masshealth_mco", "dual"})
MEDICARE = frozenset({"original_medicare", "medicare_advantage", "dual"})


def coverage_from_synthea(payer: str | None) -> str:
    """Synthea payer -> MA insurance type. Plan type for Medicaid isn't in Synthea, so MCO is a
    placeholder the coordinator can correct."""
    p = (payer or "").strip().lower()
    if p == "medicare":
        return "original_medicare"
    if p == "dual eligible":
        return "dual"
    if p in ("medicaid", "masshealth"):
        return "masshealth_mco"
    return "commercial_ppo"


MissingItem = Literal["records", "insurance_authorization", "test_results", "other"]
MISSING_LABELS = {"records": "records", "insurance_authorization": "insurance authorization",
                  "test_results": "test results", "other": "other items"}
Authorization = Literal["not_set", "not_required", "pending", "approved", "denied"]
AUTH_LABELS = {"not_set": "Not set", "not_required": "Not required", "pending": "Pending",
               "approved": "Approved", "denied": "Denied"}


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Event(_Model):
    stage: str  # stage after this event (unchanged for non-stage updates)
    at: date
    actor: Actor
    note: str = ""
    source: Optional[UpdateSource] = None
    # "stage" = a stage transition; others record field changes without moving the stage.
    kind: Literal["stage", "authorization", "barrier", "transport", "phone", "call", "resend"] = "stage"
    by: str = ""  # the signed-in user who acted (empty for the office link)
    user_id: str = ""
    call_duration: str = ""  # AI phone call length, e.g. "1 min 32 s" (source = ai_call)


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


class Receipt(_Model):
    complete: bool
    missing: list[MissingItem] = []
    note: str = ""


class Communication(_Model):
    id: str = ""
    sent: date
    recipient: Literal["specialist", "patient", "pcp"]
    text: str
    sent_by: str
    sent_by_id: str = ""
    kind: Literal["referral", "follow_up", "patient_message"] = "follow_up"
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
    by_id: str = ""
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
    phone: str = ""  # scheduling phone: CMS telephone_number, or entered by the coordinator


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
    receipt: Optional[Receipt] = None  # set when the office confirms receipt
    contact_mode: Optional[Literal["office_called", "patient_told_to_call"]] = None
    authorization: Authorization = "not_set"  # a field, not a stage
    authorization_since: Optional[date] = None
    pt1_status: Literal["not_started", "requested", "confirmed"] = "not_started"
    transport_plan: str = ""  # free text for non-MassHealth patients
    # Set when the office says (on an AI call) it never got the referral; cleared by a resend.
    office_not_received: Optional[date] = None
    office_resend_method: Optional[Literal["fax", "portal", "email", "unknown"]] = None

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


def _on(today: date, offset):
    """Sample dates are integer day offsets from load time; None stays None."""
    if offset is None:
        return None
    if isinstance(offset, int):
        return (today + timedelta(days=offset)).isoformat()
    raise ValueError(f"Sample date must be a day offset (int), got {offset!r}")


def resolve_offsets(r: dict, today: date) -> dict:
    """Turn one sample referral's day offsets into dates as of `today`."""
    r = json.loads(json.dumps(r))
    r["authored_on"] = _on(today, r["authored_on"])
    r["authorization_since"] = _on(today, r.get("authorization_since"))
    for e in r["events"]:
        e["at"] = _on(today, e["at"])
    if r.get("appointment"):
        r["appointment"]["start"] = _on(today, r["appointment"]["start"])
    for b in r.get("barriers", []):
        b["opened"] = _on(today, b["opened"])
        b["addressed"] = _on(today, b.get("addressed"))
    for c in r.get("communications", []):
        c["sent"] = _on(today, c["sent"])
    if r.get("plan"):
        r["plan"]["returned_on"] = _on(today, r["plan"]["returned_on"])
        r["plan"]["visit_date"] = _on(today, r["plan"]["visit_date"])
    if r.get("closure"):
        r["closure"]["at"] = _on(today, r["closure"]["at"])
    return r


def load_seed(today: date | None = None, path: Path | None = None) -> dict:
    """Load referrals.json (sample data) as of `today` (default: the real date)."""
    from app import config  # late import: tests patch config.real_today
    today = today or config.real_today()
    path = path or DATA_SYNTHETIC / "referrals.json"
    doc = strip_synthetic_suffixes(json.loads(path.read_text(encoding="utf-8")))
    doc["referrals"] = [Referral.model_validate(resolve_offsets(r, today)) for r in doc["referrals"]]
    doc["as_of"] = today.isoformat()
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
            "coverage": coverage_from_synthea(p.get("payer")),
            "dob": res.get("birthDate"),
            "sex": p.get("sex"),
            "sample": True,
            "chart_id": p["id"],
            "suggested_specialty": p.get("specialty"),
            "suggested_condition_code": (p.get("reason_condition") or {}).get("CODE"),
        }
    return out
