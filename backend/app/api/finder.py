"""Patients (synthetic) and the specialist finder."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.chart import active_conditions
from app.config import FINDER_SPECIALTIES
from app.finder.rank import find
from app.store import store
from app.views import patient_brief

router = APIRouter(prefix="/api")


@router.get("/patients")
def patients() -> dict:
    live = store.seed_meta.get("live_demo_patient")
    rows = []
    for p in store.patients.values():
        rows.append({**patient_brief(p), "suggested_specialty": p.get("specialty"),
                     "suggested_condition_code": (p.get("reason_condition") or {}).get("CODE"),
                     "live_demo": p["id"] == live})
    rows.sort(key=lambda r: (not r["live_demo"], r["synthetic_name"]))
    return {"synthetic": True, "patients": rows, "specialties": list(FINDER_SPECIALTIES)}


@router.get("/patients/{patient_id}/conditions")
def conditions(patient_id: str) -> dict:
    if patient_id not in store.patients:
        raise HTTPException(404, "Unknown patient")
    return {"synthetic": True, "conditions": active_conditions(patient_id)}


@router.get("/finder")
def finder(specialty: str, patient_id: str, limit: int = 25) -> dict:
    p = store.patients.get(patient_id)
    if p is None:
        raise HTTPException(404, "Unknown patient")
    try:
        return find(specialty, p["town"], payer=p.get("payer"), limit=limit)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
