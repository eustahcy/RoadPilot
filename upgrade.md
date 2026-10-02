# Plan wdrażania: dokładniejsza nawigacja (2026-10-01)

**Stan 2026-10-01:** wszystkie 14 punktów wdrożone na VPS (test), poza licznikiem „zjazd 2 z 3” w punkcie 6.
Dane z jazdy (12, 13, 15) zaczną działać, gdy przybędzie przejazdów (dziś za mało kierowców); aktualizacja tygodniowa (16)
pierwszy raz w niedzielę 4.10 o 3:00 — sprawdzić `/var/log/roadpilot-weekly.log`.

Punkty z listy „co jeszcze poprawić” wybrane przez właściciela: 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16.
Każdy etap: kod + testy (`TZ=UTC npx vitest run`, `npx tsc -b`) → VPS (`npm run deploy`, przy zmianach serwera
`sudo systemctl restart roadpilot-api`) → sprawdzenie (zrzut / zapytanie do API) → commit → tuike (`npm run deploy:tuike`)
po akceptacji. Stan: `[ ]` do zrobienia, `[x]` zrobione.

Stan wyjściowy: własny silnik tras Valhalla (OSM Polska), ograniczenia z `osm_restrictions` (import `osm-update.sh`
ręcznie), ślady GPS kierowców za zgodą w `gps_points` (na razie ~7 tys. punktów, 3 konta), zgłoszenia w `road_reports`.

---

## Etap A — prowadzenie po trasie (aplikacja)

### [x] 1. Dopasowanie pozycji do trasy po śladzie, nie po jednym punkcie
- **Problem:** `navmatch.locate` rzutuje pojedynczy odczyt na najbliższy odcinek trasy. Przy jezdniach równoległych,
  wiaduktach i węzłach wybiera zły fragment → fałszywe „Poza trasą” albo skok pozycji.
- **Rozwiązanie:** `locateTrace(points, trail, hint)` w `src/core/navmatch.ts` — ostatnie 3–6 odczytów (ślad z `pushTrail`)
  z kierunkiem jazdy; kandydat na trasie musi zgadzać się kierunkiem (±45°) i kolejnością km (rosnąco). Odległość od trasy
  = mediana odległości śladu, nie jednego punktu.
- **Pliki:** `src/core/navmatch.ts` (+ testy), `src/components/HudNav.tsx` (`useNavTrack`).
- **Test:** ślad po jezdni równoległej 30 m obok → na trasie; ślad w przeciwnym kierunku po drugiej jezdni → poza trasą;
  wiadukt nad trasą (prostopadle) → nie przeskakuje.

### [x] 2. Pozycja w tunelach i przy słabym GPS
- **Problem:** bez odczytów (tunel, parking wielopoziomowy) albo przy dokładności > 50 m strzałka stoi lub skacze.
- **Rozwiązanie:** `useSmoothPosition` przewiduje ruch po trasie z ostatniej prędkości także przy braku odczytów —
  do 60 s i najwyżej 1,5 km (`NAV.deadReckonMs/Km`); odczyty z dokładnością gorszą niż 50 m na trasie tylko korygują
  (z wagą), nie przestawiają pozycji. Karta: dyskretne „GPS słaby” w czasie przewidywania.
- **Pliki:** `src/components/HudNav.tsx`, `src/core/navmatch.ts` (stałe), testy przewidywania w `navmatch.test.ts`.

### [x] 3. Kierunek z ruchu i z drogi zamiast z kompasu
- **Problem:** przy małej prędkości iPhone podaje kierunek z dużym błędem — strzałka i mapa się kręcą.
- **Rozwiązanie:** poniżej 15 km/h kierunek z drogi (na trasie: `bearingAtKm`; poza trasą: z przesunięcia między
  odczytami ≥ 20 m); `heading` z odbiornika tylko powyżej 15 km/h. Na postoju mapa nie obraca się wcale.
- **Pliki:** `src/components/HudNav.tsx` (`HudRouteMap`, `useSmoothPosition`), `src/core/navmatch.ts` (`headingFromTrail`).

### [x] 5. Zjazdy z numerem i kierunkiem z drogowskazu
- **Rozwiązanie:** karta: tabliczka „zjazd 53” (zielona jak na znakach) + kierunek z drogowskazu („→ Gdynia”);
  głos: „Za 1 kilometr zjazd 53, kierunek Gdynia” (z `ins.exit` i `ins.signpost`, zamiast pełnego zdania Valhalli).
  Zapowiedzi na autostradzie: 2 km, 1 km, 500 m, teraz.
