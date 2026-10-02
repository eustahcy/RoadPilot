#!/usr/bin/env bash
# Cotygodniowa aktualizacja danych RoadPilot (timer systemd roadpilot-weekly, niedziela 03:00, jako root):
#   1. OSM Polska + importy (ograniczenia, fotoradary, POI, miejscowości, strefy) — scripts/osm-update.sh
#   2. Valhalla (silnik tras) — budowa w osobnym katalogu, podmiana i sprawdzenie trasy; błąd = powrót do starych danych
#   3. własne kafelki wektorowe — scripts/tiles-build.sh (podmienia katalog po udanej budowie)
#   4. prędkości z jazdy kierowców i podejrzane ograniczenia — speed-build.mjs, suspects-build.mjs
#   5. restart API
# Budowa Valhalli i kafelków potrzebuje kilku GB RAM — Metin2 jest wyłączony na stałe (2026-10-02); gdyby ktoś go uruchomił,
# zatrzymujemy go na czas budowy i wznawiamy na końcu (także po błędzie). Log: /var/log/roadpilot-weekly.log.
set -euo pipefail
exec >>/var/log/roadpilot-weekly.log 2>&1

REPO=/home/debian/RoadPilot
OSM=/opt/roadpilot-osm
VAL=/opt/roadpilot-valhalla
NEW=/opt/roadpilot-valhalla.new
GAME=m2pb-06b67463-game
IMAGE=ghcr.io/valhalla/valhalla:latest
as_debian() { runuser -u debian -- "$@"; }
log() { echo "== $(date '+%F %T') $*"; }

game_stopped=0
cleanup() {
  if [ "$game_stopped" = 1 ]; then log "uruchamiam ponownie $GAME"; docker start "$GAME" >/dev/null || true; fi
  rm -rf "$NEW"
}
trap cleanup EXIT

log "start"

log "1. OSM + importy"
as_debian bash "$REPO/scripts/osm-update.sh"

log "2. Valhalla — budowa w $NEW"
if docker ps --format '{{.Names}}' | grep -qx "$GAME"; then docker stop "$GAME" >/dev/null; game_stopped=1; fi
rm -rf "$NEW"
mkdir -p "$NEW"
cp "$VAL/valhalla.json" "$VAL/build.sh" "$VAL/run.sh" "$VAL/resume.sh" "$NEW/"
ln "$OSM/poland-latest.osm.pbf" "$NEW/poland.osm.pbf"
run() { docker run --rm -v "$NEW":/data -w /data "$IMAGE" "$@"; }
run valhalla_build_admins -c /data/valhalla.json /data/poland.osm.pbf
run bash -c "valhalla_build_timezones > /data/timezones.sqlite" || log "strefy czasowe pominięte"
run valhalla_build_tiles -c /data/valhalla.json /data/poland.osm.pbf
run valhalla_build_extract -c /data/valhalla.json -v
[ -s "$NEW/tiles.tar" ] || { log "BŁĄD: brak tiles.tar — zostają stare dane"; exit 1; }
# Serwis czyta tylko paczkę tiles.tar — katalog roboczy kafelków zajmuje kilka GB.
rm -rf "$NEW/tiles"

log "2b. podmiana Valhalli"
docker rm -f roadpilot-valhalla >/dev/null 2>&1 || true
rm -rf "$VAL.old"
mv "$VAL" "$VAL.old"
mv "$NEW" "$VAL"
bash "$VAL/run.sh"
ok=0
for i in $(seq 1 30); do
  sleep 4
  if curl -sf -X POST localhost:8002/route -d '{"locations":[{"lat":52.23,"lon":21.0},{"lat":52.40,"lon":16.92}],"costing":"truck"}' >/dev/null; then ok=1; break; fi
done
if [ "$ok" != 1 ]; then
  log "BŁĄD: nowa Valhalla nie liczy tras — przywracam poprzednie dane"
  docker rm -f roadpilot-valhalla >/dev/null 2>&1 || true
  mv "$VAL" "$VAL.failed" && mv "$VAL.old" "$VAL" && bash "$VAL/run.sh"
  rm -rf "$VAL.failed"
  exit 1
fi
rm -rf "$VAL.old"
log "Valhalla OK"

log "3. kafelki wektorowe"
as_debian env TILEMAKER_ARGS=--skip-integrity bash "$REPO/scripts/tiles-build.sh" || log "UWAGA: kafelki nie zbudowane — zostają poprzednie"

log "4. prędkości z jazdy i podejrzane ograniczenia"
as_debian node --env-file=/etc/roadpilot-api.env "$REPO/server/speed-build.mjs" || log "UWAGA: speed-build nie powiódł się"
as_debian node --env-file=/etc/roadpilot-api.env "$REPO/server/suspects-build.mjs" || log "UWAGA: suspects-build nie powiódł się"

log "5. restart API"
systemctl restart roadpilot-api
log "gotowe"
