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
  gps.ts           licznik km z odczytów, średnia z 10 min, creditDriving/creditStop; nextLive (prędkość/kierunek do HUD);
                   luki (addGap): droga z serwera (GapRoad, odrzucana, gdy min > luka × gapRoadSlack) albo linia prosta × 1,2 przy 70 km/h;
                   reszta = postój: stoimy przed luką / jedziemy teraz → postój na początku (stopEnded), jechaliśmy i stoimy → stopSince = koniec jazdy;
                   GapEstimate do historii, driveEnd = koniec jazdy w kroku
                   nextAutoStop — postój sam po 5 s z prędkością 0–5 km/h (uzbraja się po jeździe)
                   ruszenie z postoju potwierdzane dopiero po GPS.confirmMoveM (200 m) drogi zebranej z odczytów ≥ GPS.resumeKmh 10 km/h
                   (track.moveKm od moveSince; prędkość z odbiornika albo z przesunięcia od track.lastFix; krok > maxKmh = skok, pomijany);
                   stanie krótsze niż GPS.resumeHoldMin 3 min (światła) nie zeruje zebranej drogi — wcześniej każde zwolnienie zaczynało
                   200 m od nowa i w mieście przerwa się nie kończyła; pojedynczy fałszywy odczyt ani spacer z telefonem (5–6 km/h) nie kończą przerwy; luka na postoju z przesunięciem < GPS.gapMinKm (1 km) to nie jazda
  workday.ts       czas pracy (od shiftStart, bez zatrzymania w przerwach): WorkSettings, workStatus, workReminders; 13 h / 15 h z dutyWindow
  history.ts       historia dzienna (DayLog, dzień kalendarzowy lokalnie): recordDrive/recordStop(est)/recordGap/daySummary; DayLog.gaps, .violations
  violations.ts    przekroczenia z GPS: trackViolations (continuous / daily / week / fortnight z liczników przed jazdą, duty = jazda po 13/15 h
                   od shiftStart; open → overMin rośnie do resetu licznika), restViolation (za krótki odpoczynek — „Rozpocznij dzień” < 9 h albo
                   9–11 h bez skróconych), whereText, violationReport (summary, printout jak wydruk, note jak PrintoutTips: art. 12 + przyczyna + miejsce)
  stations.ts      parseOverpass, parseParkings/parkingsQuery (MOP, parking TIR), nearestStation<T> (najbliższe przed nami, ±70°)
  roads.ts         roadsQuery/parseRoads (drogi z geometrią + miejscowości z Overpass), matchRoad (odległość + kierunek), nearestPlace, roadLabel
  service.ts       serviceStatus: dni i km do serwisu (km z licznika GPS AppState.odoKm)
  weather.ts       kod WMO → opis/ikona, isHazard
  apps.ts          skróty HUD: musicLink/navLink — schemat aplikacji (iOS), intent z browser_fallback_url (Android), strona (komputer)
  stop.ts          ręczny postój (AppState.stop; targetMin null = bez limitu, do ruszenia): stopCredit, nextStopThreshold, endStop, stopEnd, planAfterStop
  *.test.ts        testy Vitest (core, gps, hud, stop; src/tracking.test.ts — postój + GPS)
src/state.ts       AppState (version: 1) w localStorage pod kluczem "roadpilot:v1", useNow (tick 15 s)
src/tracking.ts    Geolocation.watchPosition + Wake Lock → applyFix na stanie (też historia i przekroczenia); zwraca { status, live }; useAutoStop;
                   luka ≥ GPS.gapLookupKm z kontem: odczyt czeka w AppState.pendingGap (nie w sync), useGapRoad → POST /api/gps/gap → applyFix z road
                   (bez odpowiedzi po GAP_WAIT_MS 15 s — linia prosta);
                   endDay/startDay — koniec dnia = postój { dayEnd: true, 11 h }, nowy dzień zeruje liczniki;
                   startStop/finishStop — ręczny postój (ruszenie z GPS kończy go; GPS nie zalicza tego postoju drugi raz)
