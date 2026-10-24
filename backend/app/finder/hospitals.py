"""Hospitals: MassGIS points + beds, with CMS star rating attached only on an exact normalized-name
match (design.md §5.4–5.5). No fuzzy matching, no city fallback.

The CMS clinician file has no hospital-affiliation columns, so nothing here is an "affiliation".
"""
from __future__ import annotations

import csv
import re
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Optional

from app.config import DATA_PUBLIC
from app.finder.distance import haversine_miles

ACUTE = "Acute Hospital"
BEDS_LABEL = "med/surg + ICU + pediatric beds"  # exact label; never "total beds"


def normalize_name(s: str) -> str:
    s = s.upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class CmsHospital:
    facility_id: str
    rating: Optional[int]  # None when CMS shows "Not Available"
    hospital_type: str
    emergency_services: str


@dataclass(frozen=True)
class Hospital:
    name: str
    facility_type: str
    municipality: str
    county: str
    lat: float
    lon: float
    icu_beds: int
    med_surg_beds: int
    pediatric_beds: int
    cms: Optional[CmsHospital]

    @property
    def beds(self) -> int:
        """MED_SURG + ICU + PEDIATRIC. Display with BEDS_LABEL."""
        return self.med_surg_beds + self.icu_beds + self.pediatric_beds

    def card(self, miles: int) -> dict:
        """Display dict. `cms_rating` is omitted (None) unless an exact CMS match has a rating."""
        return {
            "name": self.name,
            "town": self.municipality.title(),
            "miles": miles,
            "beds": self.beds,
            "beds_label": BEDS_LABEL,
            "icu_beds": self.icu_beds,
            "cms_rating": self.cms.rating if self.cms else None,
            "cms_emergency_services": self.cms.emergency_services if self.cms else None,
            "cms_hospital_type": self.cms.hospital_type if self.cms else None,
            "cms_facility_id": self.cms.facility_id if self.cms else None,
        }


def _int(v: str) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


@lru_cache(maxsize=1)
def cms_by_name() -> dict[str, CmsHospital]:
    out = {}
    with open(DATA_PUBLIC / "hospitals_cms_ma.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            raw = (r.get("hospital_overall_rating") or "").strip()
            out[normalize_name(r["facility_name"])] = CmsHospital(
                facility_id=r["facility_id"],
                rating=int(raw) if raw.isdigit() else None,
                hospital_type=r.get("hospital_type", ""),
                emergency_services=r.get("emergency_services", ""),
            )
    return out


@lru_cache(maxsize=1)
def all_hospitals() -> tuple[Hospital, ...]:
    cms = cms_by_name()
    out = []
    with open(DATA_PUBLIC / "hospitals_massgis.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.append(Hospital(
                name=r["FACILITY_NAME"].strip(),
                facility_type=r["FACILITY_TYPE"].strip(),
                municipality=r["MUNICIPALITY"].strip(),
                county=r["COUNTY"].strip(),
                lat=float(r["lat"]), lon=float(r["lon"]),
                icu_beds=_int(r["ICU"]), med_surg_beds=_int(r["MED_SURG"]),
                pediatric_beds=_int(r["PEDIATRIC"]),
                cms=cms.get(normalize_name(r["FACILITY_NAME"])),
            ))
    return tuple(out)


def acute_hospitals() -> tuple[Hospital, ...]:
    return tuple(h for h in all_hospitals() if h.facility_type == ACUTE)


def nearest_hospitals(point, k: int = 1) -> list[tuple[Hospital, int]]:
    """k nearest acute hospitals to `point` (.lat/.lon), as (hospital, whole miles)."""
    ranked = sorted(
        ((h, haversine_miles(point.lat, point.lon, h.lat, h.lon)) for h in acute_hospitals()),
        key=lambda x: (x[1], x[0].name),
    )
    return [(h, round(d)) for h, d in ranked[:k]]


def as_dict(h: Hospital) -> dict:
    d = asdict(h)
    d["beds"] = h.beds
    return d
