# CLAUDE.md — instrukcje dla Claude w projekcie RoadPilot

RoadPilot to PWA dla kierowcy ciężarówki (React 19 + TypeScript + Vite 7) z opcjonalnym kontem (API Node + MariaDB, `server/`). Porównuje scenariusze
„jedź teraz / odpocznij 9 h / odpocznij 11 h”, liczy przerwy i odpoczynki wg rozporządzenia (WE) 561/2006,
planuje pod godzinę rozładunku i aktualizuje trasę z GPS. Pełny opis produktu: [README.md](README.md),
zakres MVP: [PROJECT_SCOPE.md](PROJECT_SCOPE.md).

## Język i styl

- Cały interfejs, komentarze, komunikaty silnika i dokumentacja są **po polsku**. Nazwy w kodzie (zmienne, typy) po angielsku.
- Styl jak w istniejącym kodzie: krótkie komentarze `//` i `/** */` po polsku tłumaczące *dlaczego*, zwięzłe funkcje,
  brak zbędnych abstrakcji. Cudzysłowy typograficzne „…” w tekstach UI.
- Nie ma ESLinta ani Prettiera — trzymaj się formatowania z sąsiednich plików (2 spacje, podwójne cudzysłowy, średniki,
  długie linie JSX są akceptowane).

## Komendy

```bash
npm install
npm run dev                 # serwer deweloperski (base /roadpilot/ → http://localhost:5173/roadpilot/)
npx tsc -b                  # sprawdzenie typów
npm run build               # tsc -b + vite build do dist/
```

**Testy:** skrypt `npm test` to `TZ=UTC vitest run` — składnia uniksowa, na Windows (cmd/PowerShell) nie działa.
Testy zakładają strefę UTC (w strefie lokalnej, np. Europe/Warsaw, pada test tygodnia 56 h). Na Windows uruchamiaj:

```bash
# Git Bash (narzędzie Bash)
TZ=UTC npx vitest run
# PowerShell
$env:TZ="UTC"; npx vitest run
```

`npm run deploy` (rsync do `/var/www/roadpilot`) działa tylko na serwerze Linux z Nginx; `npm run deploy:tuike` wysyła
front przez FTP na tuike.pl — **nie uruchamiaj ich lokalnie i nie wdrażaj bez wyraźnej prośby.** Żadnych haseł w repo (jest publiczne).

Po każdej zmianie w `src/core/` uruchom testy i `npx tsc -b`. Po zmianie w UI — co najmniej `npx tsc -b`.

## Architektura

