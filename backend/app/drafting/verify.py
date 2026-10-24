"""Verify a draft against its facts (design.md §8).

A draft is a sequence of segments, each ending in one or more [F#] citations. Checks:
1. no text outside a cited segment, 2. every cited ID exists, 3. every number and date in a
segment appears in its cited facts, 4. the copy guard passes. The [PATIENT] token is ignored.
"""
from __future__ import annotations

import re
import sys

from app.config import ROOT
from app.drafting.facts import Fact, dates_in, numbers_in
from app.drafting.templates import PATIENT_TOKEN

sys.path.insert(0, str(ROOT / "scripts"))
from check_copy import violations  # noqa: E402

SEGMENT_RE = re.compile(r"(.*?)((?:\s*\[F\d+\])+)", re.S)
CITE_RE = re.compile(r"\[(F\d+)\]")


def verify(text: str, facts: list[Fact]) -> list[str]:
    by_id = {f.id: f for f in facts}
    problems: list[str] = []
    pos = 0
    for m in SEGMENT_RE.finditer(text):
        pos = m.end()
        body = m.group(1).replace(PATIENT_TOKEN, " ").strip()
        ids = CITE_RE.findall(m.group(2))
        unknown = [i for i in ids if i not in by_id]
        if unknown:
            problems.append(f"Unknown citation {', '.join(unknown)}: '{body[:60]}'")
            continue
        cited = [by_id[i] for i in ids]
        ok_dates = {d for f in cited for d in f.dates}
        ok_nums = {n for f in cited for n in f.numbers}
        for d in dates_in(body):
            if d not in ok_dates:
                problems.append(f"Date {d} is not in cited facts {', '.join(ids)}")
        for n in numbers_in(body):
            if n not in ok_nums:
                problems.append(f"Number {n} is not in cited facts {', '.join(ids)}")
    tail = text[pos:].replace(PATIENT_TOKEN, " ").strip()
    if tail:
        problems.append(f"Uncited text: '{tail[:60]}'")
    problems += [f"Copy guard: {v}" for v in violations(text)]
    return problems
