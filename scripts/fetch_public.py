#!/usr/bin/env python3
"""Fetch Relay's public data snapshots into data/public/ and print a confirmation report.

Standard library only (no pip install needed). Run from the repo root:

    python3 scripts/fetch_public.py            # everything
    python3 scripts/fetch_public.py clinicians # one source (names below)

Sources: hospitals_cms, readmissions, places, massgis_hospitals, ej, clinicians, hrsa
Every snapshot gets an entry in data/public/SOURCES.md (URL, agency, date, filters).

The report at the end answers the three early checks:
  1. clinician dataset ID + title, columns present, exact specialty strings
  2. (Synthea towns are checked by scripts/run_synthea.sh)
  3. HRSA HPSA headers, or "skipped"
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import subprocess
import time
import urllib.parse
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "public"
RAW = ROOT / "data" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)
TODAY = date.today().isoformat()
REPORT: list[str] = []


# ---------------------------------------------------------------- helpers
def get(url: str, params: dict | None = None, raw: bool = False, tries: int = 3):
    """Fetch with the system curl. data.cms.gov rejects Python's HTTP client (403) but accepts
    plain curl, so every source goes through curl for consistency. -g stops curl from treating
    the [ ] in CMS query parameters as URL globs."""
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params, safe="[]=")
    last = ""
    for i in range(tries):
        p = subprocess.run(["curl", "-sS", "-g", "-L", "--fail-with-body", "-m", "120", url],
                           capture_output=True)
        if p.returncode == 0:
            try:
                return p.stdout if raw else json.loads(p.stdout)
            except json.JSONDecodeError as e:
                last = f"not JSON: {e}; body starts {p.stdout[:120]!r}"
        else:
            last = (p.stderr.decode(errors="replace").strip() + " " +
                    p.stdout[:200].decode(errors="replace")).strip()
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed: {url}\n  {last}")


def write_csv(name: str, rows: list[dict]) -> Path:
    path = OUT / name
    if not rows:
        raise RuntimeError(f"{name}: no rows returned")
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    return path


def record_source(file: str, agency: str, url: str, filters: str, terms: str, n: int):
    src = OUT / "SOURCES.md"
    lines = src.read_text().splitlines() if src.exists() else [
        "# Public data snapshots", "",
        "| File | Agency | URL | Retrieved | Filters | Rows | Terms |",
        "|---|---|---|---|---|---|---|",
    ]
    lines = [l for l in lines if not l.startswith(f"| `{file}` ")]
    lines.append(f"| `{file}` | {agency} | {url} | {TODAY} | {filters} | {n} | {terms} |")
    src.write_text("\n".join(lines) + "\n")


def cms_query(dataset_id: str, conditions: dict | None = None, page: int = 500) -> list[dict]:
    """Page through a CMS provider-data datastore query."""
    base = f"https://data.cms.gov/provider-data/api/1/datastore/query/{dataset_id}/0"
    rows, offset = [], 0
    while True:
        params = {"limit": page, "offset": offset}
        for i, (k, v) in enumerate((conditions or {}).items()):
            params[f"conditions[{i}][property]"] = k
            params[f"conditions[{i}][value]"] = v
            params[f"conditions[{i}][operator]"] = "="
        data = get(base, params)
        batch = data.get("results", [])
        rows += batch
        total = data.get("count", len(rows))
        if not batch or len(rows) >= total:
            return rows
        offset += len(batch)


def arcgis_query(layer_url: str, where: str, fields: str, geometry: bool) -> list[dict]:
    """Page through an ArcGIS MapServer/FeatureServer layer query."""
    rows, offset = [], 0
    while True:
        params = {
            "where": where, "outFields": fields, "f": "json",
            "returnGeometry": "true" if geometry else "false", "outSR": 4326,
            "resultOffset": offset, "resultRecordCount": 1000, "orderByFields": "OBJECTID",
        }
        data = get(layer_url + "/query", params)
        if "error" in data:  # some layers reject orderByFields; retry without it
            params.pop("orderByFields")
            data = get(layer_url + "/query", params)
        if "error" in data:
            raise RuntimeError(f"ArcGIS error: {data['error']}")
        feats = data.get("features", [])
        for ft in feats:
            row = dict(ft.get("attributes", {}))
            g = ft.get("geometry") or {}
            if "x" in g:
                row["lon"], row["lat"] = round(g["x"], 6), round(g["y"], 6)
            rows.append(row)
        if not feats or not data.get("exceededTransferLimit"):
            return rows
        offset += len(feats)


# ---------------------------------------------------------------- sources
def hospitals_cms():
    rows = cms_query("xubh-q36u", {"state": "MA"})
    p = write_csv("hospitals_cms_ma.csv", rows)
    record_source(p.name, "CMS", "data.cms.gov/provider-data dataset xubh-q36u (Hospital General Information)",
                  "state=MA", "U.S. government public data", len(rows))
    REPORT.append(f"hospitals_cms: {len(rows)} MA hospitals")


def readmissions():
    rows = cms_query("9n3s-kdb3", {"state": "MA"})
    p = write_csv("readmissions_ma.csv", rows)
    record_source(p.name, "CMS", "data.cms.gov/provider-data dataset 9n3s-kdb3 (HRRP)",
                  "state=MA", "U.S. government public data", len(rows))
    REPORT.append(f"readmissions: {len(rows)} MA rows (expected ~330)")


def places():
    measures = ["Obesity among adults", "Diagnosed diabetes among adults",
                "Visits to doctor for routine checkup within the past year among adults",
                "Frequent mental distress among adults", "Current cigarette smoking among adults"]
    where = ("stateabbr='MA' AND measure in(" + ",".join(f"'{m}'" for m in measures)
             + ") AND data_value_type='Crude prevalence'")
    rows = get("https://data.cdc.gov/resource/swc5-untb.json", {
        "$select": "year,locationname,measure,data_value,low_confidence_limit,high_confidence_limit,totalpopulation",
        "$where": where, "$limit": 5000})
    p = write_csv("places_county.csv", rows)
    years = sorted({r.get("year") for r in rows})
    record_source(p.name, "CDC (PLACES)", "data.cdc.gov/resource/swc5-untb", "MA; 5 measures; crude prevalence",
                  "U.S. government public data", len(rows))
    REPORT.append(f"places: {len(rows)} rows, {len({r['locationname'] for r in rows})} counties, years {years}")


def massgis_hospitals():
    url = "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/Hospitals/MapServer/0"
    rows = arcgis_query(url, "1=1", "FACILITY_NAME,FACILITY_TYPE,MUNICIPALITY,COUNTY,ICU,MED_SURG,PEDIATRIC", True)
    p = write_csv("hospitals_massgis.csv", rows)
    record_source(p.name, "Commonwealth of Massachusetts (MassGIS)", url, "all features, WGS84 points",
                  "Official data; link the layer, don't republish the site", len(rows))
    with_pt = sum(1 for r in rows if "lat" in r)
    REPORT.append(f"massgis_hospitals: {len(rows)} facilities, {with_pt} with coordinates")


def ej():
    url = "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/EJ2020/MapServer/0"
    rows = arcgis_query(url, "EJ='Yes'",
                        "MUNICIPALITY,TOTAL_POP,PCT_MINORITY,LIMENGHHPCT,BG_MHHI,EJ,EJ_CRIT_DESC", False)
    p = write_csv("ej_blockgroups.csv", rows)
    record_source(p.name, "Commonwealth of Massachusetts (EEA / MassGIS)", url, "EJ='Yes' block groups",
                  "Official data; link the layer", len(rows))
    REPORT.append(f"ej: {len(rows)} EJ block groups across {len({r.get('MUNICIPALITY') for r in rows})} municipalities")


# --- clinicians ---------------------------------------------------------
NAME_COLS = re.compile(r"(^|_)(lst|frst|mid|last|first|middle)(_|$)|provider_(last|first|middle)_name|^suff$|gndr", re.I)
ALIASES = {
    "specialty": ["pri_spec"],
    "org": ["facility_name", "org_nm"],
    "addr": ["adr_ln_1"],
    "city": ["citytown", "city_town", "cty", "city"],
    "zip": ["zip_code", "zip"],
    "state": ["state", "st"],
    "ind_assign": ["ind_assgn", "assgn"],
    "grp_assign": ["grp_assgn"],
    "telehealth": ["telehlth", "telehealth"],
    "hosp_ccn": ["hosp_afl_1"],
}
TARGET_SPECIALTIES = {
    "cardiology": r"CARDIO",
    "gastroenterology": r"GASTRO",
    "endocrinology": r"ENDOCRIN",
    "nephrology": r"NEPHRO",
    "orthopedics": r"ORTHOP",
    "neurology": r"^NEUROLOGY$|NEUROLOGY",
    "pulmonology": r"PULMON",
    "oncology": r"ONCOLOG",
}


def find_clinician_dataset() -> tuple[str, str, dict]:
    """Confirm the dataset ID by title instead of trusting a remembered ID. Returns (id, title, metadata)."""
    guess = "mj5m-pzi6"
    try:
        meta = get(f"https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/{guess}")
        if "national downloadable file" in meta.get("title", "").lower():
            return guess, meta["title"], meta
    except RuntimeError:
        pass
    items = get("https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items")
    ranked = [it for it in items if "national downloadable file" in it.get("title", "").lower()]
    ranked.sort(key=lambda it: "doctor" not in (it.get("title", "") + json.dumps(it.get("theme", ""))).lower())
    if ranked:
        return ranked[0]["identifier"], ranked[0]["title"], ranked[0]
    raise RuntimeError("Could not find the Doctors and Clinicians National Downloadable File in the CMS catalog")


def _norm(col: str) -> str:
    """'City/Town' -> 'city_town', 'ZIP Code' -> 'zip_code', so bulk CSV headers match API names."""
    return re.sub(r"[^a-z0-9]+", "_", col.strip().lower()).strip("_")


def _download_url(meta: dict) -> str:
    for d in meta.get("distribution", []):
        d = d.get("data", d)
        url = d.get("downloadURL") or d.get("downloadUrl")
        if url and url.lower().split("?")[0].endswith(".csv"):
            return url
    raise RuntimeError("No CSV downloadURL in the dataset metadata")


def clinicians_bulk(meta: dict) -> list[dict]:
    """Fallback when the datastore query is refused: download the national CSV (large; a few minutes)
    once into data/raw/, then keep only MA rows."""
    url = _download_url(meta)
    dest = RAW / "dac_national.csv"
    if not dest.exists() or dest.stat().st_size < 1_000_000:
        print(f"   datastore query refused; downloading the full national file:\n   {url}", flush=True)
        r = subprocess.run(["curl", "-g", "-L", "--fail", "-#", "-o", str(dest), url])
        if r.returncode != 0:
            raise RuntimeError(f"bulk download failed (curl exit {r.returncode}): {url}")
    rows = []
    with dest.open(encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        names = [_norm(c) for c in reader.fieldnames or []]
        state_col = next((c for c in ALIASES["state"] if c in names), None)
        if not state_col:
            raise RuntimeError(f"No state column in bulk file. Headers: {names}")
        for raw in reader:
            row = {_norm(k): v for k, v in raw.items() if k is not None}
            if row.get(state_col) == "MA":
                rows.append(row)
    REPORT.append(f"  (via bulk CSV {url}; raw copy in data/raw/, git-ignored)")
    return rows


def clinicians():
    ds_id, title, meta = find_clinician_dataset()
    try:
        probe = get(f"https://data.cms.gov/provider-data/api/1/datastore/query/{ds_id}/0", {"limit": 1}, tries=1)
        cols = list((probe.get("results") or [{}])[0].keys())
        pick = {k: next((c for c in v if c in cols), None) for k, v in ALIASES.items()}
        if not pick["state"] or not pick["specialty"]:
            raise RuntimeError(f"Unexpected columns in {ds_id}: {cols}")
        rows = cms_query(ds_id, {pick["state"]: "MA"})
    except RuntimeError:
        rows = clinicians_bulk(meta)
        cols = list(rows[0].keys()) if rows else []
        pick = {k: next((c for c in v if c in cols), None) for k, v in ALIASES.items()}
        if not rows or not pick["specialty"]:
            raise RuntimeError(f"Bulk file parsed but no usable MA rows/columns: {cols}")
    # Privacy decision (product.md): no individual clinician names in our snapshot.
    kept = [{k: v for k, v in r.items() if not NAME_COLS.search(k)} for r in rows]
    p = write_csv("clinicians_ma.csv", kept)
    record_source(p.name, "CMS", f"data.cms.gov/provider-data dataset {ds_id} ({title})",
                  f"{pick['state']}=MA; individual name columns dropped", "U.S. government public data", len(kept))

    spec_counts = Counter(r.get(pick["specialty"], "") for r in rows)
    matched = {key: sorted(s for s in spec_counts if re.search(rx, s or "", re.I))
               for key, rx in TARGET_SPECIALTIES.items()}
    (OUT / "specialties.json").write_text(json.dumps({
        "dataset_id": ds_id, "title": title, "column": pick["specialty"],
        "matched": matched, "all_counts": dict(spec_counts.most_common()),
    }, indent=2))

    REPORT.append(f"clinicians: dataset {ds_id} = \"{title}\"; {len(rows)} MA rows")
    REPORT.append("  column mapping: " + ", ".join(f"{k}->{v}" for k, v in pick.items()))
    if not pick["hosp_ccn"]:
        REPORT.append("  NOTE: no hospital-affiliation columns in this file. Finder falls back to nearest "
                      "hospitals, or use CMS's separate facility-affiliation dataset.")
    if pick["telehealth"]:
        REPORT.append(f"  NOTE: telehealth column '{pick['telehealth']}' exists. Read its definition in the "
                      "data dictionary before showing it.")
    REPORT.append("  specialty strings (exact, with MA counts):")
    for key, strings in matched.items():
        REPORT.append(f"    {key}: " + "; ".join(f"{s!r} ({spec_counts[s]})" for s in strings) if strings
                      else f"    {key}: NONE FOUND")


# --- HRSA (optional, timeboxed) ------------------------------------------
HRSA_CANDIDATES = [
    "https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_PC.csv",
]


def hrsa():
    """Try known download URL(s), then a manually downloaded file in data/raw/. Never blocks the build."""
    text, origin = None, None
    for url in HRSA_CANDIDATES:
        try:
            text, origin = get(url, raw=True).decode("utf-8-sig", errors="replace"), url
            break
        except RuntimeError:
            continue
    if text is None:
        local = sorted(RAW.glob("*HPSA*PC*.csv")) + sorted(RAW.glob("*hpsa*.csv"))
        if local:
            text, origin = local[0].read_text(encoding="utf-8-sig", errors="replace"), str(local[0])
    if text is None:
        REPORT.append("hrsa: SKIPPED. No download reachable and no file in data/raw/. Manual option: "
                      "data.hrsa.gov → Data Downloads → Shortage Areas → HPSA Primary Care (CSV) → save "
                      "into data/raw/ and rerun `python3 scripts/fetch_public.py hrsa`. If that takes "
                      "more than 10 min, leave HRSA out.")
        return
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []
    state_col = next((h for h in headers if re.search(r"state abbr", h, re.I)), None)
    rows = [r for r in reader if state_col and r.get(state_col) == "MA"]
    REPORT.append(f"hrsa: source {origin}")
    REPORT.append(f"  {len(headers)} headers: " + " | ".join(headers))
    if not rows:
        REPORT.append("  could not filter to MA (no state-abbreviation column matched). Skip HRSA.")
        return
    p = write_csv("hrsa_hpsa_pc_ma.csv", rows)
    record_source(p.name, "HRSA", origin, f"{state_col}=MA", "U.S. government public data", len(rows))
    REPORT.append(f"  {len(rows)} MA rows written")


SOURCES = {f.__name__: f for f in [hospitals_cms, readmissions, places, massgis_hospitals, ej, clinicians, hrsa]}


def main(argv: list[str]) -> int:
    chosen = argv or list(SOURCES)
    failed = []
    for name in chosen:
        print(f"→ {name} …", flush=True)
        try:
            SOURCES[name]()
        except Exception as e:  # keep going; report at the end
            failed.append(name)
            REPORT.append(f"{name}: FAILED — {e}")
    print("\n================ REPORT ================")
    print("\n".join(REPORT))
    print("========================================")
    if failed:
        print(f"Failed: {', '.join(failed)}. Rerun just those: python3 scripts/fetch_public.py {' '.join(failed)}")
    return 1 if set(failed) - {"hrsa", "readmissions"} else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