```
src/core/          RoadPilot Core — czyste, deterministyczne funkcje TS (bez Reacta, Date.now(), losowości)
  rules.ts         JEDYNE miejsce z limitami z przepisów (minuty; TRUCK_SPEED — km/h ciężarówki > 3,5 t: 50 / 70 / 80)
  section.ts       odcinkowy pomiar: stepSection (wjazd interpolowany między odczytami, przejechane km z przyrostów — odporne na nową trasę),
                   sectionStats (średnia, ton, adviseKmh — ile do końca, by średnia zeszła do limitu), sectionLimit (znak odcinka vs limit ciężarówki)
  route.ts         Segment/Route: odcinki o różnych prędkościach, profile tras, remainingSegments
  plan.ts          simulate(): pętla jazda → przerwa → odpoczynek dzienny/tygodniowy; parkingHint, positionAt
  scenarios.ts     compareScenarios (now/rest9/rest11 + bestId), whatIfs, betterOption (kafelek „Lepszy scenariusz”), explain, driverStatus, fmtDuration
  deadline.ts      planForDeadline: najdłuższy odpoczynek / najpóźniejszy wyjazd pod awizację (wyszukiwanie binarne)
  reconstruct.ts   spóźniony start — liczniki z listy aktywności; reconstructTimed: godziny od–do, luki = postój
  gps.ts           licznik km z odczytów, luki, średnia z 10 min, creditDriving/creditStop; nextLive (prędkość/kierunek do HUD);
                   nextAutoStop — postój sam po 5 s z prędkością 0–5 km/h (uzbraja się po jeździe)
                   ruszenie z postoju potwierdzane dopiero po GPS.confirmMoveM (200 m) od miejsca postoju (moveSince) —
                   pojedynczy fałszywy odczyt ruchu nie kończy przerwy
  workday.ts       czas pracy (od shiftStart, bez zatrzymania w przerwach): WorkSettings, workStatus, workReminders; 13 h / 15 h z dutyWindow
  history.ts       historia dzienna (DayLog, dzień kalendarzowy lokalnie): recordDrive/recordStop/daySummary
  stations.ts      parseOverpass, parseParkings/parkingsQuery (MOP, parking TIR), nearestStation<T> (najbliższe przed nami, ±70°)
  roads.ts         roadsQuery/parseRoads (drogi z geometrią + miejscowości z Overpass), matchRoad (odległość + kierunek), nearestPlace, roadLabel
  service.ts       serviceStatus: dni i km do serwisu (km z licznika GPS AppState.odoKm)
  weather.ts       kod WMO → opis/ikona, isHazard
  apps.ts          skróty HUD: musicLink/navLink — schemat aplikacji (iOS), intent z browser_fallback_url (Android), strona (komputer)
  stop.ts          ręczny postój (AppState.stop; targetMin null = bez limitu, do ruszenia): stopCredit, nextStopThreshold, endStop, stopEnd, planAfterStop
  *.test.ts        testy Vitest (core, gps, hud, stop; src/tracking.test.ts — postój + GPS)
src/state.ts       AppState (version: 1) w localStorage pod kluczem "roadpilot:v1", useNow (tick 15 s)
src/tracking.ts    Geolocation.watchPosition + Wake Lock → applyFix na stanie (też historia); zwraca { status, live }; useAutoStop;
                   endDay/startDay — koniec dnia = postój { dayEnd: true, 11 h }, nowy dzień zeruje liczniki;
                   startStop/finishStop — ręczny postój (ruszenie z GPS kończy go; GPS nie zalicza tego postoju drugi raz)
src/ongoing.ts     stałe powiadomienie: cicha pętla audio (WAV generowany w pamięci) + Media Session, ongoingInfo = tekst karty
src/core/navmatch.ts  prowadzenie: pointAtKm, bearingAtKm, routeSlice, locate (rzut GPS na trasę, okno wokół podpowiedzi), nextInstruction, lanesAhead, speedLimitAt, isOffRoute; NAV = progi;
                   alongRoute / nearestOnRoute — km po trasie do punktu przy niej (MOP, znajomy; ON_ROUTE_M = 300);
                   speedLimitAt trzyma ostatni limit do NAV.limitCarryKm za końcem odcinka (luki w danych TomTom); speedTone ok/warn/over (NAV.overWarnKmh = 5)
                   legalLimitAt = min(znak, TRUCK_SPEED[rodzaj drogi z NavRoute.roads]) — wyższy znak ciężarówki nie dotyczy (ignoredSign)
                   bez trasy / poza nią: pushTrail (ślad GPS, HERE) → nav.ts useLimitHere → POST /api/nav/here (trace_attributes map_snap, limitHere)
                   „Po drodze” (NavView AheadSheet, przycisk P): MOP-y / parkingi TIR / stacje do AHEAD_KM 30 km — z trasą route.pois (km po trasie, poiVisible),
                   bez trasy GET /api/nav/nearby (osm_pois w promieniu NEARBY_KM) → nav.ts useNearbyPois → core/stations placesAhead (kierunek ±aheadDeg, linia prosta)
src/components/SectionControl.tsx  useSectionRun (stan odcinka z odczytów GPS), sectionView (zapowiedź / w trakcie / podsumowanie), SectionPanel w karcie HudNav (prop section)
src/components/MapView.tsx  useMapGestures (1 palec = przesuwanie, 2 = szczypanie, kółko; tłumi klik po przeciągnięciu) + moveView (punkt pod palcem
                   zostaje pod palcem, z obrotem i przybliżeniem pochylenia; testy src/mapGestures.test.ts) — MapView z onMove, RouteCompare, HudRouteMap
                   (NavView.browse: przeglądanie z góry, pitch 0, powrót przyciskiem / po 20 s jazdy)
src/components/MapView.tsx  mapa DOM bez bibliotek (podgląd admina; porównanie tras i „Gdzie jest” znajomego tylko poza zasięgiem własnych kafelków — w Polsce GlMapView z App.mapStyle): kafelki TomTom 512 px (noc) przez /api/tiles
                   z tokenem (fetch → blob, wspólny cache loadTile/cachedTile), Web Mercator, nakładki SVG; AdminMap.tsx = podgląd danych
src/components/GlMap.tsx  mapa HUD w WebGL (GlMapView): kafelki rastrowe TomTom jako tekstury ALBO własne kafelki wektorowe (prop vector: theme + vehicle;
                   /api/vtiles → core/mvt.ts decodeMvt → glVector.ts buildVectorTile: bufor [x,y,nx,ny,d], partie wg klucza stylu; wypełnienia przez
                   bufor szablonu, drogi rozciągane w shaderze (u_hw), zakazy kreskowane (u_dash); etykiety z kafelków jako znaczniki SVG (miejscowości, numery dróg,
                   nazwy ulic wzdłuż drogi od STREETS_FROM_ZOOM 15; box → chowanie nachodzących w pętli klatek), LABELS_MAX 34);
                   src/mapStyle.ts = palety dzień/noc, roadWidth, roadBan (tagi OSM vs pojazd), autoTheme; kamera = ta sama
                   macierz co dawniej w CSS (translate·perspective·rotateX·rotateZ), follow() = pozycja co klatkę (rAF); znaczniki = kilka
                   elementów SVG w układzie ekranu przestawianych atrybutem transform. Zastąpiła pochylanie warstwy HTML (CSS 3D), której
                   Chrome na Androidzie nie nadążał rasteryzować (migotanie, niedomalowane karty), a Safari na iOS wyczerpywało pamięć
src/components/HudNav.tsx  useNavTrack (pozycja na trasie, poza trasą → onReroute po 15 s; brak trasy w urządzeniu, a jest cel → od razu; max 1/min),
                   HudNav (manewr + pasy + ograniczenie), HudRouteMap (ekran Nawigacji: GlMapView pochylona MAP_PITCH 62° z horyzontem (gradient .nm-map::after/::before),
                   kierunek jazdy w górę, trasa, zielona strzałka = my na 70% wysokości; zoom od prędkości)
                   useSmoothPosition — jak w nawigacjach: między odczytami GPS przewidujemy ruch z ostatniej prędkości (po trasie / wzdłuż kierunku),
                   nowy odczyt koryguje płynnie przez 1 s (SMOOTH). Zwraca funkcję predict() → MapView.follow woła ją w każdej klatce (rAF) i zapisuje
                   transform warstwy wprost w DOM — bez setState (render 20×/s przerysowywał kafelki: migotanie na Androidzie, crash Safari)
src/collect.ts     mapa RoadPilot (za zgodą users.data_consent_at): useTraceCollector (ślad co 5 s / 60 m, >8 km/h, tylko PL, bufor w localStorage
                   "roadpilot:trace", wysyłka co 5 min / 400 pkt), sendReport, setConsent, deleteMyMapData; MapConsent.tsx, ReportSheet.tsx
src/voice.ts       komunikaty głosowe (Web Speech, pl-PL): useNavVoice — manewry (progi zależne od prędkości) i ostrzeżenia ≤ 1 km; spokenDist
src/nav.ts         nawigacja (beta): Vehicle, NavPlace, NavRoute, RouteType (fastest/shortest/eco → Settings.routeType, POST /api/nav/route);
                   searchPlaces / fetchRoute przez API → TomTom; AppState.navRoute tylko lokalnie (nie w sync)
src/components/NavCard.tsx  Trasa: wyszukiwanie celu, „Wyznacz trasę dla ciężarówki”; trasa → trip.segments (profil custom) → silnik przerw
src/vtiles.ts      useVtiles (GET /api/vtiles/meta raz na sesję, wspólne dla Nawigacji i „Gdzie jest” — w Polsce GlMapView z własnym stylem) + inVtiles
src/hudConfig.ts   HudStyle (full/minimal; dawny „nav” migrowany do „full” w normalize), HUD_ITEMS, DEFAULT_HUD_ITEMS — Settings.hudItems[styl]; element „road” steruje też pobieraniem dróg
src/floating.ts    pływające okienko: canvas → captureStream → <video> → PiP (requestPictureInPicture / webkitSetPresentationMode); useFloating(info, prepare)
src/install.ts     useInstall: beforeinstallprompt łapane przy wczytaniu modułu, isStandalone; InstallButton.tsx = przycisk + instrukcja iOS
src/launch.ts      platform() z userAgent, launch(): otwiera link z apps.ts (iOS: po 1,5 s bez przejścia → strona)
src/nearby.ts      HUD: useStations, useParkings, useRoads (Overpass, z serwerem zapasowym) i useWeather (Open-Meteo)
src/App.tsx        jedyne miejsce łączące stan z silnikiem (useMemo); activePlan = wybór kierowcy (AppState.choice) → plan pod rozładunek → zalecany; zakładki na pasku: Plan/Trasa/Nawigacja (zielona bańka na środku)/Historia/Ustawienia — Tachograf (tab "driver") jest w Trasie (przełącznik .subtabs);
                   gdy state.hud — renderuje tylko HudView; gdy state.navOpen — tylko NavView (zakładka „Nawigacja” = osobny ekran na cały ekran)
src/components/NavView.tsx  nawigacja jako osobny system (nie HUD): HudRouteMap + HudNav (karta manewru), głos, ostrzeżenia, wyszukiwanie celu, zgłoszenia, postój;
                   HUD dostaje trasę tylko jako dane (navRoute: km po trasie do MOP-u/znajomych, limit do koloru prędkości)
src/components/    widoki; HudView.tsx = tryb HUD; fields.tsx = NumberField, OptionalNumberField, DurationField, Toggle, Stepper
src/api.ts         zapytania do API, token sesji (localStorage "roadpilot:auth"), tryb bez konta ("roadpilot:guest")
src/sync.ts        useSync: stan ↔ konto (wysyłka co ≤ 30 s i przy schowaniu z baseRev — 409 = pobierz; pobranie przy starcie/powrocie i co 30 s);
                   nie wysyła track/hud/planTime; meta w "roadpilot:sync" { rev, dirty }
src/components/AuthScreen.tsx  logowanie / rejestracja / „Kontynuuj bez konta”
src/core/friends.ts  znajomi: presenceOf (co wysyłamy: pozycja, prędkość, status driving/standing/break/rest/dayEnd, since, cel, przyjazd, tachograf),
                   describeFriend (km w linii prostej, status, „25 min z 45 min”), nearestFriend; testy friends.test.ts
src/friends.ts     useFriends: GET /api/friends co 30 s (gdy widoczna), POST /api/presence co 20 s tylko z kontem + GPS + friendsShare
                   + ≥1 zaakceptowany znajomy; wyłączenie → POST {off:true} kasuje obecność. Friends.tsx = karta na Planie, Ustawienia → Znajomi
                   (status + „Gdzie jest”: MapView z pozycją przy Premium, inaczej link do map), kafelek HUD
public/sw.js       service worker (cache "roadpilot-vN"): nawigacja network-first, assets cache-first, /api/ zawsze z sieci
server/friends.mjs   znajomi: cleanPresence (walidacja obecności, pozycja do 1e-4°), friendView (relation accepted/invited/pending, obecność ≤
                   PRESENCE_TTL 10 min = na żywo; starsza do 7 dni z offline: true = ostatnia pozycja, szara strzałka na mapie); tabele friends (user_id zaprasza friend_id, accepted_at) i presence (JSON, 1 wiersz na konto);
                   /api/friends (GET), /api/friends/invite|accept (POST), DELETE /api/friends, POST /api/presence — wszystkie z kontem
server/            RoadPilot API: index.mjs (node:http + mysql2), schema.sql; nav.mjs = TomTom (routeUrl, parseRoute, parseSearch) + nav.test.mjs;
                   /api/nav/* tylko Premium (users.premium_until / role=admin) + limit na IP + dzienny limit na konto + budżet TomTom
                   (api_usage, okres TOMTOM_PERIOD=month|day, próg 80% limitów TOMTOM_LIMIT_SEARCH/ROUTING); collect.mjs + /api/consent,
                   /api/collect/points|report, DELETE /api/collect (gps_points, road_reports — tylko Polska); /api/admin/stats; /api/admin/users i /api/admin/premium tylko admin; klucz TOMTOM_KEY w /etc/roadpilot-api.env; usługa roadpilot-api.service (127.0.0.1:7781),
                   Nginx /roadpilot/api/ → /api/, konfiguracja /etc/roadpilot-api.env (MariaDB przez gniazdo unixowe,
                   SMTP simply.com do resetu hasła, APP_ORIGINS = CORS + linki w e-mailach); zależności: mysql2, nodemailer
server/warnings.mjs  ostrzeżenia na trasie z osm_restrictions + road_reports (routeBoxes → zapytania po prostokątach, routeWarnings:
                   punkt ≤ 20 m, odcinek musi biec wzdłuż trasy — most nad drogą nie ostrzega); POST /api/nav/warnings (bez kosztów TomTom)
server/compare.mjs   zgłoszenia kierowców vs OSM (missing / diff / match / info, potwierdzenia); GET /api/admin/compare
server/valhalla.mjs  własny silnik tras (Valhalla, OSM Polska, VALHALLA_URL): valhallaRequest (truck), parseValhalla → format jak parseRoute;
                   /api/nav/route: engine "roadpilot" w PL albo zapas, gdy TomTom niedostępny / limit 80%; valhallaRoute sprawdza trasę
                   findWarnings i przy twardym konflikcie (oś, masa, wysokość, szer., dł., zakaz) liczy od nowa z exclude_locations
                   w punkcie przejazdu (blockingPoints, max MAX_DETOURS); routeWarnings: odcinek ≥2 pkt i 60% przy trasie, kierunek ±30°
                   withRoadInfo (index.mjs): trace_attributes po kawałkach ≤ TRACE_CHUNK_KM → roadInfo: speedLimits ze znaków OSM i roads
                   (motorway z klasy drogi, urban/rural z ZONES_FILE = /opt/roadpilot-osm/zones.tsv „id\tu|r” z tagów PL:urban/PL:rural,
                   bez tagów: gęstość ≥ URBAN_DENSITY albo luka ≤ URBAN_GAP_KM między zabudowanymi = urban); błąd → trasa bez nich
server/enforcement.mjs  OSM (OPL) → fotoradary / odcinkowe pomiary / kamery na czerwonym (relacje enforcement: from→device = kierunek,
                   from→to = odcinek); enforcement-import.mjs → tabela osm_enforcement. warnings.mjs routeAlerts: dopasowanie do trasy
                   z kierunkiem (from / kurs zgłaszającego); zgłoszenia police/itd żyją 3 h (ALERT_TTL_H); HUD dociąga je co 5 min
server/nav.mjs → parseRoutes: trasa + alternatywy (maxAlternatives=2, 1 zapytanie TomTom) i korki (sectionType=traffic → route.traffic);
                   POST /api/nav/route {alternatives:true} → {route, alternatives}; Valhalla: alternates=2 (valhallaAlternates)
punkty pośrednie  NavRoute.via (NavPlace[]); fetchRoute(..., via) → /api/nav/route {via} (MAX_VIA 5; routeUrl/valhallaRequest `via`, Valhalla type "through");
                   viaAhead (nieprzejechane, do reroute w App) / insertVia (kolejność po km trasy); App.setVia → HudNavData.onVia;
                   useMapGestures onTap/onLongPress (LONG_PRESS_MS 600); GlMapView pickRef (unproject: odwrotność kamery dla z=0);
                   HudRouteMap onPin (trafienie w [data-pin], PinInfo) / onHold; NavView PinCard w stopce
server/pois.mjs    pinezki przy trasie: poiRow (osmium geojsonseq → fuel/services/mop/parking, środek wielokąta), routePois (km, strona drogi
                   right/left z iloczynu wektorowego, FUEL_NEAR_M 150 / POI_NEAR_M 250, jedno miejsce na 300 m); poi-import.mjs → osm_pois
                   (krok w osm-update.sh); findPois w index.mjs dokłada `pois` do /api/nav/warnings (refreshWarnings wysyła pois:false);
                   NavRoute.pois; HudNav routePins (Pin + ikony SVG, PINS_AHEAD_KM 20, przy przeglądaniu pinGapKm, PINS_MAX)
server/parking.mjs  parking przy celu: cleanParking, boxAround/distanceM, parkingView (promień PARKING_RADIUS_M 300 m, sortowanie po 👍−👎, podsumowanie
                   bez opinii z przewagą 👎); tabele parking_opinions (1 opinia na konto przy celu) i parking_votes; GET/POST/DELETE /api/parking,
                   POST /api/parking/vote — z kontem, bez Premium; ParkingCard.tsx w NavCard (przy wybranym celu)
src/components/PrintoutTips.tsx  Pro tip na Planie: formułki na odwrót wydruku z tachografu (art. 12 561/2006, art. 35/37 165/2014), kopiowanie do schowka
alert_votes        głosy „jest / nie ma” po minięciu fotoradaru/kontroli (POST /api/alerts/vote, applyVotes w warnings.mjs)
server/osm.mjs     OSM → ograniczenia (height/weight/axle/width/length/hgv/speed_hgv), parseValue; osm-import.mjs → tabela osm_restrictions
/opt/roadpilot-valhalla  dane i build.sh Valhalla (docker ghcr.io/valhalla/valhalla); kontener roadpilot-valhalla na 127.0.0.1:8002;
                   budowa potrzebuje kilku GB RAM — na czas budowy zatrzymywany kontener Metin2 m2pb-06b67463-game (zgoda użytkownika)
scripts/tiles-build.sh  własne kafelki wektorowe: tilemaker (server/tiles/config.json + process.lua: warstwy water, landuse, waterway, railway, road
                   z tagami ograniczeń, building, place; z 6–14, gzip) → katalog VTILES_DIR (z/x/y.pbf) serwowany przez GET /api/vtiles/z/x/y
                   (204 = pusty kafelek) i GET /api/vtiles/meta {available, bounds}; aplikacja używa własnych kafelków tylko w ich zasięgu
scripts/osm-update.sh  pobranie Polski (lustro openstreetmap.fr — Geofabrik blokuje VPS) → osmium tags-filter → export → import; dane w /opt/roadpilot-osm
scripts/deploy-ftp.sh  `npm run deploy:tuike`: build z VITE_API_URL → FTPS do tuike.pl/roadpilot/ (dane w ~/.config/roadpilot/ftp.env)
```

