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
  rules.ts         JEDYNE miejsce z limitami z przepisów (minuty)
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
                   alongRoute / nearestOnRoute — km po trasie do punktu przy niej (MOP, znajomy; ON_ROUTE_M = 300)
src/components/MapView.tsx  mapa bez bibliotek: kafelki TomTom 512 px (noc) przez /api/tiles z tokenem (fetch → blob), Web Mercator,
                   obrót (bearing) i pochylenie (pitch) warstwy, nakładki SVG w układzie mapy; smoothMs = płynny dojazd między odczytami GPS
                   (kafelki względem stałego punktu odniesienia, przesunięcie w transformacji warstwy z transition; bez tego mapa skakała co 1 s);
                   AdminMap.tsx = podgląd danych (warstwy OSM, zgłoszenia, ślady)
src/components/HudNav.tsx  useNavTrack (pozycja na trasie, poza trasą → onReroute po 15 s; brak trasy w urządzeniu, a jest cel → od razu; max 1/min),
                   HudNav (manewr + pasy + ograniczenie), HudRouteMap (styl HUD „nav”: mapa TomTom pochylona, kierunek jazdy w górę, trasa, zielona strzałka = my; zoom od prędkości)
                   useSmoothPosition — jak w nawigacjach: między odczytami GPS przewidujemy ruch z ostatniej prędkości (po trasie / wzdłuż kierunku),
                   20 klatek/s, nowy odczyt koryguje płynnie przez 1 s (SMOOTH); bez tego mapa skakała co sekundę
src/collect.ts     mapa RoadPilot (za zgodą users.data_consent_at): useTraceCollector (ślad co 5 s / 60 m, >8 km/h, tylko PL, bufor w localStorage
                   "roadpilot:trace", wysyłka co 5 min / 400 pkt), sendReport, setConsent, deleteMyMapData; MapConsent.tsx, ReportSheet.tsx
src/voice.ts       komunikaty głosowe (Web Speech, pl-PL): useNavVoice — manewry (progi zależne od prędkości) i ostrzeżenia ≤ 1 km; spokenDist
src/nav.ts         nawigacja (beta): Vehicle, NavPlace, NavRoute; searchPlaces / fetchRoute przez API → TomTom; AppState.navRoute tylko lokalnie (nie w sync)
src/components/NavCard.tsx  Trasa: wyszukiwanie celu, „Wyznacz trasę dla ciężarówki”; trasa → trip.segments (profil custom) → silnik przerw
src/hudConfig.ts   HudStyle (full/minimal), HUD_ITEMS, DEFAULT_HUD_ITEMS — Settings.hudItems[styl]; element „road” steruje też pobieraniem dróg
src/floating.ts    pływające okienko: canvas → captureStream → <video> → PiP (requestPictureInPicture / webkitSetPresentationMode); useFloating(info, prepare)
src/install.ts     useInstall: beforeinstallprompt łapane przy wczytaniu modułu, isStandalone; InstallButton.tsx = przycisk + instrukcja iOS
src/launch.ts      platform() z userAgent, launch(): otwiera link z apps.ts (iOS: po 1,5 s bez przejścia → strona)
src/nearby.ts      HUD: useStations, useParkings, useRoads (Overpass, z serwerem zapasowym) i useWeather (Open-Meteo)
src/App.tsx        jedyne miejsce łączące stan z silnikiem (useMemo); activePlan = wybór kierowcy (AppState.choice) → plan pod rozładunek → zalecany; 5 zakładek: Plan/Trasa/Tachograf/Historia/Ustawienia;
                   gdy state.hud — renderuje tylko HudView
src/components/    widoki; HudView.tsx = tryb HUD; fields.tsx = NumberField, OptionalNumberField, DurationField, Toggle, Stepper
src/api.ts         zapytania do API, token sesji (localStorage "roadpilot:auth"), tryb bez konta ("roadpilot:guest")
src/sync.ts        useSync: stan ↔ konto (ostatni zapis wygrywa; wysyłka co ≤ 30 s i przy schowaniu, pobranie przy starcie/powrocie);
                   nie wysyła track/hud/planTime; meta w "roadpilot:sync" { rev, dirty }
src/components/AuthScreen.tsx  logowanie / rejestracja / „Kontynuuj bez konta”
src/core/friends.ts  znajomi: presenceOf (co wysyłamy: pozycja, prędkość, status driving/standing/break/rest/dayEnd, since, cel, przyjazd, tachograf),
                   describeFriend (km w linii prostej, status, „25 min z 45 min”), nearestFriend; testy friends.test.ts
src/friends.ts     useFriends: GET /api/friends co 30 s (gdy widoczna), POST /api/presence co 20 s tylko z kontem + GPS + friendsShare
                   + ≥1 zaakceptowany znajomy; wyłączenie → POST {off:true} kasuje obecność. Friends.tsx = karta na Planie, Ustawienia → Znajomi, kafelek HUD
public/sw.js       service worker (cache "roadpilot-vN"): nawigacja network-first, assets cache-first, /api/ zawsze z sieci
server/friends.mjs   znajomi: cleanPresence (walidacja obecności, pozycja do 1e-4°), friendView (relation accepted/invited/pending, obecność tylko
                   świeża ≤ PRESENCE_TTL 10 min); tabele friends (user_id zaprasza friend_id, accepted_at) i presence (JSON, 1 wiersz na konto);
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
server/enforcement.mjs  OSM (OPL) → fotoradary / odcinkowe pomiary / kamery na czerwonym (relacje enforcement: from→device = kierunek,
                   from→to = odcinek); enforcement-import.mjs → tabela osm_enforcement. warnings.mjs routeAlerts: dopasowanie do trasy
                   z kierunkiem (from / kurs zgłaszającego); zgłoszenia police/itd żyją 3 h (ALERT_TTL_H); HUD dociąga je co 5 min
server/nav.mjs → parseRoutes: trasa + alternatywy (maxAlternatives=2, 1 zapytanie TomTom) i korki (sectionType=traffic → route.traffic);
                   POST /api/nav/route {alternatives:true} → {route, alternatives}; Valhalla: alternates=2 (valhallaAlternates)
alert_votes        głosy „jest / nie ma” po minięciu fotoradaru/kontroli (POST /api/alerts/vote, applyVotes w warnings.mjs)
server/osm.mjs     OSM → ograniczenia (height/weight/axle/width/length/hgv/speed_hgv), parseValue; osm-import.mjs → tabela osm_restrictions
/opt/roadpilot-valhalla  dane i build.sh Valhalla (docker ghcr.io/valhalla/valhalla); kontener roadpilot-valhalla na 127.0.0.1:8002;
                   budowa potrzebuje kilku GB RAM — na czas budowy zatrzymywany kontener Metin2 m2pb-06b67463-game (zgoda użytkownika)
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
- Synchronizacja: ostatni zapis wygrywa — przy jeździe na dwóch urządzeniach naraz zmiany jednego mogą nadpisać drugie.
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
