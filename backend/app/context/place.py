"""Place context for the patient's town and county (R6, design.md §6).

Context describes places, never people. Every item carries source, year, level, and a one-line
"what this can't tell you" note. Context never goes into messages to specialists or patients (R6.3).
"""
from __future__ import annotations

import csv
from collections import Counter
from functools import lru_cache

from app.config import DATA_PUBLIC
from app.finder.hospitals import nearest_hospitals
from app.finder.towns import resolve_town

SOURCES = {
    "places": "https://data.cdc.gov/resource/swc5-untb",
    "ej": "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/EJ2020/MapServer/0",
    "hrsa": "https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_PC.csv",
    "hospitals": "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/Hospitals/MapServer/0",
}

PLACES_ORDER = [
    "Visits to doctor for routine checkup within the past year among adults",
    "Diagnosed diabetes among adults",
    "Obesity among adults",
    "Frequent mental distress among adults",
    "Current cigarette smoking among adults",
]


def _read(name: str, encoding: str = "utf-8") -> list[dict]:
    with open(DATA_PUBLIC / name, newline="", encoding=encoding) as f:
        return list(csv.DictReader(f))


@lru_cache(maxsize=1)
def _places() -> list[dict]:
    return _read("places_county.csv")


@lru_cache(maxsize=1)
def _ej() -> list[dict]:
    return _read("ej_blockgroups.csv")


@lru_cache(maxsize=1)
def _hrsa() -> list[dict]:
    return _read("hrsa_hpsa_pc_ma.csv", encoding="utf-8-sig")


def places_item(county: str) -> dict:
    rows = {r["measure"]: r for r in _places() if r["locationname"] == county}
    values = [
        {"measure": m, "value": float(rows[m]["data_value"]),
         "ci_low": float(rows[m]["low_confidence_limit"]),
         "ci_high": float(rows[m]["high_confidence_limit"]), "unit": "%"}
        for m in PLACES_ORDER if m in rows
    ]
    years = sorted({rows[m]["year"] for m in rows})
    return {
        "kind": "places",
        "title": f"{county} County health estimates",
        "values": values,
        "source": "CDC PLACES (crude prevalence)",
        "source_url": SOURCES["places"],
        "year": years[-1] if years else None,
        "level": "County (model-based estimate)",
        "cannot_tell_you": "Model-based county estimates. They say nothing about this patient "
                           "or about this town specifically.",
    }


def ej_item(town: str) -> dict:
    groups = [r for r in _ej() if r["MUNICIPALITY"].strip().lower() == town.lower()]
    criteria = Counter(r["EJ_CRIT_DESC"] for r in groups)
    return {
        "kind": "ej",
        "title": f"Environmental-justice block groups in {town}",
        "block_groups": len(groups),
        "criteria": [{"criteria": c, "block_groups": n} for c, n in criteria.most_common()],
        "source": "Massachusetts EEA / MassGIS, Environmental Justice Populations",
        "source_url": SOURCES["ej"],
        "year": "2020",
        "level": "Census block group, summarized to town",
        "cannot_tell_you": "Criteria describe block-group populations, not this patient or "
                           "household, and not where in town the patient lives.",
    }


def hrsa_item(town: str, county: str) -> dict:
    county_name = f"{county} County, MA"
    rows = [r for r in _hrsa()
            if r["Common County Name"] == county_name and r["HPSA Status"] == "Designated"]
    by_id: dict[str, dict] = {}
    town_markers = (f"{town} town,".lower(), f"{town} city,".lower())
    for r in rows:
        d = by_id.setdefault(r["HPSA ID"], {
            "hpsa_id": r["HPSA ID"],
            "name": r["HPSA Name"].strip(),
            "designation_type": r["Designation Type"],
            "score": int(r["HPSA Score"]) if r["HPSA Score"].strip().isdigit() else None,
            "last_update": r["HPSA Designation Last Update Date"],
            "includes_town": False,
        })
        if r["HPSA Component Name"].lower().startswith(town_markers):
            d["includes_town"] = True
    designations = sorted(by_id.values(), key=lambda d: (not d["includes_town"], d["name"]))
    as_of = max((r["Data Warehouse Record Create Date Text"] for r in rows), default="")
    return {
        "kind": "hrsa",
        "title": f"Primary-care shortage designations in {county} County",
        "designations": designations,
        "source": "HRSA Data Warehouse, Primary Care HPSA (status: Designated)",
        "source_url": SOURCES["hrsa"],
        "year": as_of.replace("/", "-") or None,
        "level": "Designation area: geographic area, population group, or facility",
        "cannot_tell_you": "A designation describes an area, population group, or facility. It "
                           "can't tell you whether this patient can get a primary-care visit.",
    }


def hospitals_item(town) -> dict:
    near = nearest_hospitals(town, k=3)
    return {
        "kind": "hospitals",
        "title": f"Nearest acute hospitals to {town.name}",
        "hospitals": [h.card(miles) for h, miles in near],
        "source": "MassGIS Hospitals layer",
        "source_url": SOURCES["hospitals"],
        "year": "2026 (retrieved 2026-10-24)",
        "level": "Hospital point; straight-line miles from the town center",
        "cannot_tell_you": "Bed counts don't show specialty services or availability. Distance "
                           "is straight-line from the town center, not travel time.",
    }


def place_context(patient_town: str) -> dict:
    town = resolve_town(patient_town)
    if town is None:
        raise ValueError(f"Unknown town: {patient_town}")
    return {
        "town": town.name,
        "county": town.county,
        "describes": "places, not people",
        "items": [places_item(town.county), ej_item(town.name), hrsa_item(town.name, town.county),
                  hospitals_item(town)],
    }
