#!/usr/bin/env bash
# Wysyła build RoadPilot na hosting FTP (simply.com, tuike.pl/roadpilot/). Dane dostępowe z pliku poza repozytorium.
set -euo pipefail
CONF="${ROADPILOT_FTP_ENV:-$HOME/.config/roadpilot/ftp.env}"
[ -f "$CONF" ] || { echo "Brak $CONF (FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_DIR, VITE_API_URL)"; exit 1; }
set -a; . "$CONF"; set +a
cd "$(dirname "$0")/.."
VITE_API_URL="$VITE_API_URL" npx vite build --outDir dist-ftp --emptyOutDir
# FTPS (TLS), tryb pasywny; mirror -R usuwa na serwerze stare pliki z hashem, których nie ma w buildzie.
lftp -u "$FTP_USER","$FTP_PASSWORD" "$FTP_HOST" -e "
  set ftp:ssl-force true; set ftp:ssl-protect-data true; set ftp:passive-mode true; set net:max-retries 2;
  mkdir -pf $FTP_DIR;
  mirror -R --delete --verbose=1 dist-ftp $FTP_DIR;
  bye"
echo "Wysłano do $FTP_HOST:$FTP_DIR"
