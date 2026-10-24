"""Read selected Synthea FHIR bundles (data/synthetic/patients/*.json). All synthetic."""
from __future__ import annotations

import json
from functools import lru_cache

from app.config import DATA_SYNTHETIC

SNOMED = "http://snomed.info/sct"


@lru_cache(maxsize=32)
def bundle(patient_id: str) -> dict:
    path = DATA_SYNTHETIC / "patients" / f"{patient_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _resources(patient_id: str, rtype: str) -> list[dict]:
    return [e["resource"] for e in bundle(patient_id)["entry"]
            if e["resource"]["resourceType"] == rtype]


def patient_resource(patient_id: str) -> dict:
    return _resources(patient_id, "Patient")[0]


def active_conditions(patient_id: str) -> list[dict]:
    """Active chart conditions as {id, code, system, display, onset}, deduplicated by code
    (latest onset wins), sorted by display."""
    by_code: dict[str, dict] = {}
    for c in _resources(patient_id, "Condition"):
        status = c.get("clinicalStatus", {}).get("coding", [{}])[0].get("code")
        if status != "active":
            continue
        coding = next((x for x in c["code"]["coding"] if x.get("system") == SNOMED),
                      c["code"]["coding"][0])
        row = {"id": c["id"], "code": coding["code"], "system": "SNOMED-CT",
               "display": coding.get("display") or c["code"].get("text", ""),
               "onset": (c.get("onsetDateTime") or "")[:10] or None}
        prev = by_code.get(row["code"])
        if prev is None or (row["onset"] or "") > (prev["onset"] or ""):
            by_code[row["code"]] = row
    return sorted(by_code.values(), key=lambda r: r["display"].lower())
