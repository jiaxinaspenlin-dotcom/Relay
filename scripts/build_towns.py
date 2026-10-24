#!/usr/bin/env python3
"""Rebuild data/public/towns.csv (MA town center points + county) from Synthea's own geography files.

No network needed: reads geography/demographics.csv and geography/zipcodes.csv from the Synthea jar
(or from a Synthea source checkout).

    python3 scripts/build_towns.py                                  # uses tools/synthea-with-dependencies.jar
    python3 scripts/build_towns.py path/to/synthea/src/main/resources/geography
"""
import csv
import io
import statistics
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def open_geo(src: Path):
    if src.is_dir():
        return lambda name: (src / name).open(encoding="utf-8")
    z = zipfile.ZipFile(src)
    return lambda name: io.TextIOWrapper(z.open(f"geography/{name}"), encoding="utf-8")


def main(arg: str | None) -> None:
    src = Path(arg) if arg else ROOT / "tools" / "synthea-with-dependencies.jar"
    opener = open_geo(src)
    demo = {r["NAME"]: r for r in csv.DictReader(opener("demographics.csv")) if r["STNAME"] == "Massachusetts"}
    town_pt, zcta_pts = {}, defaultdict(list)
    for r in csv.DictReader(opener("zipcodes.csv")):
        if r["ST"] != "MA":
            continue
        pt = (float(r["LAT"]), float(r["LON"]))
        (zcta_pts[r["NAME"]].append(pt) if r["ZCTA5"] else town_pt.__setitem__(r["NAME"], pt))
    rows = []
    for name, d in sorted(demo.items()):
        if name in town_pt:
            (lat, lon), method = town_pt[name], "town-level point"
        elif zcta_pts.get(name):
            lat = statistics.mean(p[0] for p in zcta_pts[name])
            lon = statistics.mean(p[1] for p in zcta_pts[name])
            method = "mean of ZCTA points"
        else:
            continue
        rows.append({"town": name, "county": d["CTYNAME"].replace(" County", ""), "lat": round(lat, 6),
                     "lon": round(lon, 6), "pop_2015": d["POPESTIMATE2015"], "point_method": method})
    out = ROOT / "data" / "public" / "towns.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} MA places written to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
