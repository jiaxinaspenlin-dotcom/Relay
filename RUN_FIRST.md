# Run first (minutes 0–20)

Open two terminals at the repo root. Both jobs run in parallel.

## Terminal 1: Synthea (slowest; start it first)
```bash
java -version                      # must be 17 or newer
bash scripts/run_synthea.sh        # 6 towns × 25 adults aged 45–90, records end 2026-10-24
# quicker: POP=10 bash scripts/run_synthea.sh
```
It downloads the Synthea jar into `tools/` (git-ignore it) and writes `data/synthea_raw/<town>/`.

## Terminal 2: public data
```bash
python3 scripts/fetch_public.py    # standard library only, no pip install
```
It writes `data/public/*.csv` and `SOURCES.md`, then prints a **REPORT**. Paste the REPORT back
into chat if anything looks off.

`data/public/towns.csv` (434 MA places with center points and county) is **already built**. Rebuild
it with `python3 scripts/build_towns.py` if needed.

## What's already confirmed, and what the REPORT confirms
| Check | Status |
|---|---|
| Synthea accepts the town names | **Confirmed in Synthea's source.** Greenfield, Orange, Athol, North Adams, Great Barrington, and Ware are all in its MA list. Matching ignores case, and an unknown name throws an error instead of silently substituting. |
| Synthea needs Java 17+ | **Confirmed** (`sourceCompatibility = '17'`). |
| Clinician dataset ID | REPORT line `clinicians: dataset … = "…"`. The script checks the ID by its catalog title, so it still works if the remembered ID (`mj5m-pzi6`) is wrong. |
| Exact specialty strings | REPORT `specialty strings` block, also saved in `data/public/specialties.json`. Use those exact strings in the finder. |
| Hospital-affiliation columns | REPORT notes whether they exist. If not, the finder uses "nearest hospitals" instead of affiliations. |
| HRSA headers | REPORT `hrsa:` block. The script tries the bulk CSV URL, then any file you drop in `data/raw/`. **If it says SKIPPED and a manual download takes more than 10 min, leave HRSA out.** |

## Commit
Commit `data/public/` and `data/synthea_raw/` (or just the patients you select) so the demo never
depends on live APIs. Add `tools/` and `data/raw/` to `.gitignore`.
