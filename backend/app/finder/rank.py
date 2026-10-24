"""Finder ranking (design.md §5.6): straight-line distance ascending only. No rating sort, no
composite score, never "best". Practices without a matched town go last."""
from __future__ import annotations

from typing import Optional

from app.config import FINDER_SPECIALTIES
from app.finder.distance import miles_between
from app.finder.practices import practices_for
from app.finder.towns import resolve_town

TELEHEALTH_NOTE = "Ask the office whether a telehealth visit is offered"
MEDICARE_PAYERS = frozenset({"Medicare", "Dual Eligible"})


def rank_by_distance(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r["miles"] is None, r["miles"] or 0, r["label"], r["id"]))


def find(specialty: str, patient_town: str, *, payer: Optional[str] = None,
         limit: Optional[int] = 25) -> dict:
    """Practice cards for `specialty` (demo name, e.g. "Cardiology"), sorted by straight-line miles
    from the patient's town center."""
    if specialty not in FINDER_SPECIALTIES:
        raise ValueError(f"Unsupported specialty: {specialty}")
    origin = resolve_town(patient_town)
    if origin is None:
        raise ValueError(f"Unknown patient town: {patient_town}")
    rows = []
    for p in practices_for(FINDER_SPECIALTIES[specialty]):
        d = p.to_dict()
        d["miles"] = miles_between(origin, p) if p.lat is not None else None
        rows.append(d)
    ranked = rank_by_distance(rows)
    return {
        "specialty": specialty,
        "pri_spec": FINDER_SPECIALTIES[specialty],
        "patient_town": origin.name,
        "patient_town_point": {"lat": origin.lat, "lon": origin.lon},
        "sort": "distance",
        "distance_basis": "Straight-line miles between town centers",
        "medicare_prominent": payer in MEDICARE_PAYERS,
        "telehealth_note": TELEHEALTH_NOTE,
        "total": len(ranked),
        "distance_unavailable": sum(1 for r in ranked if r["miles"] is None),
        "results": ranked[:limit] if limit else ranked,
        "source": {
            "practices": "CMS Doctors and Clinicians National Downloadable File (mj5m-pzi6), MA",
            "hospitals": "MassGIS Hospitals layer (acute hospitals); CMS Hospital General "
                         "Information (xubh-q36u) rating on exact name match only",
        },
    }
