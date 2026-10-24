"""AI call transcript → suggested Log update. Never applies anything.

Pipeline: strip voice tags → extract fields (LLM at temperature 0, or deterministic rules when no
LLM is configured) → deterministic validation against the transcript → proposed stage checked
against loop/states.py. Anything that fails validation is set to null and explained.

Voice tags ("[happy]", "[slow]") and spoken-number formats ("four one three, five five five, zero
one four two") were found in a real test call; both are handled here.
"""
from __future__ import annotations

import json
import os
import re
from typing import Optional

import httpx

from app.loop.states import allowed_next
from app.models import Referral

VOICE_TAG = re.compile(r"\[[a-z ]+\]")
YES_NO = {"yes", "no", "unknown"}
MISSING_ALLOWED = {"records", "insurance_authorization", "test_results", "other"}
MISSING_WORDS = {
    "records": ("record", "notes", "chart"),
    "insurance_authorization": ("authorization", "auth", "prior auth"),
    "test_results": ("test result", "labs", "lab result", "imaging", "results"),
    "other": (),
}
DIGIT_WORDS = {"zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3", "four": "4",
               "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"}
STAGE_TARGET = {"Received-complete": "received", "Received-incomplete": "received",
                "Patient contacted": "patient_contacted"}

EXTRACTION_PROMPT = """You read a phone call between an AI assistant (agent) and a specialist office \
(user) about one referral. Return ONLY a JSON object with these keys:
received: "yes" | "no" | "unknown"  (did the office say it received the referral)
missing_items: list of any of "records", "insurance_authorization", "test_results", "other"
patient_contacted: "yes" | "no" | "unknown"  (has the office contacted the patient to schedule)
scheduling_phone: the scheduling phone number as ###-###-####, or null
scheduling_hours: the office hours as said, or null
note: one short sentence of anything else the office said, or ""
Use only what the office (user) said. If something was not said, use "unknown" or null."""


class EmptyTranscript(ValueError):
    pass


class LLMUnavailable(RuntimeError):
    pass


def strip_tags(text: str) -> str:
    return re.sub(r"\s{2,}", " ", VOICE_TAG.sub("", text)).strip()


def clean_turns(turns: list[dict]) -> list[dict]:
    out = [{"role": t["role"], "message": strip_tags(t["message"])} for t in turns]
    out = [t for t in out if t["message"]]
    if not out:
        raise EmptyTranscript("The transcript is empty")
    return out


def as_text(turns: list[dict]) -> str:
    return "\n".join(f"{t['role']}: {t['message']}" for t in turns)


# ---------------------------------------------------------------- normalization

def digit_runs(text: str) -> list[str]:
    """Digit sequences in `text`, treating spoken digit words and written digits the same.
    Separators inside a number (spaces, commas, hyphens, dots) are ignored."""
    runs, cur = [], ""
    for tok in re.findall(r"[A-Za-z]+|[0-9][0-9\-.()]*", text):
        low = tok.lower()
        if low in DIGIT_WORDS:
            cur += DIGIT_WORDS[low]
        elif tok[0].isdigit():
            cur += re.sub(r"\D", "", tok)
        else:
            if cur:
                runs.append(cur)
            cur = ""
    if cur:
        runs.append(cur)
    return runs


def phone_digits(phone: str) -> str:
    d = re.sub(r"\D", "", phone or "")
    return d[1:] if len(d) == 11 and d.startswith("1") else d


def format_phone(d: str) -> str:
    return f"{d[:3]}-{d[3:6]}-{d[6:]}"


def norm_words(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9: ]", " ", text.lower())).strip()


# ---------------------------------------------------------------- extraction

