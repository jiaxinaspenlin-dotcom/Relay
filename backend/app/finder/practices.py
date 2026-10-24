"""Group CMS clinician rows into practice locations (design.md §5.1).

Output is organization + address level only: no clinician names or individual identifiers.
The CMS `telehlth` column is never loaded (R3.7).
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Optional

import pandas as pd

from app.config import DATA_PUBLIC, FINDER_SPECIALTIES
from app.finder.hospitals import nearest_hospitals
from app.finder.names import address_key, org_key, title_case
from app.finder.towns import Town, _key, resolve_town

# Columns read from clinicians_ma.csv. `telehlth` is deliberately absent. `npi` is used only to
# count distinct clinicians and is never output.
USECOLS = ["npi", "pri_spec", "facility_name", "org_pac_id", "adr_ln_1", "city_town", "state",
           "zip_code", "telephone_number", "ind_assgn", "grp_assgn"]

MEDICARE_LABELS = {
    # CMS data dictionary: Y = accepts the Medicare-approved amount as payment in full;
    # M = may accept Medicare assignment. There is no "No" value.
    "accepts": "Accepts Medicare assignment",
    "may_accept": "May accept Medicare assignment — confirm with the office",
}


@dataclass(frozen=True)
class Practice:
    id: str
    specialty: str
    pri_spec: str
    label: str
    facility_name: str  # "" when CMS has no organization name
    org_pac_id: str
    address: str
    city_raw: str
    town: Optional[str]  # towns.csv name, None if unmatched
    county: Optional[str]
    zip5: str
    clinician_count: int
    medicare_assignment: str  # "accepts" | "may_accept"
    medicare_label: str
    lat: Optional[float]
    lon: Optional[float]
    nearest_hospital: Optional[dict]  # hospital card relative to the practice town
    phone: str = ""  # most common CMS telephone_number at this location, as 413-555-0142

    def to_dict(self) -> dict:
        return asdict(self)


def _title_addr(s: str) -> str:
    return " ".join(w.capitalize() if w.isalpha() else w for w in s.split())


def _practice_id(*parts: str) -> str:
    return "p-" + hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


@lru_cache(maxsize=1)
def _clinicians() -> pd.DataFrame:
    df = pd.read_csv(DATA_PUBLIC / "clinicians_ma.csv", usecols=USECOLS, dtype=str,
                     keep_default_na=False)
    df = df[df["pri_spec"].isin(set(FINDER_SPECIALTIES.values()))].copy()
    df["city_key"] = df["city_town"].map(_key)
    df["zip5"] = df["zip_code"].str[:5]
    for c in ("facility_name", "adr_ln_1"):
        df[c] = df[c].str.strip()
    # Grouping keys: one card per organization + street address (suite/floor dropped).
    df["org_key"] = df["facility_name"].map(org_key)
    df["addr_key"] = df["adr_ln_1"].map(address_key)
    return df


def format_phone(raw: str) -> str:
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if len(digits) == 11 and digits[0] == "1":
        digits = digits[1:]
    return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}" if len(digits) == 10 else ""


def medicare_assignment(values: list[str]) -> str:
    """Practice-level label key from clinicians' `ind_assgn` values (Y/M)."""
    return "accepts" if values and all(v == "Y" for v in values) else "may_accept"


@lru_cache(maxsize=8)
def practices_for(pri_spec: str) -> tuple[Practice, ...]:
    if pri_spec not in FINDER_SPECIALTIES.values():
        raise ValueError(f"Unsupported specialty: {pri_spec}")
    specialty = next(k for k, v in FINDER_SPECIALTIES.items() if v == pri_spec)
    df = _clinicians()
    df = df[df["pri_spec"] == pri_spec]
    out = []
    for (okey, addr, city_key, zip5), g in df.groupby(
            ["org_key", "addr_key", "city_key", "zip5"], sort=True):
        per_clinician = g.drop_duplicates("npi")
        fac = g["facility_name"].mode().iloc[0] if okey else ""
        town: Optional[Town] = resolve_town(g["city_town"].iloc[0])
        town_name = town.name if town else g["city_town"].iloc[0].strip().title()
        label = title_case(fac) if fac else f"Practice at {_title_addr(addr)}, {town_name}"
        assign = medicare_assignment(per_clinician["ind_assgn"].tolist())
        hospital = None
        if town:
            (h, miles), = nearest_hospitals(town, k=1)
            hospital = h.card(miles)
        pacs = sorted({p for p in g["org_pac_id"] if p})
        out.append(Practice(
            id=_practice_id(okey, addr, city_key, zip5),
            specialty=specialty, pri_spec=pri_spec, label=label, facility_name=fac,
            org_pac_id=pacs[0] if len(pacs) == 1 else "",
            address=_title_addr(addr), city_raw=g["city_town"].iloc[0], town=town.name if town else None,
            county=town.county if town else None, zip5=zip5,
            clinician_count=int(per_clinician["npi"].nunique()),
            medicare_assignment=assign, medicare_label=MEDICARE_LABELS[assign],
            lat=town.lat if town else None, lon=town.lon if town else None,
            nearest_hospital=hospital,
            phone=next((f for f in (format_phone(x) for x in g["telephone_number"].value_counts().index) if f), ""),
        ))
    return tuple(out)
