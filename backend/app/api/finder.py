"""Patients, towns, and the specialist finder."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app import clock
from app.chart import active_conditions
from app.config import FINDER_SPECIALTIES
from app.finder.rank import find
from app.finder.towns import resolve_town, towns
from app.models import COVERAGE_LABELS, Coverage
from app.store import get_repo
from app.views import patient_brief

router = APIRouter(prefix="/api")


@router.get("/towns")
def town_list() -> dict:
    """Massachusetts places from towns.csv, for the add-patient town picker."""
    return {"towns": sorted({t.name for t in towns().values()})}


@router.get("/patients")
def patients() -> dict:
    repo = get_repo()
    today = clock.today(repo)
    rows = [{**patient_brief(p, today), "suggested_specialty": p.get("suggested_specialty"),
             "suggested_condition_code": p.get("suggested_condition_code")}
            for p in repo.patients().values()]
    rows.sort(key=lambda r: (r["sample"], r["name"].lower()))
    return {"patients": rows, "specialties": list(FINDER_SPECIALTIES),
            "coverage_options": COVERAGE_LABELS}


class NewPatient(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    town: str = Field(min_length=1)
    coverage: Coverage = "unknown"
    dob: Optional[date] = None

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Name is required")
        return v


@router.post("/patients", status_code=201)
def add_patient(body: NewPatient) -> dict:
    repo = get_repo()
    town = resolve_town(body.town)
    if town is None:
        raise HTTPException(422, f"'{body.town}' is not a Massachusetts town in towns.csv")
    today = clock.today(repo)
    if body.dob and body.dob > today:
        raise HTTPException(422, "Date of birth is in the future")
    p = repo.add_patient({"name": body.name, "town": town.name, "county": town.county,
                          "coverage": body.coverage, "dob": body.dob.isoformat() if body.dob else None})
    return patient_brief(p, today)


@router.get("/patients/{patient_id}/conditions")
def conditions(patient_id: str) -> dict:
    p = get_repo().patient(patient_id)
    if p is None:
        raise HTTPException(404, "Unknown patient")
    return {"has_chart": bool(p.get("chart_id")),
            "conditions": active_conditions(p["chart_id"]) if p.get("chart_id") else []}


@router.get("/finder")
def finder(specialty: str, patient_id: str, max_miles: Optional[int] = None,
           accepts_only: bool = False, limit: int = 10, offset: int = 0) -> dict:
    p = get_repo().patient(patient_id)
    if p is None:
        raise HTTPException(404, "Unknown patient")
    try:
        return find(specialty, p["town"], coverage=p.get("coverage"), max_miles=max_miles,
                    accepts_only=accepts_only, limit=max(1, min(limit, 100)), offset=max(0, offset))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