def llm_extract(transcript: str) -> dict:
    """LLM extraction at temperature 0 (Anthropic messages API). Raises LLMUnavailable when no
    key is configured. The transcript has no patient name: the agent uses initials."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise LLMUnavailable("No LLM configured")
    model = os.environ.get("RELAY_LLM_MODEL", "claude-3-5-haiku-latest")
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": model, "max_tokens": 400, "temperature": 0, "system": EXTRACTION_PROMPT,
              "messages": [{"role": "user", "content": transcript}]},
        timeout=30,
    )
    r.raise_for_status()
    text = "".join(b.get("text", "") for b in r.json().get("content", []))
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("The LLM did not return JSON")
    return json.loads(m.group(0))


def rules_extract(turns: list[dict]) -> dict:
    """Deterministic fallback when no LLM is configured: reads the office's answers that follow
    each of the agent's questions."""
    out = {"received": "unknown", "missing_items": [], "patient_contacted": "unknown",
           "scheduling_phone": None, "scheduling_hours": None, "note": ""}
    last_q = ""
    for t in turns:
        msg = t["message"].lower()
        if t["role"] == "agent":
            last_q = msg
            continue
        yes = bool(re.search(r"\b(yes|yeah|yep|we did|it was|we have)\b", msg))
        no = bool(re.search(r"\b(no|not yet|nope|haven't|have not)\b", msg))
        if "received" in last_q and out["received"] == "unknown":
            out["received"] = "yes" if yes else "no" if no else "unknown"
        if "missing" in last_q:
            for item, words in MISSING_WORDS.items():
                if any(w in msg for w in words) and item not in out["missing_items"]:
                    out["missing_items"].append(item)
        if "contacted" in last_q and out["patient_contacted"] == "unknown":
            out["patient_contacted"] = "no" if no else "yes" if yes else "unknown"
        if out["scheduling_phone"] is None:
            run = next((r for r in digit_runs(t["message"]) if len(phone_digits(r)) == 10), None)
            if run:
                out["scheduling_phone"] = format_phone(phone_digits(run))
        if out["scheduling_hours"] is None and re.search(r"\b(monday|tuesday|wednesday|thursday|friday|weekdays)\b", msg):
            hours = re.sub(r"^(and )?(the )?office hours are ", "", t["message"].strip(), flags=re.I).rstrip(".")
            out["scheduling_hours"] = hours.replace(",", "")
    return out


# ---------------------------------------------------------------- validation

def validate(raw: dict, turns: list[dict], ref: Referral) -> dict:
    """Deterministic checks. Failing fields become null and are explained in validation_errors."""
    errors: list[str] = []
    text = as_text(turns)
    office_text = "\n".join(t["message"] for t in turns if t["role"] == "user")
    out = {}

    for k in ("received", "patient_contacted"):
        v = str(raw.get(k, "unknown")).lower()
        if v not in YES_NO:
            errors.append(f"{k} was '{v}', not yes, no, or unknown")
            v = "unknown"
        out[k] = v

    items = []
    for item in raw.get("missing_items") or []:
        item = str(item).lower().replace(" ", "_")
        if item == "authorization":
            item = "insurance_authorization"
        if item not in MISSING_ALLOWED:
            errors.append(f"Missing item '{item}' is not a known item")
        elif item != "other" and not any(w in office_text.lower() for w in MISSING_WORDS[item]):
            errors.append(f"Missing item '{item}' was not said by the office")
        elif item not in items:
            items.append(item)
    out["missing_items"] = items

    phone = raw.get("scheduling_phone")
    if phone:
        d = phone_digits(str(phone))
        if len(d) != 10:
            errors.append(f"Scheduling phone '{phone}' is not a 10-digit number")
            phone = None
        elif not any(d in run for run in digit_runs(text)):
            errors.append(f"Scheduling phone {format_phone(d)} does not appear in the transcript")
            phone = None
        else:
            phone = format_phone(d)
    out["scheduling_phone"] = phone or None

    hours = raw.get("scheduling_hours")
    if hours:
        if norm_words(str(hours)) not in norm_words(text):
            errors.append(f"Hours '{hours}' do not appear in the transcript")
            hours = None
    out["scheduling_hours"] = hours or None
    out["note"] = str(raw.get("note") or "")[:500]

    if out["patient_contacted"] == "yes":
        proposed = "Patient contacted"
    elif out["received"] == "yes":
        proposed = "Received-incomplete" if items else "Received-complete"
    else:
        proposed = None
    if proposed and STAGE_TARGET[proposed] not in allowed_next(ref):
        errors.append(f"{proposed} is not an allowed next step from {ref.stage.replace('_', ' ')}")
        proposed = None
    out["proposed_stage"] = proposed
    out["validation_errors"] = errors
    return out


def process(turns: list[dict], ref: Referral) -> dict:
    cleaned = clean_turns(turns)
    try:
        raw = llm_extract(as_text(cleaned))
        extractor = "llm"
    except LLMUnavailable:
        raw = rules_extract(cleaned)
        extractor = "rules"
    result = validate(raw, cleaned, ref)
    result["extractor"] = extractor
    result["applied"] = False  # never applied; the coordinator confirms in Log update
    return result
