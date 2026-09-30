# RoadPilot

RoadPilot to mobilny asystent planowania trasy dla kierowcy ciężarówki.

## Cel projektu

RoadPilot ma odpowiadać na praktyczne pytanie:

> **„Co jest dla mnie teraz najlepszym scenariuszem dalszej jazdy?”**

Aplikacja przyjmuje m.in. dystans do celu, aktualny czas, dostępny czas jazdy/pracy oraz informacje o przerwach i odpoczynku. Następnie tworzy wykonalne scenariusze i porównuje przewidywany czas dotarcia.

### Przykład

Kierowca ma jeszcze 660 km.

RoadPilot może porównać:

- **Jedź teraz**
- **Odpocznij 9 godzin i rusz później**
- **Odpocznij 11 godzin i rusz później**

Wynikiem nie jest tylko „czas jazdy”, ale pełny plan z przerwami i odpoczynkiem oraz przewidywaną godziną przyjazdu.

> **Ważne:** RoadPilot jest asystentem planowania. Nie jest zamiennikiem homologowanego tachografu ani oficjalnym rejestratorem czasu pracy. Dane prawne należy zawsze weryfikować względem tachografu i obowiązujących przepisów.

## Zakres MVP

### 1. Dashboard kierowcy

- aktualna godzina,
- cel podróży,
- dystans do celu,
- przewidywana godzina przyjazdu,
- pozostały czas jazdy,
- pozostały czas pracy,
- następna sugerowana czynność.

### 2. Planowanie trasy

Użytkownik podaje:

- dystans,
- rodzaj/charakterystykę trasy,
- aktualny stan czasu jazdy,
- dostępny czas jazdy,
- informacje o przerwach,
- planowany odpoczynek.

RoadPilot wylicza przewidywany czas samej jazdy, a następnie nakłada na niego ograniczenia i postoje.

### 3. Różne prędkości na trasie

Trasa nie jest liczona jako:

`kilometry / jedna średnia prędkość`.

Silnik powinien uwzględniać segmenty, np.:

- autostrada,
- droga ekspresowa,
- droga poza obszarem zabudowanym,
- teren zabudowany,
- odcinki mieszane.

W przyszłości dane o odcinkach powinny pochodzić z map/routingu, a nie wyłącznie z ręcznego wpisywania.

### 4. Porównywarka scenariuszy

Najważniejszy moduł MVP.

Przykładowe scenariusze:

- **Jedź teraz**
- **Odpocznij 9 h**
- **Odpocznij 11 h**

Każdy scenariusz powinien otrzymać:

- godzinę startu,
- kolejne przerwy,
- odpoczynek,
- przewidywaną godzinę przyjazdu,
- łączny czas podróży,
- opis powodów wyniku.

RoadPilot nie powinien automatycznie „wybierać za kierowcę” bez pokazania wyliczeń. Powinien wskazać scenariusz spełniający ograniczenia i przedstawić różnice.

### 5. Spóźniony start

Jeżeli kierowca zapomniał uruchomić aplikację:

- wpisuje rzeczywistą godzinę rozpoczęcia,
- podaje aktualny stan tachografu,
- podaje wykorzystany czas jazdy/przerwy,
- może potwierdzić lub poprawić dane wykryte przez GPS.

GPS może pomóc odtworzyć ruch, ale nie powinien być traktowany jako źródło prawnego zapisu aktywności tachografu.

## Architektura

### Frontend MVP

- React
- TypeScript
- Vite
- CSS
- PWA

### Backend

**Brak backendu w pierwszym MVP.**

Dane mogą być przechowywane lokalnie w urządzeniu. Pozwala to przetestować produkt bez kosztów serwera i bez systemu kont.

Backend pojawi się dopiero, gdy będzie potrzebny np. do synchronizacji danych, kont użytkowników lub płatności.

### Silnik obliczeniowy

Rdzeniem powinien być deterministyczny **RoadPilot Core**.

Nie należy powierzać AI obliczania czasu jazdy, przerw ani zgodności z ograniczeniami. Te obliczenia muszą być:

- przewidywalne,
- testowalne,
- powtarzalne,
- możliwe do audytu.

AI może zostać dodane później jako warstwa pomocnicza, np. do rozmowy z kierowcą lub wyjaśniania wyniku.

## Plan rozwoju

### V0.1 — prototyp