src/ongoing.ts     stałe powiadomienie: cicha pętla audio (WAV generowany w pamięci) + Media Session, ongoingInfo = tekst karty
src/core/navmatch.ts  prowadzenie: pointAtKm, bearingAtKm, routeSlice, locate (rzut GPS na trasę, okno wokół podpowiedzi), nextInstruction, lanesAhead, speedLimitAt, isOffRoute; NAV = progi;
                   alongRoute / nearestOnRoute — km po trasie do punktu przy niej (MOP, znajomy; ON_ROUTE_M = 300);
                   speedLimitAt trzyma ostatni limit do NAV.limitCarryKm za końcem odcinka (luki w danych TomTom); speedTone ok/warn/over (NAV.overWarnKmh = 5)
                   legalLimitAt = min(znak, TRUCK_SPEED[rodzaj drogi z NavRoute.roads]) — wyższy znak ciężarówki nie dotyczy (ignoredSign)
                   bez trasy / poza nią: pushTrail (ślad GPS, HERE) → nav.ts useLimitHere → POST /api/nav/here (trace_attributes map_snap, limitHere)
                   „Po drodze” (NavView AheadSheet, przycisk P): MOP-y / parkingi TIR / stacje do settings.aheadKm (20/30/50/80, domyślnie 50) — z trasą route.pois (km po trasie, poiVisible),
                   bez trasy GET /api/nav/nearby (osm_pois w promieniu NEARBY_KM) → nav.ts useNearbyPois → core/stations placesAhead (kierunek ±aheadDeg, linia prosta);
                   pasek pod prędkością (.nm-ahead-strip, settings.aheadStrip): najbliższy MOP / parking / stacja, każdy do wyłączenia, kolejność wg odległości;
                   stacja z marką (NavView stationLabel: Orlen, Shell, BP… z OSM brand/name; ogólne nazwy, MOP-y i zgłoszenia → „Stacja”)
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
src/components/HudNav.tsx  useNavTrack (pozycja na trasie; zjazd z trasy → core/navmatch nextOffRoute: nowa trasa po NAV.rerouteAfterMs 8 s, dalej niż
                   offRouteFarM 200 m od razu, powrót liczy się po backOnRouteMs 5 s — odczyty przy progu nie zerują odliczania; brak trasy w urządzeniu,
                   a jest cel → od razu; kolejna próba po rerouteEveryMs 20 s; zegar urządzenia, nie czas odczytu GPS),
                   HudNav (manewr + pasy + ograniczenie), HudRouteMap (ekran Nawigacji: GlMapView pochylona MAP_PITCH 62° z horyzontem (gradient .nm-map::after/::before),
                   kierunek jazdy w górę, trasa, zielona strzałka = my na 70% wysokości; zoom od prędkości)
                   useSmoothPosition — jak w nawigacjach: między odczytami GPS przewidujemy ruch z ostatniej prędkości (po trasie / wzdłuż kierunku),
                   nowy odczyt koryguje płynnie przez 1 s (SMOOTH). Zwraca funkcję predict() → MapView.follow woła ją w każdej klatce (rAF) i zapisuje
                   transform warstwy wprost w DOM — bez setState (render 20×/s przerysowywał kafelki: migotanie na Androidzie, crash Safari)
src/collect.ts     zgłoszenia REPORT_KINDS: quick (fotoradar, odcinek, policja, ITD — jedno dotknięcie), place (parking / mop / fuel — „Brakuje na mapie”,
                   jedno dotknięcie; serwer REPORTED_POIS dokłada je do pinezek trasy i /api/nav/nearby jako „Zgłoszenie kierowcy”, id „r…”);
                   przycisk „Zgłoś” w Nawigacji pod „P”;
                   mapa RoadPilot (za zgodą users.data_consent_at): useTraceCollector (ślad co 5 s / 60 m, >8 km/h, tylko PL, bufor w localStorage
                   "roadpilot:trace", wysyłka co 5 min / 400 pkt), sendReport, setConsent, deleteMyMapData; MapConsent.tsx, ReportSheet.tsx
src/voice.ts       komunikaty głosowe (Web Speech, pl-PL): useNavVoice — manewry (progi zależne od prędkości) i ostrzeżenia ≤ 1 km; spokenDist
src/nav.ts         nawigacja (beta): Vehicle, NavPlace, NavRoute, RouteType (fastest/shortest/eco → Settings.routeType, POST /api/nav/route);
                   searchPlaces / fetchRoute przez API → TomTom; AppState.navRoute tylko lokalnie (nie w sync)
