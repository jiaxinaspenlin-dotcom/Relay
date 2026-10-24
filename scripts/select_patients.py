#!/usr/bin/env python3
"""Pick ~10 demo patients from Synthea output whose charts plausibly need one of the four finder
specialties, and copy their FHIR bundles into data/synthetic/patients/.

    python3 scripts/select_patients.py            # default: 10 patients
    python3 scripts/select_patients.py --n 12

Reads data/synthea_raw/<town>/csv/{patients,conditions,payer_transitions,payers}.csv
Writes data/synthetic/selected_patients.json (+ FHIR bundle copies) and prints a table.
Everything here is synthetic (Synthea, Apache-2.0).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "synthea_raw"
OUT = ROOT / "data" / "synthetic"
DEMO_TODAY = date(2026, 10, 24)

# Finder label -> (exact CMS pri_spec, condition-description regex). Order = priority when a
# patient matches several.
SPECIALTIES = {
    "Cardiology": ("CARDIOVASCULAR DISEASE (CARDIOLOGY)",
                   r"heart failure|atrial fibrillation|coronary|ischemic heart|myocardial infarction|angina"),
    "Nephrology": ("NEPHROLOGY",
                   r"chronic kidney disease|end[- ]stage renal|renal (failure|disease)|kidney disease"),
    "Gastroenterology": ("GASTROENTEROLOGY",
                         r"crohn|ulcerative colitis|polyp of colon|cirrhosis|hepatitis c|gastrointestinal hemorrhage|barrett"),
    "Endocrinology": ("ENDOCRINOLOGY",
                      r"(?<!pre)diabetes|hypothyroid|hyperthyroid|thyroid"),
}
EXCLUDE = re.compile(r"prediabetes", re.I)
LIVE_DEMO_TOWN = "North Adams"   # the live "new referral" in the demo script


def read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def age(birth: str) -> int:
    b = date.fromisoformat(birth[:10])
    return DEMO_TODAY.year - b.year - ((DEMO_TODAY.month, DEMO_TODAY.day) < (b.month, b.day))


def current_payer(pid: str, transitions: list[dict], payers: dict[str, str]) -> str:
    rows = [t for t in transitions if t.get("PATIENT") == pid]
    if not rows:
        return "Unknown"
    key = "START_DATE" if "START_DATE" in rows[0] else "START_YEAR"
    latest = max(rows, key=lambda t: t.get(key) or "")
    return payers.get(latest.get("PAYER", ""), latest.get("PAYER", "Unknown")) or "Unknown"


def load_town(town_dir: Path) -> list[dict]:
    c = town_dir / "csv"
    patients = read(c / "patients.csv")
    conditions = read(c / "conditions.csv")
    transitions = read(c / "payer_transitions.csv")
    payers = {p["Id"]: p.get("NAME", "") for p in read(c / "payers.csv")}
    fhir_files = list((town_dir / "fhir").glob("*.json"))
    out = []
    for p in patients:
        if p.get("DEATHDATE"):
            continue
        pid = p["Id"]
        active = [x for x in conditions if x["PATIENT"] == pid and not x.get("STOP")]
        matches = {}
        for label, (_, rx) in SPECIALTIES.items():
            hits = [x for x in active if re.search(rx, x["DESCRIPTION"], re.I) and not EXCLUDE.search(x["DESCRIPTION"])]
            if hits:
                matches[label] = sorted(hits, key=lambda x: x["START"])[-1]  # most recent onset
        fhir = next((f for f in fhir_files if pid in f.name), None)
        out.append({
            "id": pid,
            "synthetic_name": f"{p.get('FIRST', '')} {p.get('LAST', '')}".strip(),
            "town": p.get("CITY", ""), "county": p.get("COUNTY", "").replace(" County", ""),
            "zip": p.get("ZIP", ""), "age": age(p["BIRTHDATE"]), "sex": p.get("GENDER", ""),
            "payer": current_payer(pid, transitions, payers),
            "matches": matches,
            "active_conditions": sorted({x["DESCRIPTION"] for x in active}),
            "fhir_source": str(fhir.relative_to(ROOT)) if fhir else None,
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    args = ap.parse_args()

    everyone = [p for d in sorted(RAW.iterdir()) if (d / "csv").is_dir() for p in load_town(d)]
    eligible = [p for p in everyone if p["matches"] and p["fhir_source"]]
    print(f"{len(everyone)} living patients; {len(eligible)} with a condition matching a finder specialty")

    # Greedy pick: guarantee the live-demo patient, then balance specialties and towns.
    chosen, spec_count, town_count = [], {k: 0 for k in SPECIALTIES}, {}

    def take(p, spec):
        p = dict(p, specialty=spec, pri_spec=SPECIALTIES[spec][0], reason_condition=p["matches"][spec])
        chosen.append(p)
        spec_count[spec] += 1
        town_count[p["town"]] = town_count.get(p["town"], 0) + 1

    live = [p for p in eligible if p["town"] == LIVE_DEMO_TOWN]
    live.sort(key=lambda p: ("Cardiology" not in p["matches"], -p["age"]))
    if live:
        spec = "Cardiology" if "Cardiology" in live[0]["matches"] else next(iter(live[0]["matches"]))
        take(live[0], spec)
    pool = [p for p in eligible if not chosen or p["id"] != chosen[0]["id"]]
    while len(chosen) < args.n and pool:
        best = min(
            ((p, s) for p in pool for s in p["matches"]),
            key=lambda ps: (spec_count[ps[1]], town_count.get(ps[0]["town"], 0), -ps[0]["age"]),
        )
        take(*best)
        pool = [p for p in pool if p["id"] != best[0]["id"]]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "patients").mkdir(exist_ok=True)
    for p in chosen:
        src = ROOT / p["fhir_source"]
        dest = OUT / "patients" / f"{p['id']}.json"
        shutil.copyfile(src, dest)
        p["fhir_file"] = str(dest.relative_to(ROOT))
        p.pop("matches")
    (OUT / "selected_patients.json").write_text(json.dumps({
        "note": "SYNTHETIC — generated by Synthea; not real people.",
        "demo_today": DEMO_TODAY.isoformat(),
        "live_demo_patient": chosen[0]["id"] if live else None,
        "patients": chosen,
    }, indent=2))

    print(f"\n{'#':>2}  {'town':<17}{'age':>4} {'sex':<3} {'payer':<22}{'specialty':<17}reason")
    for i, p in enumerate(chosen, 1):
        print(f"{i:>2}  {p['town']:<17}{p['age']:>4} {p['sex']:<3} {p['payer'][:21]:<22}"
              f"{p['specialty']:<17}{p['reason_condition']['DESCRIPTION']}")
    print("\nSpecialty counts:", spec_count)
    if not live:
        print(f"WARNING: no eligible patient in {LIVE_DEMO_TOWN}. Pick another live-demo town, or rerun "
              f"Synthea there with more patients:  rm -rf data/synthea_raw/north_adams && POP=25 bash scripts/run_synthea.sh")
    if len(chosen) < args.n:
        print(f"WARNING: only {len(chosen)} eligible patients. Rerun Synthea with POP=25 for more.")
    print(f"\nWrote {OUT / 'selected_patients.json'} and {len(chosen)} FHIR bundles to {OUT / 'patients'}")


if __name__ == "__main__":
    main()
