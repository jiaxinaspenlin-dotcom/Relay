"""Build a verified template follow-up for a stuck referral."""
from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from app.drafting.facts import build_facts
from app.drafting.templates import PATIENT_TOKEN, RECIPIENT, render
from app.drafting.verify import verify
from app.loop.stuck import stuck_flags
from app.models import Referral

RECIPIENT_LABELS = {"specialist": "Specialist office", "patient": "Patient", "pcp": "PCP"}


class NotStuck(ValueError):
    pass


def make_draft(ref: Referral, patient: dict, today: date, *, rule: Optional[str] = None,
               rerouted_ids: Iterable[str] = (), office_url: Optional[str] = None) -> dict:
    flags = stuck_flags(ref, today, rerouted_ids=rerouted_ids)
    if not flags:
        raise NotStuck(f"{ref.id} has no stuck rule today ({today.isoformat()})")
    flag = next((f for f in flags if f.rule == rule), None) if rule else flags[0]
    if flag is None:
        raise NotStuck(f"Rule {rule} does not apply to {ref.id} today")
    facts = build_facts(ref, today, flag, office_url if RECIPIENT[flag.rule] == "specialist" else None)
    keyed = render(ref, flag, facts, today)
    problems = verify(keyed, facts)
    recipient = RECIPIENT[flag.rule]
    return {
        "referral_id": ref.id,
        "rule": flag.rule,
        "rule_message": flag.message,
        "recipient": recipient,
        "recipient_label": RECIPIENT_LABELS[recipient],
        "source": "template",
        "facts": [f.to_dict() for f in facts],
        "text": keyed.replace(PATIENT_TOKEN, patient["name"]),
        "subject": f"Follow-up: {ref.specialty} referral for {patient['name']}" if recipient != "patient"
                   else f"Your {ref.specialty} referral",
        "verified": not problems,
        "problems": problems,
        "available_rules": [f.rule for f in flags],
    }
