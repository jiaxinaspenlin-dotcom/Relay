#!/usr/bin/env python3
"""Copy guard for Relay (referral loop): fail if app copy, message templates, or AI output
contain clinical-decision, overclaiming, or person-scoring language.
Rules: .kiro/steering/ai-guardrails.md and product.md

Usage:
    python scripts/check_copy.py                  # scan default locations
    python scripts/check_copy.py FILE [FILE ...]  # scan specific files
    from check_copy import violations              # used by drafting/verify.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TARGETS = ["frontend/src/copy.ts", "backend/app/drafting/templates.py", "docs/PITCH.md"]
SUFFIXES = {".ts", ".tsx", ".py", ".md", ".html", ".txt"}

BANNED: list[tuple[str, str]] = [
    # clinical decisions belong to clinicians
    (r"\bdiagnos(e|es|ed|is|ing)\b", "Relay does not diagnose"),
    (r"\b(recommend|recommends|recommended|recommendation)\b", "Relay does not recommend care"),
    (r"\b(should|must) be seen\b", "Relay never decides how or when a patient is seen"),
    (r"\bshould (use|have|get) (a )?telehealth\b", "telehealth appropriateness is a clinical call"),
    (r"\b(prescribe|prescribed|dosage|dose)\b", "no medication content in AI or app copy"),
    (r"\bbest (specialist|doctor|cardiologist|provider)\b", "Relay ranks by stated criteria, not quality judgments"),
    # distance and coverage honesty
    (r"\bdrive[- ]?time\b", "distance is straight-line, not drive time"),
    (r"\b\d+\s*(min|mins|minutes|hours?|hrs?)\s+(away|drive)\b", "distance is straight-line, not travel time"),
    (r"\bin[- ]network\b", "Relay only knows Medicare assignment"),
    (r"\b(accepts|takes) (your|their|the patient's) insurance\b", "Relay only knows Medicare assignment"),
    (r"\b(does not|doesn't|do not|don't|won't) accept medicare\b",
     "CMS has only Y/M; say 'May accept Medicare assignment — confirm with the office'"),
    (r"\bmedicare assignment:?\s*(no|none)\b", "CMS has no 'No' value for Medicare assignment"),
    (r"\bno medicare assignment\b", "CMS has no 'No' value for Medicare assignment"),
    (r"\baffiliated hospitals?\b", "the CMS clinician file has no affiliations; say 'Nearest hospital'"),
    (r"\btotal beds\b", "label beds 'med/surg + ICU + pediatric beds'"),
    # places, not people
    (r"\b(high|low)[- ]risk (patient|person|people)\b", "community data are not person scores"),
    (r"\bvulnerable (patient|person)\b", "community data are not person scores"),
    (r"\b(patient|person)'?s? (svi|vulnerability) score\b", "SVI describes places, not people"),
    # blame and overclaiming
    (r"\bignor(ed|ing) (the|this|your) referral\b", "describe elapsed time, not intent"),
    (r"\bnon-?complian(t|ce)\b", "describe barriers, not the patient"),
    (r"\b(BSeR|360X)[- ](compliant|conformant|certified)\b", "do not claim conformance"),
    (r"\bHIPAA[- ]compliant\b", "the demo makes no compliance claim"),
    (r"\breal patients?\b", "all patient data are synthetic"),
    # scheduling happens between the patient and the specialist office, never by Relay or AI
    (r"\byour appointment is booked\b", "Relay never books; the office and patient schedule"),
    (r"\bwe scheduled\b", "Relay never books; the office and patient schedule"),
    (r"\bbooked by AI\b", "the AI assistant never books"),
    (r"\bconfirmed your appointment\b", "Relay never confirms appointments for the office"),
    # referral requirements: only the B2 hint wording is allowed
    (r"\bno referral (is )?needed\b", "state referral rules only as the plan-specific hint"),
    (r"\breferral (is )?required\b", "state referral rules only as the plan-specific hint"),
]
ALLOW_MARK = "copy-guard: allow"


def violations(text: str) -> list[str]:
    out = []
    for n, line in enumerate(text.splitlines() or [text], 1):
        if ALLOW_MARK in line:
            continue
        for pattern, why in BANNED:
            m = re.search(pattern, line, flags=re.I)
            if m:
                out.append(f"line {n}: '{m.group(0)}' — {why}")
    return out


def _files(targets):
    for t in targets:
        p = Path(t) if Path(t).is_absolute() else ROOT / t
        if p.is_file():
            yield p
        elif p.is_dir():
            yield from (f for f in sorted(p.rglob("*")) if f.is_file() and f.suffix in SUFFIXES)


def main(argv: list[str]) -> int:
    found = []
    for f in _files(argv or DEFAULT_TARGETS):
        try:
            text = f.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        found += [f"{f.name} {v}" for v in violations(text)]
    if found:
        print("Copy guard failed:\n  " + "\n  ".join(found))
        print("See .kiro/steering/ai-guardrails.md")
        return 1
    print("Copy guard: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
