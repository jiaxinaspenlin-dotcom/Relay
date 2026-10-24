"""FHIR R4 export (design.md §7). Bundle.type = collection, modeled on HL7 BSeR's ServiceRequest +
Task pattern (no conformance claim). Validated with fhir.resources.R4B in tests/test_fhir.py.

Relay records dates, not times. Where FHIR requires an instant (Appointment.start,
Provenance.recorded, Bundle.timestamp) we use local midnight in America/New_York and say so.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time
from html import escape
from zoneinfo import ZoneInfo

from app.chart import patient_resource
from app.loop.states import STAGE_LABELS
from app.models import Referral

BASE = "https://relay.local/fhir"
ORIGIN = f"{BASE}/CodeSystem/data-origin"
STAGE_SYSTEM = f"{BASE}/CodeSystem/referral-stage"
PAC_SYSTEM = f"{BASE}/NamingSystem/cms-org-pac-id"
SNOMED = "http://snomed.info/sct"
TZ = ZoneInfo("America/New_York")

SYNTHETIC_TAG = {"system": ORIGIN, "code": "synthetic", "display": "Synthetic data"}
DIRECTORY_TAG = {"system": ORIGIN, "code": "public-directory",
                 "display": "Organization from the CMS public clinician directory"}
DATE_ONLY_NOTE = "Date only; Relay does not record times (local midnight used)."

SR_STATUS = {"closed": "completed", "cancelled": "revoked", "declined": "revoked",
             "draft": "draft", "patient_barrier": "on-hold"}
APPT_STATUS = {"booked": "booked", "fulfilled": "fulfilled", "noshow": "noshow",
               "cancelled": "cancelled"}


def _id(s: str) -> str:
    """FHIR id: [A-Za-z0-9-.]{1,64}"""
    return re.sub(r"[^A-Za-z0-9.\-]", "-", s)[:64]


def _instant(d: date, hhmm: str | None = None) -> str:
    t = time(int(hhmm[:2]), int(hhmm[3:5])) if hhmm else time(0, 0)
    return datetime.combine(d, t, tzinfo=TZ).isoformat()


def _meta_for(sample: bool):
    """meta.tag: synthetic for sample records; public-directory for CMS directory organizations."""
    def meta(directory: bool = False) -> dict:
        tags = ([SYNTHETIC_TAG] if sample else []) + ([DIRECTORY_TAG] if directory else [])
        return {"tag": tags} if tags else {}
    return meta


def _div(text: str) -> dict:
    body = escape(text).replace("\n", "<br/>")
    return {"status": "generated", "div": f'<div xmlns="http://www.w3.org/1999/xhtml">{body}</div>'}


def _patient_parts(patient: dict) -> tuple[dict, dict, dict]:
    """(name, address, demographics) from the Synthea chart for sample patients, otherwise from
    the patient record entered in Relay."""
    if patient.get("chart_id"):
        src = patient_resource(patient["chart_id"])
        official = next((n for n in src.get("name", []) if n.get("use") == "official"),
                        src.get("name", [{}])[0])
        given = [re.sub(r"\d+", "", g) for g in official.get("given", [])]
        name = {"use": "official", "family": re.sub(r"\d+", "", official.get("family", "")), "given": given}
        a = (src.get("address") or [{}])[0]
        addr = {"city": a.get("city"), "state": a.get("state"), "postalCode": a.get("postalCode"),
                "country": a.get("country")}
        demo = {"gender": src.get("gender"), "birthDate": src.get("birthDate")}
    else:
        parts = patient["name"].split()
        name = {"use": "official", "text": patient["name"], "family": parts[-1], "given": parts[:-1]}
        addr = {"city": patient["town"], "state": "MA", "country": "US"}
        demo = {"birthDate": patient["dob"]} if patient.get("dob") else {}
    return name, addr, demo


def build_bundle(ref: Referral, patient: dict, today: date) -> dict:
    _meta = _meta_for(bool(ref.sample))
    rid = _id(ref.id)
    name, addr, demo = _patient_parts(patient)

    pid = _id(ref.patient_id)
    perf_org = f"org-{_id(ref.performer.id)}"
    directory = not ref.performer.fictional
    refs = {
        "patient": f"Patient/{pid}",
        "pcp": "Practitioner/pcp",
        "coordinator": "Practitioner/coordinator",
        "req_org": "Organization/requester",
        "perf_org": f"Organization/{perf_org}",
        "location": f"Location/loc-{_id(ref.performer.id)}",
        "condition": f"Condition/cond-{rid}",
        "sr": f"ServiceRequest/sr-{rid}",
        "task": f"Task/task-{rid}",
        "appt": f"Appointment/appt-{rid}",
        "comp": f"Composition/plan-{rid}",
    }
    R = lambda k, display=None: {"reference": refs[k], **({"display": display} if display else {})}  # noqa: E731

    res: list[dict] = []
    res.append({"resourceType": "Patient", "id": pid, "meta": _meta(), "name": [name],
                "address": [{k: v for k, v in addr.items() if v}], **{k: v for k, v in demo.items() if v}})
    cond = ref.reason_condition
    res.append({
        "resourceType": "Condition", "id": f"cond-{rid}", "meta": _meta(),
        "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                                       "code": "active"}]},
        "code": ({"coding": [{"system": SNOMED, "code": cond.code, "display": cond.display}],
                  "text": cond.display} if cond.code else {"text": cond.display}),
        "subject": R("patient"),
        **({"onsetDateTime": cond.onset.isoformat()} if cond.onset else {}),
    })
    res += [
        {"resourceType": "Practitioner", "id": "pcp", "meta": _meta(),
         "name": [{"text": ref.requester.clinician}]},
        {"resourceType": "Practitioner", "id": "coordinator", "meta": _meta(),
         "name": [{"text": ref.requester.coordinator}]},
        {"resourceType": "Organization", "id": "requester", "meta": _meta(),
         "name": ref.requester.practice},
        {"resourceType": "PractitionerRole", "id": "pcp-role", "meta": _meta(),
         "practitioner": R("pcp"), "organization": R("req_org"),
         "code": [{"text": "Primary care clinician"}]},
    ]
    org = {"resourceType": "Organization", "id": perf_org, "meta": _meta(directory),
           "name": ref.performer.name}
    if directory and ref.performer.org_pac_id:
        org["identifier"] = [{"system": PAC_SYSTEM, "value": ref.performer.org_pac_id}]
    res.append(org)
    loc_addr = {"city": ref.performer.town, "state": "MA"}
    if ref.performer.address:
        loc_addr["line"] = [ref.performer.address]
    if ref.performer.zip5:
        loc_addr["postalCode"] = ref.performer.zip5
    res.append({"resourceType": "Location", "id": f"loc-{_id(ref.performer.id)}",
                "meta": _meta(directory), "name": ref.performer.name, "address": loc_addr,
                "managingOrganization": R("perf_org")})

    res.append({
        "resourceType": "ServiceRequest", "id": f"sr-{rid}", "meta": _meta(),
        "identifier": [{"system": f"{BASE}/NamingSystem/referral-id", "value": ref.id}],
        "status": SR_STATUS.get(ref.stage, "active"), "intent": "order",
        "category": [{"coding": [{"system": SNOMED, "code": "3457005", "display": "Patient referral"}]}],
        "code": {"text": ref.specialty},
        "priority": ref.priority,
        "subject": R("patient"),
        "authoredOn": ref.authored_on.isoformat(),
        "requester": R("pcp", ref.requester.clinician),
        "performer": [R("perf_org", ref.performer.name)],
        "reasonReference": [R("condition", cond.display)],
        "note": [{"text": ref.reason_text}],
        **({"replaces": [{"reference": f"ServiceRequest/sr-{_id(ref.replaces)}"}]} if ref.replaces else {}),
    })
    task = {
        "resourceType": "Task", "id": f"task-{rid}", "meta": _meta(),
        "status": ref.task_status,
        "businessStatus": {"coding": [{"system": STAGE_SYSTEM, "code": ref.business_status,
                                       "display": STAGE_LABELS[ref.stage]}]},
        "intent": "order",
        "focus": R("sr"), "for": R("patient"),
        "requester": R("pcp"), "owner": R("perf_org"),
        "authoredOn": ref.authored_on.isoformat(),
        "lastModified": (ref.events[-1].at if ref.events else ref.authored_on).isoformat(),
    }
    if ref.plan:
        task["output"] = [{"type": {"text": "Returned plan"}, "valueReference": R("comp")}]
    res.append(task)

    if ref.appointment:
        res.append({
            "resourceType": "Appointment", "id": f"appt-{rid}", "meta": _meta(),
            "status": APPT_STATUS[ref.appointment.status],
            "start": _instant(ref.appointment.start, ref.appointment.time),
            **({} if ref.appointment.time else {"comment": DATE_ONLY_NOTE}),
            "basedOn": [R("sr")],
            "participant": [{"actor": R("patient"), "status": "accepted"},
                            {"actor": R("location"), "status": "accepted"}],
        })

    recipients = {"specialist": "perf_org", "patient": "patient", "pcp": "pcp"}
    for c in ref.communications:
        res.append({
            "resourceType": "Communication", "id": _id(f"comm-{c.id or len(res)}"), "meta": _meta(),
            "status": "completed", "basedOn": [R("sr")], "subject": R("patient"),
            "recipient": [R(recipients[c.recipient])], "sender": R("coordinator"),
            "sent": c.sent.isoformat(), "payload": [{"contentString": c.text}],
            "medium": [{"text": {"copy": "Copied text", "email": "Email", "print": "Printed for fax",
                                 "manual": "Recorded in Relay"}[c.channel]}],
            "category": [{"text": "Referral" if c.kind == "referral" else "Follow-up"}],
            **({"note": [{"text": "Edited by sender before sending"}]} if c.edited else {}),
        })

    if ref.plan:
        p = ref.plan
        sections = [
            ("Patient", patient["name"]),
            ("From", p.from_),
            ("Reason/Conditions", p.reason),
            ("Visit date", p.visit_date.isoformat()),
            ("Assessment", p.assessment),
            ("Plan", p.plan),
            ("Actions for the PCP", p.actions_for_pcp or "None listed"),
            ("Questions/contact", p.questions_contact or "Not provided"),
            ("Omitted fields", p.omitted_fields_note or "None"),
        ]
        res.append({
            "resourceType": "Composition", "id": f"plan-{rid}", "meta": _meta(),
            "status": "final",
            "type": {"coding": [{"system": "http://loinc.org", "code": "11488-4",
                                 "display": "Consult note"}]},
            "subject": R("patient"), "date": p.returned_on.isoformat(),
            "author": [R("perf_org", p.from_)],
            "title": "Specialist care update (care-update template sections)",
            "section": [{"title": t, "text": _div(v)} for t, v in sections],
        })

    actors = {"pcp": "pcp", "coordinator": "coordinator", "specialist": "perf_org", "office": "perf_org",
              "patient": "patient", "system": "req_org"}
    for i, ev in enumerate(ref.events, 1):
        prov = {
            "resourceType": "Provenance", "id": f"prov-{rid}-{i}", "meta": _meta(),
            "target": [R("task")], "recorded": _instant(ev.at),
            "activity": {"text": f"Stage → {STAGE_LABELS.get(ev.stage, ev.stage)}"
                                 + (f" (via {ev.source})" if ev.source else "")},
            "agent": [{"who": R(actors[ev.actor])}],
        }
        if ev.note:
            prov["reason"] = [{"text": ev.note}]
        res.append(prov)

    for r in res:
        if not r.get("meta"):
            r.pop("meta", None)  # FHIR JSON forbids empty objects
    return {
        "resourceType": "Bundle", "id": f"relay-{rid}", **({"meta": _meta()} if _meta() else {}),
        "type": "collection", "timestamp": _instant(today),
        "entry": [{"fullUrl": f"{BASE}/{r['resourceType']}/{r['id']}", "resource": r} for r in res],
    }
