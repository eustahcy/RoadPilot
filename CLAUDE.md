# CLAUDE.md — instrukcje dla Claude w projekcie RoadPilot

RoadPilot to PWA dla kierowcy ciężarówki (React 19 + TypeScript + Vite 7, bez backendu). Porównuje scenariusze
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

`npm run deploy` (rsync do `/var/www/roadpilot`) działa tylko na serwerze Linux z Nginx — **nie uruchamiaj go lokalnie
i nie wdrażaj bez wyraźnej prośby.**

Po każdej zmianie w `src/core/` uruchom testy i `npx tsc -b`. Po zmianie w UI — co najmniej `npx tsc -b`.

## Architektura

```
src/core/          RoadPilot Core — czyste, deterministyczne funkcje TS (bez Reacta, Date.now(), losowości)
  rules.ts         JEDYNE miejsce z limitami z przepisów (minuty)
  route.ts         Segment/Route: odcinki o różnych prędkościach, profile tras, remainingSegments
  plan.ts          simulate(): pętla jazda → przerwa → odpoczynek dzienny/tygodniowy; parkingHint, positionAt
  scenarios.ts     compareScenarios (now/rest9/rest11 + bestId), whatIfs, explain, driverStatus, fmtDuration
  deadline.ts      planForDeadline: najdłuższy odpoczynek / najpóźniejszy wyjazd pod awizację (wyszukiwanie binarne)
  reconstruct.ts   spóźniony start — liczniki z listy aktywności
  gps.ts           licznik km z odczytów, luki, średnia z 10 min, creditDriving/creditStop; nextLive (prędkość/kierunek do HUD)
  stations.ts      parseOverpass, nearestStation (najbliższa przed nami, ±70° od kierunku)
  service.ts       serviceStatus: dni i km do serwisu (km z licznika GPS AppState.odoKm)
  weather.ts       kod WMO → opis/ikona, isHazard
  *.test.ts        testy Vitest (core.test.ts, gps.test.ts, hud.test.ts)
src/state.ts       AppState (version: 1) w localStorage pod kluczem "roadpilot:v1", useNow (tick 15 s)
src/tracking.ts    Geolocation.watchPosition + Wake Lock → applyFix na stanie; zwraca { status, live }
src/nearby.ts      HUD: useStations (Overpass, z serwerem zapasowym) i useWeather (Open-Meteo)
src/App.tsx        jedyne miejsce łączące stan z silnikiem (useMemo), 4 zakładki: Plan/Trasa/Tachograf/Ustawienia;
                   gdy state.hud — renderuje tylko HudView
src/components/    widoki; HudView.tsx = tryb HUD; fields.tsx = NumberField, OptionalNumberField, DurationField, Toggle, Stepper
public/sw.js       service worker (cache "roadpilot-vN"): nawigacja network-first, assets cache-first
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
9. **Bez backendu i kont.** Jedyne zewnętrzne API (decyzja użytkownika, v0.5): Overpass (stacje) i Open-Meteo
   (pogoda) — darmowe, bez klucza, wołane **tylko w trybie HUD przy włączonym GPS**, z pozycją zaokrągloną do 0,01°.
   Nowych serwisów nie dodawaj bez zgody; każdy musi mieć obsługę braku sieci. Opis prywatności jest w Ustawieniach
   (sekcja „Dane”) — aktualizuj go przy zmianach. Nie dodawaj zależności npm bez potrzeby — obecnie tylko react/react-dom.
10. **HUD** ma być czytelny z odległości: duże cyfry, mało tekstu, działa poziomo i pionowo (`@media (orientation: portrait)`),
    także w odbiciu lustrzanym (`.hud.mirror`). Po zmianach sprawdź oba układy zrzutem ekranu.

## Znane ograniczenia i dług techniczny (stan na v0.5.0, 2026-09-30)

- HUD: odległość do stacji jest w linii prostej, nie po drodze; km do serwisu liczy tylko GPS przy otwartej aplikacji.

- Liczniki tygodniowe w `DriverState` (`weekDrivenMin`, `prevWeekDrivenMin`, `extensionsLeft`) **nie przewijają się
  same po poniedziałku 00:00** — robi to tylko symulacja. Po zmianie tygodnia kierowca musi je poprawić ręcznie,
  a GPS (`creditDriving`) dolicza jazdę do starego tygodnia.
- `creditDriving` obcina `sinceBreakMin` do 270 — przekroczenie ciągłej jazdy nie jest widoczne w stanie.
- `DurationField` pozwala wpisać np. 10 h 59 min jazdy dziennej (limit godzin, a minuty do 59).
- `planForDeadline` zakłada monotoniczność (`maxWhere`) — przy granicy tygodnia może nie znaleźć optimum.
- Przypomnienia (`Reminders.tsx`) liczą od `Date.now()`, także gdy ustawiono inną godzinę planowania.
- Poza zakresem silnika: odpoczynek tygodniowy po 6 okresach 24 h, dyrektywa 2002/15 (czas pracy, noc),
  promy/pociągi, jazda w załodze, lokalne zakazy ruchu.
- `package.json`: skrypty `test` i `deploy` są uniksowe (patrz „Komendy”).

## Git i GitHub

- Repozytorium: https://github.com/eustahcy/RoadPilot (publiczne, gałąź `main`).
- `dist/`, `node_modules/`, `*.tsbuildinfo` są w `.gitignore` — nie commituj buildów.
- Commituj i pushuj tylko na prośbę użytkownika; komunikaty commitów po polsku, krótkie, w trybie „co zmienia”.
- Po zmianie funkcji zaktualizuj tabelę „Co jest zrobione” i opis silnika w README.