src/core/places.ts  dom, ulubione, ostatnie cele (UI: zakładki Dom / Ulubione / Historia — SavedPlaces PlaceShortcuts; uwaga: `.nav-results button` ma width 100% — przyciski w listach miejsc mają własne klasy .place-go/.place-x) (Settings.places — synchronizowane z grupą settings): addRecent (App.chooseRoute przy każdym wyborze trasy,
                   ten sam cel ≤ PLACES.sameM 100 m przenoszony na górę, max recentMax 12), toggleFavorite, setHome, normalizePlaces (normalize w state.ts);
                   UI: components/SavedPlaces.tsx — PlaceShortcuts pod pustą wyszukiwarką (HudRoutePicker w Nawigacji i NavCard), PlaceActions przy wybranym celu
src/components/NavCard.tsx  Trasa: wyszukiwanie celu, „Wyznacz trasę dla ciężarówki”; trasa → trip.segments (profil custom) → silnik przerw
src/vtiles.ts      useVtiles (GET /api/vtiles/meta raz na sesję, wspólne dla Nawigacji i „Gdzie jest” — w Polsce GlMapView z własnym stylem) + inVtiles
src/hudConfig.ts   HudStyle (full/minimal; dawny „nav” migrowany do „full” w normalize), HUD_ITEMS, DEFAULT_HUD_ITEMS — Settings.hudItems[styl]; element „road” steruje też pobieraniem dróg
src/floating.ts    pływające okienko: canvas → captureStream → <video> → PiP (requestPictureInPicture / webkitSetPresentationMode); useFloating(info, prepare)
src/install.ts     useInstall: beforeinstallprompt łapane przy wczytaniu modułu, isStandalone; InstallButton.tsx = przycisk + instrukcja iOS
src/launch.ts      platform() z userAgent, launch(): otwiera link z apps.ts (iOS: po 1,5 s bez przejścia → strona)
src/nearby.ts      HUD: useStations, useParkings, useRoads (Overpass, z serwerem zapasowym) i useWeather (Open-Meteo)
src/App.tsx        jedyne miejsce łączące stan z silnikiem (useMemo); przyjazd z aktualnego tempa (settings.liveEta): core/route withLiveSpeed — średnia z GPS tylko na GPS.liveEtaMin 15 min jazdy
                   (min z prędkością drogi), dalej prędkości typów dróg — dawniej uniformSpeeds na całą trasę dawało skoki przyjazdu o godziny; activePlan = wybór kierowcy (AppState.choice) → plan pod rozładunek → zalecany; zakładki na pasku: Plan/Trasa/Nawigacja (zielona bańka na środku)/Historia/Ustawienia — Tachograf (tab "driver") jest w Trasie (przełącznik .subtabs);
                   gdy state.hud — renderuje tylko HudView; gdy state.navOpen — tylko NavView (zakładka „Nawigacja” = osobny ekran na cały ekran)