Przepływ danych: `AppState` → `App.tsx` buduje `Route` (profil lub własne odcinki, minus `trip.doneKm`,
opcjonalnie jednolita prędkość z GPS) → `compareScenarios` / `whatIfs` / `planForDeadline` / `driverStatus` → widoki.
Widoki nie liczą reguł same — tylko formatują wyniki silnika.

## Zasady, których pilnuj

1. **Determinizm silnika.** `src/core/` nie może importować Reacta, API przeglądarki ani wołać `Date.now()`/`Math.random()`.
   Czas zawsze przychodzi parametrem (`now`, `planNow`). Wyjątek: `new Date(t)` do kalendarza (`nextWeekStart`) —
   używa strefy lokalnej, stąd zależność testów od TZ.
2. **Limity tylko w `rules.ts`.** Nie wpisuj 270/540/660 itd. na sztywno w innych plikach — importuj `RULES`.
   (Parametry GPS są w `GPS` w `gps.ts`.)
3. **Jednostki:** czasy w silniku w minutach (float), znaczniki czasu w ms epoki, dystans w km. Stała `MIN = 60_000`.
4. **Silnik nie wybiera za kierowcę opcji prawnych.** Wydłużenie 10 h i skrócony odpoczynek po drodze są używane
   tylko przy `allowExtension` / `allowReducedRest`; w przeciwnym razie pokazujemy zysk w „Co jeśli?”.