- dashboard,
- dystans,
- aktualna godzina,
- podstawowe ETA,
- ręczne parametry czasu jazdy,
- scenariusze 9 h / 11 h,
- zapis lokalny.

### V0.2 — silnik RoadPilot Core

- segmenty trasy,
- przerwy,
- odpoczynki,
- ograniczenia,
- pełna oś czasu,
- porównywanie scenariuszy.

### V0.3 — PWA

- instalacja na telefonie,
- działanie offline dla podstawowych funkcji,
- lokalne dane,
- powiadomienia.

### V0.4 — GPS

- automatyczna lokalizacja,
- wykrywanie rozpoczęcia/przerwania ruchu,
- aktualizacja ETA,
- sugestia rozpoczęcia szukania parkingu.

### Później

- integracje z kompatybilnymi tachografami,
- integracje telematyczne,
- mapy/routing,
- płatności,
- synchronizacja kont.

## Technologia a koszty

Na początku projekt powinien być możliwie tani:

- React + Vite — frontend,
- PWA — instalacja bez konieczności publikowania aplikacji w sklepie,
- localStorage/IndexedDB — dane lokalne,
- brak serwera — dopóki nie jest potrzebny.

Dopiero potwierdzenie realnego użycia powinno uruchomić koszty backendu, API map, infrastruktury i publikacji natywnych aplikacji.

## Monetyzacja — kierunek do testów

Proponowany model:

### Free

- podstawowe planowanie,
- ograniczona liczba zaawansowanych scenariuszy,
- podstawowy dashboard.

### Pro

Przykładowy zakres:

- nielimitowane scenariusze,
- pełny planer,
- historia tras,
- bardziej szczegółowe ETA,
- zaawansowane „Co jeśli?”,
- przyszłe funkcje GPS.

Cena do przetestowania, a nie założenie biznesowe:

**ok. 9,99–19,99 zł/mies.**

Nie należy zakładać, że użytkownik zapłaci przed sprawdzeniem realnej wartości produktu.

Dobrym eksperymentem może być także stała darmowa wersja podstawowa + czasowy dostęp do funkcji Pro zamiast całkowitego blokowania aplikacji po 7 dniach.

## Zasada projektowa

RoadPilot ma być:

**prosty dla kierowcy, skomplikowany pod spodem.**

Kierowca nie powinien analizować tabel i wzorów. Powinien dostać jasny komunikat:

> „Jeżeli ruszysz teraz, przewidywany przyjazd: 09:40.”

> „Jeżeli odpoczniesz 11 godzin, przewidywany przyjazd: 07:35.”

> „Drugi scenariusz jest krótszy o 2 h 05 min.”

Dopiero po kliknięciu „Pokaż szczegóły” użytkownik zobaczy pełne wyliczenie.

## Co jest zrobione (v0.5)

| Moduł z README | Stan |
|---|---|
| Dashboard kierowcy | ✅ godzina, cel, dystans, przyjazd, jazda/praca/tydzień — zostało, następna czynność |
| Planowanie trasy | ✅ dystans, profil trasy lub własne odcinki, zapas na ruch |
| Różne prędkości na trasie | ✅ 5 typów dróg z własnymi prędkościami, liczone odcinkami |
| Porównywarka scenariuszy | ✅ jedź teraz / 9 h / 11 h, pełna oś czasu, powody wyniku, „Co jeśli?” |
| Spóźniony start | ✅ rzeczywisty początek dnia + odtworzenie jazdy i przerw z listy aktywności |
| Plan pod rozładunek | ✅ podajesz godzinę awizacji, RoadPilot dobiera najdłuższy możliwy odpoczynek i najpóźniejszy wyjazd; gdy się nie da — spóźnienie i co pomoże |
| Parking intelligence | ✅ od kiedy szukać parkingu przed pierwszym postojem (wyprzedzenie w ustawieniach) |
| Zapis lokalny | ✅ localStorage, bez serwera i kont |
| PWA | ✅ manifest, ikony, praca offline, przypomnienia — **wymaga HTTPS** (patrz niżej) |
| GPS (V0.4) | ✅ odlicza przejechane km od trasy, dolicza jazdę i przerwy do liczników, opcjonalnie przyjazd z prędkości z ostatnich 10 min |
| Tryb HUD (V0.5) | ✅ widok do jazdy: prędkość, do celu, najbliższy postój, pogoda, przyjazd, jazda — zostało, najbliższa stacja paliw, serwis (data / km z Ustawień), odbicie na szybę |
| Postój „teraz” | ✅ „Zaczynam przerwę” w Planie i w HUD: 15/30/45 min, 9/11 h lub start kilka minut wstecz; odliczanie, co już jest zaliczone; zalicza faktyczny czas (krótszy/dłuższy też), plan liczy od końca postoju; ruszenie z GPS kończy postój samo |

