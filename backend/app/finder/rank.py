"""Finder ranking (design.md §5.6): straight-line distance ascending only. No rating sort, no
composite score, never "best". Practices without a matched town go last.

Filters: maximum straight-line miles (25 / 50 / 100) and "accepts Medicare assignment" only.
Paging: `offset` + `limit` (the UI shows 10 at a time).
"""
from __future__ import annotations

from typing import Optional

from app.config import FINDER_SPECIALTIES
from app.finder.distance import miles_between
from app.finder.practices import practices_for
from app.finder.towns import resolve_town
from app.models import MEDICARE

TELEHEALTH_NOTE = "Ask the office whether a telehealth visit is offered"
MAX_MILES_CHOICES = (25, 50, 100)


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def distance_label(miles: Optional[int], town: Optional[str]) -> str:
    if miles is None:
        return "Distance unavailable"
    if miles == 0:
        return f"In {town}" if town else "Same town"
    return f"{plural(miles, 'mile')} straight-line"


def rank_by_distance(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r["miles"] is None, r["miles"] or 0, r["label"], r["id"]))


def find(specialty: str, patient_town: str, *, coverage: Optional[str] = None,
         max_miles: Optional[int] = None, accepts_only: bool = False,
         limit: Optional[int] = 10, offset: int = 0) -> dict:
    """Practice cards for `specialty`, sorted by straight-line miles from the patient's town."""
    if specialty not in FINDER_SPECIALTIES:
        raise ValueError(f"Unsupported specialty: {specialty}")
    if max_miles is not None and max_miles not in MAX_MILES_CHOICES:
        raise ValueError(f"max_miles must be one of {MAX_MILES_CHOICES}")
    origin = resolve_town(patient_town)
    if origin is None:
        raise ValueError(f"Unknown patient town: {patient_town}")
    rows = []
    for p in practices_for(FINDER_SPECIALTIES[specialty]):
        d = p.to_dict()
        d["miles"] = miles_between(origin, p) if p.lat is not None else None
        d["distance_label"] = distance_label(d["miles"], p.town)
        d["clinician_label"] = plural(p.clinician_count, "clinician") + " in this specialty"
        h = d["nearest_hospital"]
        if h:
            h["distance_label"] = (f"in {h['town']}" if h["miles"] == 0
                                   else f"{plural(h['miles'], 'mile')} from {p.town}")
        rows.append(d)
    unfiltered = len(rows)
    if max_miles is not None:
        rows = [r for r in rows if r["miles"] is not None and r["miles"] <= max_miles]
    if accepts_only:
        rows = [r for r in rows if r["medicare_assignment"] == "accepts"]
    ranked = rank_by_distance(rows)
    page = ranked[offset: offset + limit] if limit else ranked[offset:]
    return {
        "specialty": specialty,
        "pri_spec": FINDER_SPECIALTIES[specialty],
        "patient_town": origin.name,
        "patient_town_point": {"lat": origin.lat, "lon": origin.lon},
        "sort": "distance",
        "distance_basis": "Straight-line miles between town centers",
        "medicare_prominent": coverage in MEDICARE,
        "telehealth_note": TELEHEALTH_NOTE,
        "filters": {"max_miles": max_miles, "accepts_only": accepts_only},
        "total_unfiltered": unfiltered,
        "total": len(ranked),
        "offset": offset,
        "has_more": offset + len(page) < len(ranked),
        "distance_unavailable": sum(1 for r in ranked if r["miles"] is None),
        "results": page,
        "source": {
            "practices": "CMS Doctors and Clinicians National Downloadable File (mj5m-pzi6), MA",
            "hospitals": "MassGIS Hospitals layer (acute hospitals); CMS Hospital General "
                         "Information (xubh-q36u) rating on exact name match only",
        },
    }