- **Pliki:** `src/components/HudNav.tsx`, `src/voice.ts` (+ testy `voice.test.ts`), `server/valhalla.mjs` (pełniejsze
  `exit_toward/branch` z `sign`).

### [x] 6. Ronda z numerem zjazdu
- **Rozwiązanie:** na strzałce ronda cyfra zjazdu (z `roundaboutExit`), w głosie „Na rondzie trzeci zjazd, …”;
  w trakcie objeżdżania ronda licznik „zjazd 2 z 3” (z km po trasie i geometrii ronda) — **jeszcze nie** (do zrobienia,
  wymaga zjazdów ronda z geometrii Valhalli).
- **Pliki:** `src/components/HudNav.tsx` (`RoundaboutIcon`), `src/voice.ts`.

### [x] 7. Widok skrzyżowania z bliska
- **Rozwiązanie:** przed złożonym miejscem (pasy do wyboru, rozjazd, rondo, dwa manewry w 300 m) mapa sama przybliża
  (zoom +1,2 od 400 m do manewru, płynnie) i wraca po jego minięciu; w 2D też.
- **Pliki:** `src/components/HudNav.tsx` (`HudRouteMap` zoom), `src/core/navmatch.ts` (`complexAhead`).

---

## Etap B — trasa dla ciężarówki (serwer + dane OSM)

### [x] 8. Zakazy zależne od czasu
- **Rozwiązanie:** import tagów `hgv:conditional`, `maxweight:conditional`, `maxweight:hgv:conditional`,
  `access:conditional` (`no @ (Sa 08:00-22:00; PH)`, `Mo-Fr 06:00-10:00` …) — parser podzbioru `opening_hours`
  (dni, godziny, święta PL) w `server/osm.mjs` → kolumna `cond` w `osm_restrictions`. Przy trasie: ograniczenie
  obowiązuje, jeśli jest aktywne w chwili przejazdu (czas wyjazdu + km / prędkość trasy). Aktywne = ostrzeżenie
  i objazd jak dziś; nieaktywne = informacja „zakaz w soboty 8–22”.
- **Pliki:** `server/osm.mjs`, `server/osm-import.mjs`, `server/schema.sql` (kolumna `cond`), `server/warnings.mjs`,
  `server/index.mjs` (`findWarnings` z czasem przejazdu), `scripts/osm-update.sh` (filtr tagów), testy.

### [x] 9. Dojazd do celu w strefie z zakazem
- **Problem:** `hgv=destination` / `delivery` i „nie dotyczy dojazdu” traktujemy jak twardy zakaz — trasa omija cel.
- **Rozwiązanie:** ograniczenie z `destination`/`delivery` w promieniu 3 km od celu albo startu nie blokuje trasy
  (bez objazdu w silniku), ostrzeżenie miękkie „tylko dojazd — cel w strefie”.
- **Pliki:** `server/warnings.mjs` (`blockingPoints`, `routeWarnings`), `server/index.mjs`, testy.
- **Zrobione:** `applyConditions` — strefa „tylko dojazd” to ciąg takich odcinków (przerwy ≤ 1,5 km) dochodzący do celu / startu;
  sprawdzone na żywo: cel w strefie 3,5 t pod Skarszewami — 4 odcinki miękkie, trasa bez objazdu.

### [x] 10. Strome zjazdy, ciasne zakręty
- **Rozwiązanie:** import `incline` (≥ 8%) jako kind `incline`; ciasne zakręty z geometrii Valhalli (promień < 25 m,
  nie na skrzyżowaniu z manewrem — tylko łuk drogi) → ostrzeżenia `incline` / `curve` na trasie (pinezka + karta +
  głos „Uwaga, stromy zjazd 10%”).
- **Pliki:** `server/osm.mjs`, `scripts/osm-update.sh`, `server/valhalla.mjs` (`sharpCurves`), `server/index.mjs`,
  `src/nav.ts` (`warningText`), `src/components/HudNav.tsx` (ikony), testy.

### [x] 11. Wjazd dla ciężarówek przy celu
- **Rozwiązanie:** nowe zgłoszenie „Wjazd TIR” (miejsce bramy). Przy wyznaczaniu trasy: jeśli w promieniu 400 m od celu
  jest zgłoszony wjazd TIR, trasa prowadzi do niego (cel bez zmian w opisie, na karcie „wjazd TIR zgłoszony przez kierowcę”).