## RoadPilot Core — co liczy silnik

Silnik (`src/core/`) to czyste funkcje TypeScript bez Reacta, zegara systemowego i losowości:
te same dane zawsze dają ten sam plan. Pokrywają go testy (`npm test`).

Uwzględniane zasady (rozporządzenie (WE) 561/2006):

- przerwa 45 min po 4 h 30 min jazdy; przerwa dzielona 15 + 30 min,
- dzienny czas jazdy 9 h, wydłużenie do 10 h maks. 2× w tygodniu (tylko gdy kierowca na to pozwoli),
- odpoczynek dzienny 11 h lub skrócony 9 h (maks. 3× między odpoczynkami tygodniowymi),
- okno dnia pracy: odpoczynek musi się skończyć w ciągu 24 h od poprzedniego (13 h przy 11 h, 15 h przy 9 h),
- 56 h jazdy w tygodniu (pn 00:00 – nd 24:00) i 90 h w dwóch tygodniach — po wyczerpaniu odpoczynek do nowego tygodnia.

**Plan pod rozładunek** (`deadline.ts`): gdy podasz godzinę awizacji i zapas, silnik szuka najpierw najdłuższego
odpoczynku od razu (≥ 11 h, a gdy się nie mieści — skrócony ≥ 9 h), po którym wciąż zdążysz, a gdy odpoczynek się
nie mieści — najpóźniejszej godziny wyjazdu. Jeśli nie da się zdążyć, podaje najwcześniejszy przyjazd, spóźnienie
i najprostszą zmianę (wydłużenie 10 h / skrócony odpoczynek), która by wystarczyła.

Scenariusz wskazywany jako najlepszy = najwcześniejszy przyjazd spośród wykonalnych; przy remisie ten z dłuższym odpoczynkiem.
Silnik nie używa wydłużeń ani skróconych odpoczynków, dopóki kierowca na to nie pozwoli — pokazuje za to w „Co jeśli?”, ile by to dało.

**GPS** (`gps.ts`, w przeglądarce `tracking.ts`): licznik km z kolejnych odczytów pozycji (odczyty o dokładności
gorszej niż 60 m i skoki > 150 km/h są pomijane, „pływanie” pozycji na postoju nie dodaje km). Przejechane km są odejmowane
od początku trasy, więc plan liczy tylko resztę. Jazda (≥ 5 km/h) jest doliczana do liczników dnia/przerwy/tygodnia,
a zakończony postój zaliczany jako przerwa (45 min lub 15 + 30 min) albo odpoczynek dzienny (≥ 9 h).
Gdy aplikacja była zamknięta, dystans z luki = linia prosta × 1,2, a czas jazdy szacowany ze średniej 70 km/h.
Opcja „przyjazd z prędkości z ostatnich 10 min” zastępuje prędkości typów dróg średnią z GPS (min. 5 min danych,
poniżej 10 km/h — postój, korek — wraca do zwykłego wyliczenia). Ręczna zmiana dystansu zeruje licznik.

**Tryb HUD** (`HudView.tsx`, przycisk „HUD” w nagłówku): pełnoekranowy widok do jazdy, poziomo lub pionowo.
Pokazuje prędkość z GPS, godzinę, km do celu, czas do najbliższej przerwy/odpoczynku, pogodę, pasek postępu trasy
z miejscem postoju, przyjazd, pozostały czas jazdy, **najbliższą stację paliw** i **serwis**. Menu: odbicie lustrzane
(na szybę), pełny ekran, wyjście. Ekran nie gaśnie (Wake Lock).

- Najbliższa stacja (`stations.ts`, `nearby.ts`): stacje z OpenStreetMap (Overpass API) w promieniu 25 km, lista
  odświeżana po 10 km; w trakcie jazdy wybierana najbliższa **przed Tobą** (±70° od kierunku jazdy), odległość w linii
  prostej, oznaczenie „TIR” dla stacji z `hgv=yes`. Stacje z `hgv=no` są pomijane.
