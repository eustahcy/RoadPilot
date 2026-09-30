#!/usr/bin/env bash
# Własne kafelki wektorowe mapy (Polska) z OpenStreetMap — np. raz w miesiącu, po scripts/osm-update.sh (ten sam plik PBF).
# Wymaga tilemaker ≥ 3.0 (https://github.com/systemed/tilemaker/releases — binarka „tilemaker” w PATH).
# Budowa Polski potrzebuje ok. 6–8 GB RAM (--store na dysku zmniejsza do ~2 GB, ale trwa dłużej).
# Wynik: katalog z plikami z/x/y.pbf (gzip) serwowany przez API (VTILES_DIR w /etc/roadpilot-api.env).
set -euo pipefail
DIR="${OSM_DIR:-/opt/roadpilot-osm}"
OUT="${VTILES_DIR:-$DIR/vtiles}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$DIR/poland-latest.osm.pbf" ] || { echo "Brak $DIR/poland-latest.osm.pbf — uruchom najpierw scripts/osm-update.sh"; exit 1; }
rm -rf "$OUT.new"
tilemaker --input "$DIR/poland-latest.osm.pbf" --output "$OUT.new" \
  --config "$HERE/server/tiles/config.json" --process "$HERE/server/tiles/process.lua" \
  --store "$DIR/tilemaker-store" ${TILEMAKER_ARGS:-}
rm -rf "$DIR/tilemaker-store"
# Podmiana w całości — API czyta nowy katalog od razu (bez restartu).
[ -d "$OUT" ] && mv "$OUT" "$OUT.old"
mv "$OUT.new" "$OUT"
rm -rf "$OUT.old"
echo "Kafelki gotowe: $OUT ($(du -sh "$OUT" | cut -f1))"