5. **Każda zmiana reguł = test.** Dodaj/zmień przypadek w `core.test.ts` z jawnie wyliczonymi minutami
   (styl: `kinds(p)` → `["drive:270", "break:45", ...]`, `flat(km)` = 60 km/h).
6. **Zmiana kształtu `AppState`:** `load()` scala zapisany stan z `defaultState()`, więc nowe pola muszą mieć
   domyślne wartości. Przy zmianie niekompatybilnej podbij `version` i dopisz migrację (nie kasuj danych kierowcy).
7. **Service worker:** po zmianie listy `SHELL` lub strategii cache podbij `CACHE` w `public/sw.js`.
   Ścieżki w SW i manifeście są względne — aplikacja działa z podkatalogu `/roadpilot/` (`vite.config.ts: base`).
   W kodzie używaj `import.meta.env.BASE_URL`, nie `/`.
8. **Zastrzeżenie prawne** („asystent planowania, nie zastępuje tachografu”) musi zostać w UI i README.
9. **Konto opcjonalne, offline najpierw (v0.6, decyzja użytkownika).** Aplikacja musi działać bez konta i bez sieci;
   własne API (`server/`) służy tylko do kont i synchronizacji stanu. Zewnętrzne API: Overpass (MOP-y, drogi; stacji paliw HUD już nie pobiera) i Open-Meteo
   (pogoda) — darmowe, bez klucza, wołane **tylko w trybie HUD przy włączonym GPS**, z pozycją zaokrągloną do 0,01°.
   TomTom (nawigacja dla ciężarówek, zgoda użytkownika 2026-09-30) — tylko przez nasze API (klucz nie trafia do frontu ani repo),
   tylko przy włączonej nawigacji (Ustawienia → Pojazd i nawigacja).
   Nowych serwisów nie dodawaj bez zgody; każdy musi mieć obsługę braku sieci. Opis prywatności jest w Ustawieniach
   (sekcja „Dane”) — aktualizuj go przy zmianach. Zależności: front tylko react/react-dom, serwer mysql2 + nodemailer.
   Po zmianach w `server/`: `sudo systemctl restart roadpilot-api` (to też wdrożenie — tylko na prośbę).