- Pogoda: Open-Meteo, odświeżana co 20 min; ostrzeżenie przy ≤ 2 °C, mgle, śniegu, marznących opadach, burzy.
- Serwis (`service.ts`, Ustawienia → Serwis): data i/lub „za ile km”. Kilometry odliczane licznikiem GPS
  (`odoKm`, niezależnym od trasy), ostrzeżenie 14 dni / 1000 km przed terminem.
- Prywatność: dane z internetu są pobierane tylko przy otwartym HUD i włączonym GPS, a pozycja wysyłana
  do serwisów jest zaokrąglona do ~1 km. Bez sieci HUD działa dalej, bez stacji i pogody.

**Czego silnik świadomie nie liczy (jeszcze):** odpoczynku tygodniowego po 6 okresach 24 h, zasad czasu pracy
z dyrektywy 2002/15 (np. praca w nocy), promów/pociągów, jazdy w załodze, lokalnych zakazów ruchu ciężarówek.

## Struktura projektu

```text
RoadPilot/
├── README.md, PROJECT_SCOPE.md
├── index.html, vite.config.ts, tsconfig.json, package.json
├── public/
│   ├── manifest.webmanifest, sw.js      # PWA: instalacja i offline
│   └── icon*.svg / icon*.png            # ikony aplikacji
└── src/
    ├── core/                # RoadPilot Core — deterministyczny silnik
    │   ├── rules.ts         # limity z przepisów (jedyne miejsce)
    │   ├── route.ts         # odcinki trasy, prędkości, profile tras
    │   ├── plan.ts          # symulacja: jazda, przerwy, odpoczynki, parking
    │   ├── scenarios.ts     # porównanie scenariuszy, „Co jeśli?”, stan kierowcy
    │   ├── deadline.ts      # plan pod godzinę rozładunku (awizację)
    │   ├── reconstruct.ts   # spóźniony start: odtworzenie dnia z aktywności
    │   ├── gps.ts           # licznik km z GPS, jazda/postoje, średnia z 10 min, prędkość/kierunek do HUD
    │   ├── stations.ts      # najbliższa stacja paliw (przed nami)
    │   ├── service.ts       # serwis: dni i km do przeglądu
    │   ├── weather.ts       # kody pogody → opis, ikona, ostrzeżenia
    │   └── *.test.ts        # testy silnika
    ├── components/          # ekrany: Plan, Trasa, Tachograf, Ustawienia, HUD
    ├── state.ts             # stan aplikacji i zapis lokalny
    ├── tracking.ts          # śledzenie GPS w przeglądarce (watchPosition, blokada wygaszania)
    ├── nearby.ts            # HUD: stacje (Overpass) i pogoda (Open-Meteo) z internetu
    ├── format.ts            # formatowanie godzin i czasów
    ├── App.tsx, main.tsx, styles.css
```

## Uruchomienie

```bash
npm install
npm run dev      # tryb deweloperski
npm test         # testy RoadPilot Core
npm run build    # sprawdzenie typów + build do dist/
```

Na serwerze RoadPilot jest statycznym buildem serwowanym przez **Nginx** z katalogu `/var/www/roadpilot`
pod adresem **https://148-113-237-210.sslip.io/roadpilot/** (Vite `base: "/roadpilot/"`). Po zmianach w kodzie:

```bash
npm run deploy   # build + kopia dist/ do /var/www/roadpilot
```

Nginx (`/etc/nginx/sites-available/projekty`) obsługuje też stronę startową (`/var/www/landing`) oraz grę Veldoria
i jej panel. Certyfikat Let's Encrypt wydaje i odnawia certbot (`certbot.timer`). Stary adres
`roadpilot.148-113-237-210.sslip.io` przekierowuje na nowy i wyrejestrowuje stary service worker.
Przy własnej domenie: dopisz ją w `server_name`, wydaj certyfikat (`certbot certonly --webroot -w /var/www/letsencrypt -d …`)
i przeładuj Nginx (`sudo systemctl reload nginx`).

Pełna PWA (offline, instalacja, powiadomienia, GPS) działa tylko przez HTTPS.

## Status

**v0.5 — działające MVP z GPS i trybem HUD.** Silnik liczy według przepisów opisanych wyżej, ale RoadPilot pozostaje asystentem
planowania: wyniki zawsze trzeba weryfikować z tachografem.
