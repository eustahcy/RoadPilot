#!/usr/bin/env bash
# Odświeżenie ograniczeń dla ciężarówek z OpenStreetMap (Polska) w bazie RoadPilot — np. raz w miesiącu.
# Wymaga osmium-tool. Geofabrik blokuje ten serwer, więc pobieramy z lustra openstreetmap.fr.
set -euo pipefail
DIR="${OSM_DIR:-/opt/roadpilot-osm}"
cd "$DIR"
curl -sS -o poland-latest.osm.pbf.part https://download.openstreetmap.fr/extracts/europe/poland-latest.osm.pbf
mv poland-latest.osm.pbf.part poland-latest.osm.pbf
osmium tags-filter poland-latest.osm.pbf \
  nw/maxheight nw/maxheight:physical nw/maxweight nw/maxweightrating nw/maxaxleload nw/maxwidth nw/maxlength \
  w/hgv=no,destination,delivery w/maxspeed:hgv n/barrier=height_restrictor \
  -o truck.osm.pbf --overwrite
osmium export truck.osm.pbf -f geojsonseq --add-unique-id=type_id --geometry-types=point,linestring -o truck.geojsonseq --overwrite
# Fotoradary, odcinkowe pomiary prędkości, kamery na czerwonym (relacje enforcement z węzłami from/to/device).
osmium tags-filter poland-latest.osm.pbf n/highway=speed_camera r/type=enforcement -o enforcement.osm.pbf --overwrite
osmium cat enforcement.osm.pbf -f opl -o enforcement.opl --overwrite
cd "$(dirname "$0")/.."
node --env-file=/etc/roadpilot-api.env server/osm-import.mjs "$DIR/truck.geojsonseq"
node --env-file=/etc/roadpilot-api.env server/enforcement-import.mjs "$DIR/enforcement.opl"