src/components/NavView.tsx  nawigacja jako osobny system (nie HUD): HudRouteMap + HudNav (karta manewru), głos, ostrzeżenia, wyszukiwanie celu, zgłoszenia, postój;
                   układ wg makiet (2026-10-01, tylko VPS): jedna siatka CSS (.hud.navmode grid-template-areas: top / tiles / side / ctl / speed / ahead),
                   trzy warianty bez przełącznika w ustawieniach — telefon pionowo (kafelki „do celu” + „przyjazd”, przerwa i trasa po dotknięciu uchwytu),
                   telefon poziomo (orientation: landscape, max-height 599px: karta w lewej kolumnie, prędkość + „po drodze” pod nią, 4 kafelki paskiem na dole,
                   przyciski przy prawej krawędzi, „więcej” jako strzałka w dół), tablet (min 744×744 px: kafelki 2×2 obok karty, przyciski pod kartą,
                   pasek prędkości względem limitu i pasek 4,5 h jazdy na kafelku przerwy, przycisk powrotu do pozycji zawsze). Karta manewru: tabliczka
                   z numerem drogi (HudNav roadBadge: A/S/krajowe czerwone, wojewódzkie żółte, E zielone), „›” = lista najbliższych manewrów;
                   „⋯” = menu jak w TomTom GO (NavMenu.tsx: pełny ekran nad przyciemnioną mapą, duże ikony białe + akcent; pionowo lista, poziomo
                   przewijany rząd; Szukaj / Jedź do domu / Ostatnie cele / Aktualna trasa / Moje miejsca → HudRoutePicker start {go | tab}, przerwa, dzień,
                   zgłoś, ustawienia, pełny ekran, zakończ nawigację, wyjdź; przełącznik głosu na dole; strony jak w TomTom: MenuPage {heading, items | content},
                   MENU_PARENT = powrót; „Aktualna trasa”: pomiń następny postój (onVia bez pierwszego), znajdź inną trasę (picker {go: cel}),
                   omiń blokadę drogi (nav.onAvoid: punkty 0,4–2 km przed nami → /api/nav/route {avoid} → valhallaRoute exclude, NavRoute.avoid
                   zostaje przy reroute, MAX_AVOID 12), omijaj płatne (Vehicle.avoid.tolls + reroute), cel do ulubionych, wskazówki;
                   „Ustawienia” → lista Wygląd / Głos / Planowanie trasy / Profil pojazdu / Po drodze → NavSettingsPage section);
                   wyszukiwarka na pełnym ekranie (.nmp, HudRoutePicker full): pole z podkreśleniem, kółka kategorii (Parking TIR / MOP / Stacja / Po drodze →
                   AheadSheet initialFilter), wiersze Dom / Ulubione / Ostatnie (SavedPlaces rows), wyniki z odległością w linii prostej;
                   „Ustawienia” → NavSettings.tsx (zakładki Trasa / Pojazd / Mapa / Miejsca: rodzaj trasy, Vehicle.avoid {tolls, motorways, ferries} → valhalla.mjs
                   use_tolls / use_highways / use_ferry = 0, TomTom avoid=…; wymiary, ADR, motyw, 2D/3D, głos, „po drodze”; „Przelicz trasę” = nav.onReroute).
                   Panel przycisków (.nm-side) po lewej na każdym urządzeniu (poziomo rzędem pod manewrem), zwijany do lewej (.nm-fold, localStorage
                   „roadpilot:navSide”), „⋯” zostaje; po prawej tylko 2D/3D, +/−, „namierz” (zawsze widoczny).
                   Pasek „po drodze”: też najbliższy fotoradar i początek odcinkowego pomiaru z route.warnings (AheadStrip.camera, czerwona ramka .alert).
                   Porównanie tras (RouteCompare): GlVector.quiet (tylko duże miasta, bez zakazów — QUIET_VEHICLE), dymki „A · 7 h 32” przy trasach
                   (callout: punkt najdalej od innych tras, dymek na zewnątrz; wąska mapa < 420 px = sama litera), start i meta; poziomo
                   .route-compare display: contents — mapa na całą wysokość po lewej.
                   Przycisk 2D/3D nad zoomem (Settings.navMap): 2D = HudRouteMap flat (pitch 0, FLAT_ZOOM −2, trasa na 25 km, bez horyzontu .nm-map.flat). Karty „szklane” gradientem, bez backdrop-filter;
                   Manewr na każdym urządzeniu i w każdej orientacji (2026-10-02) jako „napisy na horyzoncie” (.nm-top .hud-nav.card bez tła, z cieniem
                   pod tekstem; w dzień ciemne napisy z jasną poświatą) — telefon pionowo: pasy w drugim wierszu, poziomo i tablet: w jednym wierszu;
                   Tablet (wersja lżejsza 2026-10-01): mapa na cały ekran, zwarta półprzezroczysta karta manewru w lewym górnym rogu (40%,
                   bez kafelka kolejnego manewru — „›” = lista), przyciski pod nią, kafelki ukryte — dolny smukły pasek .nm-progress: do celu ·
                   przyjazd · przerwa · trasa + oś trasy jak w HUD (HudView RouteLine: Start, ciężarówka z %, postoje z planu „za X km” + godzina, Cel); odcinkowy pomiar na tablecie zastępuje tę oś
                   w tym samym stylu (SectionControl SectionLine: limit, kwadraciki w kolorze średniej, ciężarówka ze średnią, meta „za X km”)
                   (w karcie ukryty .nm-section-card), na telefonach zostaje w karcie; mniejsza skala --u i przyciski 8u
                   strzałki (HudNav arrowGeom/Arrow): trzon + wypełniony grot (.head fill currentColor — kolor przez `color`, nie `stroke`), ostre skręty
                   z trzonem z boku, zawracanie przez lewo; rondo (RoundaboutIcon) przeciwnie do ruchu wskazówek, kąt zjazdu z serwera (valhalla.mjs
                   turnAngle: wjazd 26 → bearing_after manewru 27), przy zawracaniu zjazd po lewej; kąt z trasy przy TURN albo |kąt| ≥ 60°, inaczej ANGLES.
                   Ograniczenie: z trasy (legalLimitAt), a gdy trasa nie ma danych w tym miejscu — z drogi pod kołami (useLimitHere), jak bez trasy
                   HUD dostaje trasę tylko jako dane (navRoute: km po trasie do MOP-u/znajomych, limit do koloru prędkości)
