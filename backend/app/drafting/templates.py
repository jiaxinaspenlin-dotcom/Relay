"""Follow-up message templates (one per stuck rule). The copy guard scans this file.

Each template is a list of (sentence, fact keys to cite). Sentences use [PATIENT] instead of the
patient's name; the name is inserted only after verification. Facts come from drafting/facts.py.
"""
from __future__ import annotations

from datetime import date

from app.dates import long
from app.drafting.facts import Fact
from app.loop.stuck import BARRIER_LABELS, StuckFlag
from app.loop.timeline import first_event_date, last_event_date
from app.models import Referral

PATIENT_TOKEN = "[PATIENT]"

SIGNATURE = ("— {coordinator}, {practice}", ["requester"])
OFFICE_LINK = ("For offices not yet on Mass HIway, you can update the status here, no login needed: "
               "{office_url}", ["office_link"])
BARRIER_LINE = ("The patient has an open {barrier_label} barrier: {barrier_note}", ["barrier"])
# Patient-facing messages address the patient directly.
PATIENT_BARRIER_LINE = ("We noted a {barrier_label} barrier: {barrier_note}", ["barrier"])
PATIENT_CALL_OFFICE = ("To schedule, please call {performer} at {phone}.", ["performer", "phone"])

TEMPLATES: dict[str, list[tuple[str, list[str]]]] = {
    "sent_no_receipt": [
        ("We sent a {specialty} referral for [PATIENT] to {performer} on {sent_date}.",
         ["referral", "performer"]),
        ("As of {today}, we have no confirmation that it was received, {n} {unit} after sending.",
         ["elapsed"]),
        ("Please confirm you received it, or tell us what is missing.", ["referral"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "received_incomplete": [
        ("Thank you for confirming receipt of the {specialty} referral for [PATIENT].", ["received"]),
        ("You asked for {missing}.", ["missing"]),
        ("We will send {missing} separately. Please tell us if anything else is needed.", ["missing"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "authorization_pending": [
        ("Authorization for the {specialty} referral for [PATIENT] has been pending since {auth_since}.",
         ["authorization"]),
        ("As of {today}, that is {n} {unit}.", ["elapsed"]),
        ("Please tell us if the plan needs anything from our office.", ["authorization"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "not_scheduled": [
        ("You confirmed receipt of the {specialty} referral for [PATIENT] on {received_date}.",
         ["received"]),
        ("As of {today}, we have no record that the patient has been contacted, {n} {unit} later.",
         ["elapsed"]),
        BARRIER_LINE,
        ("Could you tell us when the office will reach the patient, or share the scheduling number "
         "so the patient can call?", ["received"]),
        OFFICE_LINK,
        SIGNATURE,
    ],
    "not_scheduled_patient": [
        ("Your referral to {performer} for {specialty} was received on {received_date}.",
         ["received", "performer"]),
        PATIENT_CALL_OFFICE,
        ("If something makes it hard to schedule, call us and we can help.", ["requester"]),
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
    "no_show": [
        ("Our records show your {specialty} appointment with {performer} on {appt_date} was "
         "missed.", ["appointment", "performer"]),
        PATIENT_BARRIER_LINE,
        ("To find a new time, please call {performer} at {phone}.", ["performer", "phone"]),
        ("If you need help, call us.", ["requester"]),
        SIGNATURE,
    ],
}

# Rules without a message template (the action is the coordinator's own, e.g. PT-1).
NO_TEMPLATE = frozenset({"pt1_not_requested"})


def template_key(flag: StuckFlag) -> str:
    if flag.rule == "not_scheduled" and flag.recipient == "patient":
        return "not_scheduled_patient"
    return flag.rule


def _barrier_for(ref: Referral, flag: StuckFlag):
    open_b = [b for b in ref.barriers if b.status == "open"]
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
    received = first_event_date(ref, "received")
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
        "received_date": long(received) if received else "",
        "missing": by_key["missing"].value if "missing" in by_key else "",
        "auth_since": long(ref.authorization_since) if ref.authorization_since else "",
        "phone": ref.performer.phone,
    }
    lines = []
    for sentence, keys in TEMPLATES[template_key(flag)]:
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
        "Please confirm you received this referral and tell us if anything is missing. After the",
        "visit, please send the plan. For offices not yet on Mass HIway, you can do this at the",
        "link below, no login needed:",
        office_url,
        "",
        "Or reply by phone or fax to the contact above.",
    ]
    return {"subject": subject, "text": "\n".join(lines)}


# ---------------------------------------------------------------- patient next-step message

def patient_message(ref: Referral, patient: dict) -> dict:
    """After the office confirms receipt: tell the patient how to schedule. The office and the
    patient schedule the visit; Relay only passes on the number."""
    phone = ref.performer.phone
    lines = [
        f"Hello {patient['name']},",
        "",
        f"Your referral to {ref.performer.name} was received. Please call {phone} to schedule.",
        "",
        "If transportation or anything else makes it hard to get there, call us and we can help.",
        "",
        f"{ref.requester.coordinator}, {ref.requester.practice}",
    ]
    return {"subject": f"Your {ref.specialty} referral", "text": "\n".join(lines), "phone": phone,
            "needs_phone": not phone}
