"""Follow-up message templates (one per stuck rule). The copy guard scans this file.

Each template is a list of (sentence, fact keys to cite). Sentences use [PATIENT] instead of the
patient's name; the name is inserted only after verification. Facts come from drafting/facts.py.
"""
from __future__ import annotations

from datetime import date

from app.dates import long
from app.drafting.facts import Fact
from app.loop.stuck import BARRIER_LABELS, StuckFlag
from app.loop.timeline import last_event_date
from app.models import Referral

PATIENT_TOKEN = "[PATIENT]"

RECIPIENT = {
    "sent_no_response": "specialist",
    "accepted_no_appointment": "specialist",
    "appointment_not_confirmed": "specialist",
    "seen_no_plan": "specialist",
    "no_show": "patient",
    "barrier_open": "patient",
    "plan_not_acknowledged": "pcp",
    "declined_not_rerouted": "pcp",
}

SIGNATURE = ("— {coordinator}, {practice}", ["requester"])
OFFICE_LINK = ("You can update the referral status here, no login needed: {office_url}", ["office_link"])
BARRIER_LINE = ("The patient has an open {barrier_label} barrier: {barrier_note}", ["barrier"])
# Patient-facing messages address the patient directly.
PATIENT_BARRIER_LINE = ("We noted a {barrier_label} barrier: {barrier_note}", ["barrier"])