src/components/    widoki; HudView.tsx = tryb HUD; fields.tsx = NumberField, OptionalNumberField, DurationField, Toggle, Stepper
src/api.ts         zapytania do API, token sesji (localStorage "roadpilot:auth"), tryb bez konta ("roadpilot:guest")
src/sync.ts        useSync: stan ↔ konto (wysyłka co ≤ 30 s i przy schowaniu z baseRev; pobranie przy starcie/powrocie i co 30 s);
                   nie wysyła track/hud/planTime/navRoute/pendingGap; meta w "roadpilot:sync" { rev, dirty, stamps }.
                   Nowa wersja na koncie albo 409 → scalanie (src/syncMerge.ts mergeStates): grupy tacho (driver, stop, tracker, odoKm) / trip /
                   settings / history, w każdej nowszy znacznik (stamps = kiedy grupa zmieniła się na urządzeniu, które ją zmieniło; wysyłane jako
                   state.syncStamps; remis → konto), historia = suma dni; tachograf z konta od innego urządzenia → track = null (bez liczenia luki drugi raz).
                   `ready` = pierwsze pobranie skończone (maks. 10 s) — do tego czasu GPS nie dolicza jazdy (useGpsTracking hold)
src/components/AuthScreen.tsx  logowanie / rejestracja / „Kontynuuj bez konta”
src/core/friends.ts  znajomi: presenceOf (co wysyłamy: pozycja, prędkość, status driving/standing/break/rest/dayEnd, since, cel, przyjazd, tachograf),
                   describeFriend (km w linii prostej, status, „25 min z 45 min”), nearestFriend; testy friends.test.ts
src/friends.ts     useFriends: GET /api/friends co 30 s (gdy widoczna), POST /api/presence co 20 s tylko z kontem + GPS + friendsShare
                   + ≥1 zaakceptowany znajomy; wyłączenie → POST {off:true} kasuje obecność. Friends.tsx = karta na Planie, Ustawienia → Znajomi
                   (status + „Gdzie jest”: MapView z pozycją przy Premium, inaczej link do map), kafelek HUD
public/sw.js       service worker (cache "roadpilot-vN"): nawigacja network-first, assets cache-first, /api/ zawsze z sieci
server/friends.mjs   znajomi: cleanPresence (walidacja obecności, pozycja do 1e-4°), friendView (relation accepted/invited/pending, obecność ≤
                   PRESENCE_TTL 10 min = na żywo, liczone od odczytu GPS: aplikacja wysyła posAge, serwer zapisuje posAt; pozycja w ruchu starsza niż
                   PRESENCE_MOVING_MAX_AGE_MS 60 s nie jest wysyłana (presenceSendable), a po powrocie z tła `live` starszy niż 30 s jest kasowany; iPhone podaje wtedy starą pozycję ze świeżą godziną — tracking.ts odrzuca odczyt identyczny z poprzednim po > 30 s, serwer keepReplayedPosAt zostawia stary posAt przy tej samej pozycji w jeździe ≥ 10 km/h; starsza do 7 dni z offline: true = ostatnia pozycja, szara strzałka na mapie); tabele friends (user_id zaprasza friend_id, accepted_at) i presence (JSON, 1 wiersz na konto);
                   /api/friends (GET), /api/friends/invite|accept (POST), DELETE /api/friends, POST /api/presence — wszystkie z kontem