10. **HUD** ma być czytelny z odległości: duże cyfry, mało tekstu, działa poziomo i pionowo (`@media (orientation: portrait)`),
    także w odbiciu lustrzanym (`.hud.mirror`). Po zmianach sprawdź oba układy zrzutem ekranu. Rozmiary w HUD są w jednostce
    `--u` (część mniejszego wymiaru ekranu) — nie wpisuj px na sztywno. Odległości na osi i w kafelkach zawsze od bieżącej
    pozycji („za X km”), przyjazd zawsze z planu (z postojami).

## Znane ograniczenia i dług techniczny (stan na v0.5.0, 2026-09-30)

- Pełny ekran nie działa na iPhonie (Safari nie obsługuje Fullscreen API dla stron) — HUD pokazuje wtedy wskazówkę
  „Do ekranu początkowego”.
- HUD styl „Nawigacja”: mapa w WebGL (GlMap.tsx) — nie wracać do CSS 3D (pochylona warstwa HTML z <img> migotała na Androidzie i wysypywała
  Safari). Nad mapą bez `backdrop-filter` i SVG `filter` (drogie na telefonie). Daleki pas u góry zakrywa „niebo” i mgła z CSS (w pionie do ~30 %).
- HUD: odległość do MOP-u i znajomych po trasie tylko z trasą z nawigacji (Premium) i tylko dla punktów ≤ 300 m od niej
  (`navmatch.alongRoute`); bez trasy — w linii prostej. Km do serwisu liczy tylko GPS przy otwartej aplikacji.

