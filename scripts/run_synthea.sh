#!/usr/bin/env bash
# Generate synthetic patients for western/central Massachusetts towns.
# Usage (from repo root):  bash scripts/run_synthea.sh            # all towns, ~25 adults each
#                          POP=10 bash scripts/run_synthea.sh      # quicker
# Needs Java 17+ (Synthea's build targets Java 17). Output: data/synthea_raw/<town>/{fhir,csv}
set -euo pipefail

TOWNS=("Greenfield" "Orange" "Athol" "North Adams" "Great Barrington" "Ware")
POP="${POP:-25}"
SEED="${SEED:-42}"
REF_DATE="${REF_DATE:-20261024}"   # records end on the demo date
AGES="${AGES:-45-90}"              # adults likely to need specialty referrals
JAR="tools/synthea-with-dependencies.jar"
JAR_URL="https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar"

# 1. Java check
if ! command -v java >/dev/null; then echo "Java not found. Install JDK 17 (e.g. Temurin 17)."; exit 1; fi
JV=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)
if [[ -z "$JV" || "$JV" -lt 17 ]]; then echo "Java $JV found; Synthea needs 17+."; exit 1; fi

# 2. Jar
mkdir -p tools
if [[ ! -s "$JAR" ]]; then
  echo "Downloading Synthea jar…"
  curl -fL --retry 3 -o "$JAR" "$JAR_URL" || {
    echo "Download failed. Get synthea-with-dependencies.jar from"
    echo "  https://github.com/synthetichealth/synthea/releases  and save it as $JAR"; exit 1; }
fi

# 3. One run per town. Synthea throws on an unknown town name, so failures are loud.
mkdir -p data/synthea_raw
for TOWN in "${TOWNS[@]}"; do
  SLUG=$(echo "$TOWN" | tr '[:upper:] ' '[:lower:]_')
  OUTDIR="data/synthea_raw/$SLUG"
  if [[ -d "$OUTDIR/fhir" ]]; then echo "✓ $TOWN already generated"; continue; fi
  echo "→ $TOWN ($POP patients, ages $AGES)…"
  java -jar "$JAR" -s "$SEED" -p "$POP" -a "$AGES" -r "$REF_DATE" \
    --exporter.baseDirectory="$OUTDIR/" \
    --exporter.fhir.export=true --exporter.csv.export=true --generate.only_alive_patients=true \
    --exporter.hospital.fhir.export=false --exporter.practitioner.fhir.export=false \
    Massachusetts "$TOWN" > "data/synthea_raw/$SLUG.log" 2>&1 \
    && echo "✓ $TOWN: $(ls "$OUTDIR/fhir" | wc -l | tr -d ' ') FHIR bundles" \
    || { echo "✗ $TOWN failed — see data/synthea_raw/$SLUG.log"; tail -5 "data/synthea_raw/$SLUG.log"; }
done

echo
echo "Patients per town (CSV):"
for d in data/synthea_raw/*/csv; do
  [[ -f "$d/patients.csv" ]] && echo "  $(basename "$(dirname "$d")"): $(($(wc -l < "$d/patients.csv") - 1)) patients"
done
echo "Next: python3 scripts/select_patients.py  (pick ~10 with specialist-relevant conditions)"