TEMPLATES: dict[str, list[tuple[str, list[str]]]] = {
    "sent_no_response": [
        ("We sent a {specialty} referral for [PATIENT] to {performer} on {sent_date}.",
         ["referral", "performer"]),
        ("As of {today}, we have no response, {n} {unit} after sending.", ["elapsed"]),
        ("Please let us know whether you can accept the referral, or what else you need from us.",
         ["referral"]),
        ("Reason for referral: {reason}", ["reason"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "accepted_no_appointment": [
        ("Thank you for accepting the {specialty} referral for [PATIENT] on {stage_date}.",
         ["stage"]),
        ("As of {today}, we have no appointment date on file, {n} {unit} after acceptance.",
         ["elapsed"]),
        BARRIER_LINE,
        ("Could you share an appointment date, or tell us what you need from us to schedule?",
         ["stage"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "appointment_not_confirmed": [
        ("Our records show [PATIENT] had a {specialty} appointment with you on {appt_date}.",
         ["appointment"]),
        ("As of {today}, we have no confirmation that the visit took place, {n} {unit} later.",
         ["elapsed"]),
        ("Could you confirm whether the visit happened, and send the plan if it did?",
         ["appointment"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "seen_no_plan": [
        ("Our records show [PATIENT] was seen at {performer} on {stage_date} for the {specialty} "
         "referral.", ["stage", "performer"]),
        ("As of {today}, we have not received the visit plan, {n} {unit} after the visit.",
         ["elapsed"]),
        ("Please send the visit summary and plan to {practice}.", ["requester"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "no_show": [
        ("Our records show your {specialty} appointment with {performer} on {appt_date} was "
         "missed.", ["appointment", "performer"]),
        PATIENT_BARRIER_LINE,
        ("Please call us so we can help you find a new appointment time.", ["appointment"]),
        SIGNATURE,
    ],
    "barrier_open": [
        ("On {barrier_opened}, we noted a {barrier_label} barrier for your {specialty} referral.",
         ["barrier", "referral"]),
        ("As of {today}, it is still open after {n} {unit}.", ["elapsed"]),
        ("Please call us so we can work on it together.", ["barrier"]),
        SIGNATURE,
    ],
    "plan_not_acknowledged": [
        ("A plan from {performer} for [PATIENT] arrived on {returned}.", ["performer", "plan_returned"]),
        ("As of {today}, it has not been acknowledged, {n} {unit} after it arrived.", ["elapsed"]),
        ("Please review it in the PCP inbox and acknowledge it.", ["plan_returned"]),
        SIGNATURE,
    ],
    "declined_not_rerouted": [
        ("{performer} declined the {specialty} referral for [PATIENT] on {stage_date}.",
         ["performer", "stage"]),
        ("Office note: {decline_note}", ["decline_note"]),
        ("As of {today}, no new referral has been sent, {n} {unit} later.", ["elapsed"]),
        ("If you want to re-route, choose another practice in the finder.", ["stage"]),
        SIGNATURE,
    ],
}


def _barrier_for(ref: Referral, flag: StuckFlag):
    open_b = [b for b in ref.barriers if b.status == "open"]
    if flag.rule == "barrier_open":
        return next((b for b in open_b if flag.message.startswith(BARRIER_LABELS[b.type])), None)
    return open_b[0] if open_b else None


def render(ref: Referral, flag: StuckFlag, facts: list[Fact], today: date) -> str:
    """Template text with [F#] citations and the [PATIENT] token (name not yet inserted)."""
    by_key = {f.key: f for f in facts}
    barrier = _barrier_for(ref, flag)
    if barrier is not None:
        by_key["barrier"] = by_key[f"barrier_{barrier.type}"]
    n = flag.days
    unit = ("business day" if flag.unit == "business days" else "day") + ("" if n == 1 else "s")
    sent = last_event_date(ref, "sent")
    decline_note = by_key["decline_note"].value if "decline_note" in by_key else ""
    vars_ = {
        "specialty": ref.specialty,
        "performer": ref.performer.name,
        "sent_date": long(sent) if sent else "",
        "stage_date": long(ref.events[-1].at) if ref.events else "",
        "appt_date": long(ref.appointment.start) if ref.appointment else "",
        "returned": long(ref.plan.returned_on) if ref.plan else "",
        "today": long(today),
        "n": n,
        "unit": unit,
        "reason": ref.reason_text,
        "decline_note": decline_note,
        "barrier_label": BARRIER_LABELS[barrier.type].lower() if barrier else "",
        "barrier_note": barrier.note if barrier else "",
        "barrier_opened": long(barrier.opened) if barrier else "",
        "coordinator": ref.requester.coordinator,
        "practice": ref.requester.practice,
        "office_url": by_key["office_link"].value if "office_link" in by_key else "",
    }
    lines = []
    for sentence, keys in TEMPLATES[flag.rule]:
        if any(k not in by_key for k in keys):
            continue  # optional line (e.g. no open barrier, no decline note)
        cites = "".join(f"[{by_key[k].id}]" for k in keys)
        lines.append(f"{sentence.format(**vars_)} {cites}")
    return "\n".join(lines)


# ---------------------------------------------------------------- referral message (on Send)

def referral_message(ref: Referral, patient: dict, office_url: str) -> dict:
    """Plain-text referral for Copy / email / fax. Clinical content is the PCP's own words and the
    linked condition; Relay adds no clinical judgment."""
    dob = long(date.fromisoformat(patient["dob"])) if patient.get("dob") else "not recorded"
    subject = f"Referral: {ref.specialty} for {patient['name']} (DOB {dob})"
    lines = [
        f"To: {ref.performer.name}, {ref.performer.address + ', ' if ref.performer.address else ''}{ref.performer.town}",
        f"From: {ref.requester.clinician}, {ref.requester.practice}",
        f"Contact: {ref.requester.coordinator}",
        "",
        f"Patient: {patient['name']}",
        f"Date of birth: {dob}",
        f"Town: {patient['town']}",
        f"Coverage on file: {patient.get('coverage_label', 'Unknown')}",
        "",
        f"Specialty requested: {ref.specialty}",
        f"Priority (set by the referring clinician): {ref.priority}",
        f"Condition: {ref.reason_condition.display}",
        f"Reason for referral: {ref.reason_text}",
        "",
        "Please let us know whether you can accept this referral, the appointment date once it is",
        "set, and the visit plan afterward. You can do all of this at the link below, no login needed:",
        office_url,
        "",
        "Or reply by phone or fax to the contact above.",
    ]
    return {"subject": subject, "text": "\n".join(lines)}