- Liczniki tygodniowe w `DriverState` (`weekDrivenMin`, `prevWeekDrivenMin`, `extensionsLeft`) **nie przewijają się
  same po poniedziałku 00:00** — robi to tylko symulacja. Po zmianie tygodnia kierowca musi je poprawić ręcznie,
  a GPS (`creditDriving`) dolicza jazdę do starego tygodnia.
- `creditDriving` obcina `sinceBreakMin` do 270 — przekroczenie ciągłej jazdy nie jest widoczne w stanie.
- `DurationField` pozwala wpisać np. 10 h 59 min jazdy dziennej (limit godzin, a minuty do 59).
- `planForDeadline` zakłada monotoniczność (`maxWhere`) — przy granicy tygodnia może nie znaleźć optimum.
- Stałe powiadomienie to obejście PWA (audio + Media Session): na Androidzie może przejąć fokus audio i zatrzymać
  muzykę z innej aplikacji; znika po zamknięciu aplikacji z listy ostatnich. Prawdziwa usługa w tle wymaga opakowania
  natywnego (np. Capacitor). GPS w tle nie jest gwarantowany — luki nadrabia `addFix` po powrocie.
- Synchronizacja: zapis z `baseRev` (409 → aplikacja bierze stan z konta, jej niewysłane zmiany przepadają), pobieranie co 30 s
  przy widocznej aplikacji. Jazdę z GPS dolicza tylko jedno urządzenie (`AppState.tracker`, `tracking.ts` otherTracker,
  przejęcie po `TRACKER_TTL_MS` 3 min bez odczytów) — drugie prowadzi tylko własny `track`. Przy przejęciu ≤ 3 min jazdy może przepaść.
  Brak weryfikacji adresu e-mail przy rejestracji.