server/            RoadPilot API: index.mjs (node:http + mysql2), schema.sql; nav.mjs = TomTom (routeUrl, parseRoute, parseSearch) + nav.test.mjs;
                   /api/nav/* tylko Premium (users.premium_until / role=admin) + limit na IP + dzienny limit na konto + budżet TomTom
                   (api_usage, okres TOMTOM_PERIOD=month|day, próg 80% limitów TOMTOM_LIMIT_SEARCH/ROUTING); collect.mjs + /api/consent,
                   /api/collect/points|report, DELETE /api/collect (gps_points, road_reports — tylko Polska); /api/admin/stats; /api/admin/users i /api/admin/premium tylko admin; klucz TOMTOM_KEY w /etc/roadpilot-api.env; usługa roadpilot-api.service (127.0.0.1:7781),
                   Nginx /roadpilot/api/ → /api/, konfiguracja /etc/roadpilot-api.env (MariaDB przez gniazdo unixowe,
                   SMTP simply.com do resetu hasła, APP_ORIGINS = CORS + linki w e-mailach); zależności: mysql2, nodemailer
server/warnings.mjs  ostrzeżenia na trasie z osm_restrictions + road_reports (routeBoxes → zapytania po prostokątach, routeWarnings:
                   punkt ≤ 20 m, odcinek musi biec wzdłuż trasy — most nad drogą nie ostrzega); POST /api/nav/warnings (bez kosztów TomTom)
                   dropCopiedBridgeHeights: maxheight na moście (osm_restrictions.bridge) pomijany, gdy ≤ 40 m obok jest droga bez mostu z tą samą
                   wartością — błąd OSM „wysokość wiaduktu przepisana na most” (Estakada Kwiatkowskiego w Gdyni 3,5 m jak Leszczynki pod nią);
                   działa też na objazdy silnika RoadPilot (findWarnings → blockingPoints)
server/traffic.mjs  KORKI WYŁĄCZONE (2026-10-01, licencja/limity TomTom): front `TRAFFIC_ON = false` (nav.ts) — bez odświeżania i bez pokazywania,
                   serwer bez `TRAFFIC_ENABLED=1` → /api/nav/traffic 503, a trasa TomTom bez `traffic`. Kod zostaje: korki dla obu silników: trafficBoxes (routeBoxes sklejane do ≤ 9000 km² — limit TomTom 10 000), incidentSections
                   (zdarzenia TomTom kategorii TRAFFIC_CATEGORIES → { km, toKm, delayMin, level, cause } jak parseRoute; początek, środek i koniec ≤ 50 m
                   od trasy i km rosnące — druga jezdnia odpada); POST /api/nav/traffic (Premium, budżet „traffic” = TOMTOM_LIMIT_TRAFFIC, cache 2 min);
                   App: refreshTraffic (nav.ts, TRAFFIC_REFRESH 5 min / 150 km, NavRoute.trafficAt), własny silnik od razu po wyznaczeniu
server/compare.mjs   zgłoszenia kierowców vs OSM (missing / diff / match / info, potwierdzenia); GET /api/admin/compare
server/valhalla.mjs  własny silnik tras (Valhalla, OSM Polska, VALHALLA_URL): valhallaRequest (truck), parseValhalla → format jak parseRoute;
                   pasy ruchu: osrmLanes — to samo zapytanie z format "osrm" (withLanes w index.mjs, równolegle z trace_attributes): skrzyżowania z lanes
                   (indications, valid, valid_indication = follow) → LaneSection jak TomTom; pomijane: mijany pojedynczy pas zjazdu (każdy pas „prosto” prowadzi,
                   bez manewru z trasy w LANE_MANEUVER_KM i bez rozjazdu ≥ 2 pasów — rozjazd S6/S7 musi być widoczny),
                   > LANE_MAX 5 pasów (plac poboru opłat), powtórka w tym samym miejscu. Asystent pasa: core/navmatch laneHint („Jedź skrajnie
                   prawym pasem” — pas zjazdowy, którego jeszcze nie ma, osiągniemy z prawego), lanesAhead od NAV.lanesAheadKm 15 km (stała podpowiedź pasa do najbliższego miejsca wyboru, tylko dla najbliższego manewru), głos
                   (voice.ts LANE_SAY_KM 1,2 km autostrada / 0,35 km); bramki: osm_pois kind "toll" (barrier=toll_booth, TOLL_NEAR_M 12 m — tylko nasza
                   jezdnia), wysyłane tylko gdy aplikacja prosi (warnings {tolls:true}); karta: baner od NAV.tollAheadKm 3 km, głos „Za 1 km bramki”
                   /api/nav/route: zawsze własny silnik w PL (wybór silnika usunięty z aplikacji 2026-10-01); TomTom tylko awaryjnie — poza PL albo gdy Valhalla nie da trasy; valhallaRoute sprawdza trasę
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
server/geo.mjs     miejsce przekroczenia: placeRow (osmium n/place=city,town,village,suburb → osm_places, place-import.mjs, krok w osm-update.sh),
                   pickPlace (w miejscowości wg promienia PLACE_IN_KM, inaczej najbliższa ≤ 15 km), pickPoi (≤ 700 m), roadLabel (Valhalla names → „A2”,
                   „DK 14, Łódzka”, „DW 708, …”); POST /api/geo/where (locate 5 punktów bez dróg serwisowych) i POST /api/gps/gap (gapRequest/gapRoute) —
                   z kontem, bez Premium, POST żeby pozycje nie szły do logów Nginx
server/premium.mjs  klucze Premium: makeKey (RP-XXXX-XXXX, alfabet bez 0/O/1/I/L), normalizeKey (spacje, myślniki, małe litery), extendPremium
                   (dni od końca trwającego Premium albo od teraz; null = bez terminu 9999); tabela premium_keys; POST/GET/DELETE /api/admin/keys (admin),
                   POST /api/premium/redeem (konto, jednorazowo: warunkowy UPDATE used_by IS NULL); UI: SettingsView PremiumKeysCard (Administracja),
                   RedeemKey („Mam klucz Premium” w Konto → AccountProps.onUser)
server/parking.mjs  parking przy celu: cleanParking, boxAround/distanceM, parkingView (promień PARKING_RADIUS_M 300 m, sortowanie po 👍−👎, podsumowanie
                   bez opinii z przewagą 👎); tabele parking_opinions (1 opinia na konto przy celu) i parking_votes; GET/POST/DELETE /api/parking,
                   POST /api/parking/vote — z kontem, bez Premium; ParkingCard.tsx w NavCard (przy wybranym celu)
src/components/PrintoutTips.tsx  Pro tip na Planie: formułki na odwrót wydruku z tachografu (art. 12 561/2006, art. 35/37 165/2014), kopiowanie do schowka
alert_votes        głosy „jest / nie ma” po minięciu fotoradaru/kontroli (POST /api/alerts/vote, applyVotes w warnings.mjs)
server/osm.mjs     OSM → ograniczenia (height/weight/axle/width/length/hgv/speed_hgv), parseValue; osm-import.mjs → tabela osm_restrictions
/opt/roadpilot-valhalla  dane i build.sh Valhalla (docker ghcr.io/valhalla/valhalla); kontener roadpilot-valhalla na 127.0.0.1:8002;
                   budowa potrzebuje kilku GB RAM; serwer Metin2 (m2pb-06b67463-*) zatrzymany na stałe od 2026-10-02 (restart=no)
scripts/tiles-build.sh  własne kafelki wektorowe: tilemaker (server/tiles/config.json + process.lua: warstwy water, landuse, waterway, railway, road
                   z tagami ograniczeń, building, place; z 6–14, gzip; drogi: autostrady/ekspresowe/trunk od z6, krajowe primary od z7, secondary od z9 — oddalona mapa nie jest pusta;
                   GlMap dorysowuje brakujący kafelek z rodzica do 3 poziomów) → katalog VTILES_DIR (z/x/y.pbf) serwowany przez GET /api/vtiles/z/x/y
                   (204 = pusty kafelek) i GET /api/vtiles/meta {available, bounds}; aplikacja używa własnych kafelków tylko w ich zasięgu
scripts/osm-update.sh  pobranie Polski (lustro openstreetmap.fr — Geofabrik blokuje VPS) → osmium tags-filter → export → import; dane w /opt/roadpilot-osm
server/conditional.mjs  ograniczenia warunkowe z OSM (`maxweight:conditional`, `hgv:conditional`): parseConditional (godziny, dni, PH = święta PL,
                   weight<>, destination/delivery), effectiveRestriction; osm_restrictions.cond (JSON); warnings.mjs applyConditions — w chwili przejazdu
                   (teraz + km / prędkość trasy; aplikacja wysyła lengthKm/travelMin), strefa „tylko dojazd” = ciąg odcinków (≤ 1,5 km przerwy) do celu/startu;
                   nieobowiązujące = `soft` + `note` (bez objazdu, bez karty i głosu). incline ≥ 8% (osm.mjs), ciasne zakręty valhalla.mjs sharpCurves
                   (route.curves → nav.ts curveWarnings dla zestawów ≥ 12 m). Wjazd TIR: zgłoszenie „gate” ≤ 400 m od celu = koniec trasy (route.gate).
server/speeds.mjs  prędkości ciężarówek z gps_points: komórki ~250 m × kierunek (speed_cells, speed-build.mjs), applySpeeds → segments[].kmh
                   (Route: min(zmierzona, ustawiona)), travelMin, realSpeedShare. server/mapcheck.mjs: suspectPasses (map_suspects, suspects-build.mjs),
                   osm_overrides (admin ukrywa ograniczenie — findWarnings pomija), badTurnClusters (zgłoszenie „bad_turn” z NavView BadTurn; ≥ 2 kierowców
                   → exclude_locations w valhallaRoute); Ustawienia → Administracja → Błędy mapy (MapCheckCard, /api/admin/mapcheck, /api/admin/override)
src/core/gapfix.ts  luka z przesunięciem (≥ 15 min, ≥ 1 km): AppState.gapReview (stan tachografu sprzed luki, suma jazdy po niej; tylko lokalnie,
                   jak pendingGap) → GapSheet w Nawigacji (samo przy niewyjaśnionej, menu ⋯) i w Historii („Uzupełnij, co robiłem”): jazda / pauza (ile,
                   na początku / końcu) / postój → applyGapAnswer przelicza tachograf od stanu sprzed luki + postoje i jazda z historii po niej
scripts/weekly-update.sh  timer systemd roadpilot-weekly (niedziela 01:00 UTC): osm-update → Valhalla w /opt/roadpilot-valhalla.new (Metin2 — jeśli
                   ktoś go uruchomi — zatrzymany na czas budowy i wznawiany) → podmiana + test trasy (błąd = powrót) → kafelki → speed-build, suspects-build → restart API;
                   log /var/log/roadpilot-weekly.log. Plan i stan: upgrade.md
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
- `creditDriving` obcina `sinceBreakMin` do 270 — przekroczenie ciągłej jazdy widać tylko w historii (`violations.ts`), nie w stanie.
- Jazda 9–10 h z GPS nie zmniejsza `extensionsLeft` (przekroczenie dzienne liczy limit 10 h, póki są wydłużenia).
- `DurationField` pozwala wpisać np. 10 h 59 min jazdy dziennej (limit godzin, a minuty do 59).
- `planForDeadline` zakłada monotoniczność (`maxWhere`) — przy granicy tygodnia może nie znaleźć optimum.
- Stałe powiadomienie to obejście PWA (audio + Media Session): na Androidzie może przejąć fokus audio i zatrzymać
  muzykę z innej aplikacji; znika po zamknięciu aplikacji z listy ostatnich. Prawdziwa usługa w tle wymaga opakowania
  natywnego (np. Capacitor). GPS w tle nie jest gwarantowany — luki nadrabia `addFix` po powrocie (szacunek: droga z serwera, kolejność jazda / postój z heurystyki).
- Synchronizacja: zapis z `baseRev`, konflikt → scalanie grupami po znacznikach czasu (zegary telefonów muszą być zbliżone; gdy dwa
  urządzenia offline liczą jazdę naraz, wygrywa to, które zapisze później — nie da się tego rozstrzygnąć bez sieci), pobieranie co 30 s
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
