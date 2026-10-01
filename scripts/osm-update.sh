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
# Pinezki przy trasie: stacje paliw, MOP-y i parkingi (parkingi bez hgv odrzuca poi-import.mjs).
osmium tags-filter poland-latest.osm.pbf nwr/amenity=fuel,parking nwr/highway=rest_area,services -o pois.osm.pbf --overwrite
osmium export pois.osm.pbf -f geojsonseq --add-unique-id=type_id --geometry-types=point,polygon -o pois.geojsonseq --overwrite
# Obszar zabudowany / poza nim (limity dla ciężarówek w nawigacji): id drogi → u | r, plik czyta API (ZONES_FILE).
osmium tags-filter poland-latest.osm.pbf w/source:maxspeed=PL:urban,PL:rural w/zone:traffic=PL:urban,PL:rural \
  w/maxspeed:type=PL:urban,PL:rural w/maxspeed=PL:urban,PL:rural -R -o zones.osm.pbf --overwrite
osmium cat zones.osm.pbf -f opl | awk '{ print substr($1, 2) "\t" ($0 ~ /=PL:urban/ ? "u" : "r") }' > zones.tsv.part
mv zones.tsv.part zones.tsv
cd "$(dirname "$0")/.."
node --env-file=/etc/roadpilot-api.env server/osm-import.mjs "$DIR/truck.geojsonseq"
node --env-file=/etc/roadpilot-api.env server/enforcement-import.mjs "$DIR/enforcement.opl"
node --env-file=/etc/roadpilot-api.env server/poi-import.mjs "$DIR/pois.geojsonseq"