- simply.com (tuike.pl) odpowiada 455 na zapytania HTTP z VPS (WAF) — wersji na tuike.pl nie da się sprawdzić z serwera.
- Overpass odpowiada 406 na zapytania z tego serwera (VPS) — testy HUD z nazwą drogi/stacjami podstawiają odpowiedź
  (Playwright `route`); telefony pytają Overpass bezpośrednio.
- Przypomnienia (`Reminders.tsx`) liczą od `Date.now()`, także gdy ustawiono inną godzinę planowania.
- Poza zakresem silnika: odpoczynek tygodniowy po 6 okresach 24 h, dyrektywa 2002/15 (czas pracy, noc),
  promy/pociągi, jazda w załodze, lokalne zakazy ruchu.
- `package.json`: skrypty `test` i `deploy` są uniksowe (patrz „Komendy”).

## Git i GitHub

- Repozytorium: https://github.com/eustahcy/RoadPilot (publiczne, gałąź `main`).
- `dist/`, `node_modules/`, `*.tsbuildinfo` są w `.gitignore` — nie commituj buildów.
- Commituj i pushuj tylko na prośbę użytkownika; komunikaty commitów po polsku, krótkie, w trybie „co zmienia”.
- Po zmianie funkcji zaktualizuj tabelę „Co jest zrobione” i opis silnika w README.