- **Pliki:** `server/collect.mjs`, `src/collect.ts`, `src/components/ReportSheet.tsx`, `ReportIcon.tsx`,
  `server/index.mjs` (`/api/nav/route`: podmiana `to`), `src/components/NavCard.tsx` / `HudRoutePicker.tsx` (informacja).

---

## Etap C — dane z jazdy kierowców

### [x] 12. Prędkości ciężarówek z GPS kierowców
- **Rozwiązanie:** nocne zadanie `server/speed-build.mjs`: odczyty `gps_points` (jazda > 5 km/h) → komórki ~250 m
  × kierunek (8 sektorów) → mediana prędkości, liczba przejazdów → tabela `speed_cells`. Przy trasie: tam, gdzie komórka
  ma ≥ 5 przejazdów od ≥ 2 kierowców, czas odcinka z naszej mediany zamiast z mapy → `travelMin` i prędkości odcinków
  (`segments[].kmh`) do planu przerw. Opis trasy: „czas z jazdy kierowców RoadPilot na X% trasy”.
- **Pliki:** `server/speeds.mjs` (+ testy), `server/speed-build.mjs`, `server/schema.sql`, `server/index.mjs`,
  `src/core/route.ts` (opcjonalna prędkość odcinka — sprawdzić zgodność z planem przerw, test w `core.test.ts`).

### [x] 13. Wykrywanie błędów mapy z jazdy
- **Rozwiązanie:** zadanie `server/suspects-build.mjs`: ograniczenia (wysokość, masa, zakaz), przez które przejechało
  ≥ 3 różnych kierowców RoadPilot ciężarówką wyższą / cięższą (dane pojazdu z konta) wzdłuż drogi (kierunek ±30°)
  → lista „podejrzane ograniczenia” w panelu admina (Ustawienia → Administracja) z linkiem do OSM; admin może
  ukryć ograniczenie (`osm_overrides`), co działa od razu dla tras i ostrzeżeń.
- **Pliki:** `server/suspects.mjs` (+ testy), `server/suspects-build.mjs`, `server/schema.sql`, `server/index.mjs`
  (`/api/admin/suspects`, `/api/admin/override`), `src/components/SettingsView.tsx` (lista w Administracji).

### [x] 15. Zgłoszenie „zły manewr”
- **Rozwiązanie:** w Nawigacji (menu „Zgłoś” → „Zły manewr”) jednym dotknięciem: zapisujemy pozycję, km trasy,
  manewr i punkt tuż za nim (`bad_turn`). Gdy ≥ 2 różnych kierowców zgłosi ten sam manewr (±30 m, kierunek ±30°),
  silnik omija go (`exclude_locations` w punkcie za manewrem) i karta ostrzega „ten skręt zgłaszany jako niemożliwy”.
  Lista w panelu admina.
- **Pliki:** `server/collect.mjs`, `server/index.mjs` (`valhallaRoute` + wykluczenia), `src/collect.ts`,
  `src/components/ReportSheet.tsx`, `src/components/NavView.tsx`, testy.

---

## Etap D — świeże dane

### [x] 16. Cotygodniowa aktualizacja OSM, Valhalli i kafelków
- **Rozwiązanie:** `scripts/weekly-update.sh`: pobranie Polski (lustro openstreetmap.fr) → `osm-update.sh` (importy)
  → przebudowa Valhalli (zatrzymanie kontenera Metin2 `m2pb-06b67463-game` na czas budowy — zgoda właściciela,
  budowa ~5 GB RAM) → podmiana `tiles.tar` i restart `roadpilot-valhalla` → kafelki wektorowe (`tiles-build.sh`
  z `--skip-integrity`) → zadania 12 i 13 → restart API. Timer systemd: niedziela 03:00 czasu polskiego (01:00 UTC). Log w
  `/var/log/roadpilot-weekly.log`; przy błędzie zostają poprzednie dane (budowa do katalogów tymczasowych).
- **Pliki:** `scripts/weekly-update.sh`, `/etc/systemd/system/roadpilot-weekly.{service,timer}`, CLAUDE.md (opis).
- **Uwaga:** wymaga pełnych uprawnień na serwerze; Metin2 nie działa przez ~1 h w nocy z soboty na niedzielę.

---

## Kolejność realizacji

1. Etap B (8, 9, 10, 11) — zmiany danych i API, wspólne dla starszych wersji aplikacji.
2. Etap C (12, 13, 15) — tabele i zadania nocne.
3. Etap D (16) — automat aktualizacji (uruchamia zadania z B i C).
4. Etap A (1, 2, 3, 5, 6, 7) — aplikacja; na koniec zrzuty telefon / tablet i jazda testowa właściciela.
