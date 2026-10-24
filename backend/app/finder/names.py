"""Display and grouping normalization for CMS organization names and street addresses."""
from __future__ import annotations

import re

STREET_SUFFIXES = {
    "STREET": "ST", "ST": "ST", "AVENUE": "AVE", "AVE": "AVE", "AV": "AVE", "ROAD": "RD", "RD": "RD",
    "DRIVE": "DR", "DR": "DR", "BOULEVARD": "BLVD", "BLVD": "BLVD", "LANE": "LN", "LN": "LN",
    "PLACE": "PL", "PL": "PL", "COURT": "CT", "CT": "CT", "PARKWAY": "PKWY", "PKWY": "PKWY",
    "HIGHWAY": "HWY", "HWY": "HWY", "SQUARE": "SQ", "SQ": "SQ", "TERRACE": "TER", "TER": "TER",
    "CIRCLE": "CIR", "CIR": "CIR", "WAY": "WAY", "TURNPIKE": "TPKE", "TPKE": "TPKE", "PIKE": "PIKE",
    "PLAZA": "PLZ", "PLZ": "PLZ", "ROW": "ROW", "WHARF": "WHARF",
}
# Unit designators: everything from one of these onward is dropped when no suffix was found.
UNIT_WORDS = {"STE", "SUITE", "FL", "FLR", "FLOOR", "UNIT", "RM", "ROOM", "BLDG", "BUILDING", "#",
              "DEPT", "LEVEL", "LVL"}
ORDINAL_FLOOR = re.compile(r"^\d+(ST|ND|RD|TH)$")


def address_key(addr: str) -> str:
    """Normalize a street address for grouping: uppercase, standard suffixes, and nothing after
    the street suffix (floors, suites, department names)."""
    s = re.sub(r"[.,]", " ", addr.upper()).replace("#", " # ")
    tokens = s.split()
    out: list[str] = []
    for i, t in enumerate(tokens):
        if i > 0 and t in STREET_SUFFIXES and out and not out[-1].isdigit():
            out.append(STREET_SUFFIXES[t])
            break
        if i > 0 and (t in UNIT_WORDS or ORDINAL_FLOOR.match(t)):
            break
        out.append(t)
    return " ".join(out)


SMALL = {"of", "and", "the", "at", "for", "in", "on", "to", "a", "an", "by"}
UPPER = {"MGH", "BMC", "CHA", "BIDMC", "BID", "NEBH", "HMFP", "MD", "PC", "PA", "LLC", "LLP", "PLLC",
         "USA", "VA", "II", "III", "IV", "MA", "NE", "OB", "GYN", "ENT", "MSK", "MRI", "UMMS", "BWH",
         "MWPC", "PHO", "IPA", "MSO", "ACO", "CCHS", "SSH", "MVPC", "CHC", "HMO", "FQHC"}
MIXED = {"UMASS": "UMass", "MCLEAN": "McLean", "INC": "Inc", "CORP": "Corp", "LTD": "Ltd",
         "CO": "Co", "ST": "St"}


def _word(w: str, first: bool) -> str:
    core = re.sub(r"[^A-Za-z]", "", w).upper()
    if not core:
        return w
    if core in UPPER:
        return w.upper()
    if core in MIXED:
        return w.upper().replace(core, MIXED[core])
    if not first and core.lower() in SMALL:
        return w.lower()
    if not re.search(r"[AEIOUY]", core) and len(core) <= 4:
        return w.upper()  # acronyms without vowels, e.g. "NSMC"
    # Capitalize each part of hyphenated / slashed / apostrophe words.
    return re.sub(r"[A-Za-z]+", lambda m: m.group(0).capitalize(), w.lower(), count=0) \
        if "'" not in w else w.capitalize()


def title_case(name: str) -> str:
    """Readable title case for CMS uppercase names, keeping common acronyms."""
    words = name.split()
    return " ".join(_word(w, i == 0) for i, w in enumerate(words))


ORG_DROP = {"INC", "LLC", "PC", "P", "C", "PLLC", "LLP", "CORP", "CORPORATION", "LTD", "CO",
            "INCORPORATED", "THE"}


def org_key(name: str) -> str:
    """Organization name for grouping: uppercase, no punctuation, no legal suffixes."""
    tokens = re.sub(r"[^A-Z0-9 ]", " ", name.upper()).split()
    return " ".join(t for t in tokens if t not in ORG_DROP)
