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
| Spóźniony start | ✅ rzeczywisty początek dnia + odtworzenie dnia z aktywności z godzinami od–do (jazda, przerwa, inna praca); niewpisany czas między nimi = postój |
| Plan pod rozładunek | ✅ podajesz godzinę awizacji, RoadPilot dobiera najdłuższy możliwy odpoczynek i najpóźniejszy wyjazd; gdy się nie da — spóźnienie i co pomoże |
| Parking intelligence | ✅ od kiedy szukać parkingu przed pierwszym postojem (wyprzedzenie w ustawieniach) |
| Zapis lokalny | ✅ localStorage, bez serwera i kont |
| PWA | ✅ manifest, ikony, praca offline, przypomnienia — **wymaga HTTPS** (patrz niżej) |
| GPS (V0.4) | ✅ odlicza przejechane km od trasy, dolicza jazdę i przerwy do liczników, opcjonalnie przyjazd z prędkości z ostatnich 10 min |
| Tryb HUD (V0.5) | ✅ widok do jazdy: prędkość, do celu, najbliższy postój, pogoda, przyjazd, jazda — zostało, najbliższa stacja paliw, najbliższy parking/MOP (OpenStreetMap), przycisk Zakończ/Rozpocznij dzień, odbicie na szybę; serwis (data / km z Ustawień) — ostrzeżenie w Planie |
| Postój „teraz” | ✅ „Zaczynam przerwę” w Planie i w HUD: 15/30/45 min, 9/11 h „Bez limitu” (załadunek, nocleg — trwa do ruszenia powyżej 5 km/h) lub start kilka minut wstecz; odliczanie, co już jest zaliczone; zalicza faktyczny czas (krótszy/dłuższy też), plan liczy od końca postoju; ruszenie z GPS kończy postój samo |
| Wybór scenariusza | ✅ „Wybieram” przy każdym scenariuszu — kierowca może np. jechać teraz mimo zalecenia odpoczynku; następna czynność, HUD, przypomnienia i parking liczą się wtedy z wybranego planu („Wróć do zalecenia RoadPilot”) |
| Stałe powiadomienie | ✅ karta jak w odtwarzaczu muzyki (cicha pętla audio + Media Session): następna czynność i przyjazd w zasłonie i na ekranie blokady, aplikacja nie jest usypiana w tle; „Pauza” wyłącza. Nie przetrwa zamknięcia z listy ostatnich (PWA nie ma usługi w tle) |
| Postój automatyczny | ✅ przy GPS: po 5 s z prędkością 0–5 km/h postój bez limitu włącza się sam od chwili zatrzymania, po ruszeniu kończy; uzbraja się dopiero po jeździe (wyłączany w Ustawieniach) |
| Historia dzienna | ✅ osobna zakładka Historia: dzień po dniu — rozpoczęcie, zakończenie, jazda, przerwy (lista postojów ≥ 2 min), km, średnia prędkość; luki (aplikacja zamknięta) z oszacowaną jazdą; 31 dni |
| Klucze Premium | ✅ administrator generuje jednorazowy klucz (7 / 30 / 90 / 365 dni, dowolna liczba dni albo bez terminu, z notatką) i wysyła go z aplikacji; kierowca wpisuje go w Ustawienia → Konto → „Mam klucz Premium”, dni dokładają się do trwającego Premium; lista kluczy z informacją, kto i kiedy użył |
| Przekroczenia w historii | ✅ jazda bez przerwy, dzienna, tygodniowa, 2-tygodniowa, okres 24 h, za krótki odpoczynek — na czerwono z godziną i miejscem (miejscowość, droga, MOP / stacja), notatka na odwrót wydruku z tachografu (art. 12) z powodem do wyboru |
| Konta (v0.6) | ✅ rejestracja i logowanie (e-mail + hasło), reset hasła e-mailem (link ważny 1 h), synchronizacja danych z kontem w MariaDB (trasa, tachograf, ustawienia, historia), praca offline, wylogowanie, usunięcie konta; można dalej używać bez konta |
| Dzień pracy | ✅ „Zakończ dzień” (Plan i HUD) zaczyna odpoczynek dzienny liczony faktycznym czasem; „Rozpocznij dzień” go kończy i zeruje liczniki dnia (ostrzeżenie, gdy odpoczynek < 9 h); ruszenie z GPS też kończy odpoczynek |
| Czas pracy | ✅ od początku dnia, nie zatrzymuje się w przerwach; limit domyślnie 13 h (zmiana w Ustawieniach), wydłużenie do 15 h (wyłączalne), przypomnienia X min przed końcem i na koniec; widoczny w Planie i HUD |
| HUD: nowy układ | ✅ oś trasy Start → Cel ze znacznikami, Pokonano / Pozostało / przyjazd z postojami, kafelki czasu jazdy, przerwy i pracy z paskami, „Lepszy scenariusz” (`betterOption`), MOP / serwis (bez paliwa); pole „Start” w Trasie |
| HUD: skróty do aplikacji | ✅ w Ustawieniach → Tryb HUD wybór nawigacji (Google Maps / Waze / AutoMapa / TomTom GO Expert / Sygic Truck / iGO / Apple Mapy / Inna — systemowy wybór na Androidzie lub własny link) i muzyki (Spotify / YouTube / YouTube Music); przyciski w HUD otwierają aplikację, nawigację od razu do celu z Trasy (`core/apps.ts`, `launch.ts`) — bez sterowania, tylko skrót |
| Dodaj do ekranu głównego | ✅ przycisk ⊞ w nagłówku (znika po instalacji): Android — systemowe okno instalacji (`beforeinstallprompt`), iPhone — instrukcja Safari „Udostępnij → Do ekranu początkowego” (`install.ts`, `InstallButton.tsx`) |
| Ustawienia w kategoriach | ✅ Konto, Planowanie, Czas pracy, Serwis, GPS, HUD, Muzyka, Dane — lista kategorii, w każdej jej karty |
| HUD: styl i elementy | ✅ styl zwykły (kafelki) lub minimalistyczny (duża prędkość, liczby bez ramek); każdy styl ma własny zestaw widocznych elementów (`hudConfig.ts`, Ustawienia → HUD, przełącznik stylu w menu HUD) |
| Pływające okienko (eksperyment) | ✅ obraz w obrazie z `<canvas>` → wideo (`floating.ts`): prędkość, przyjazd, na zmianę czas do przerwy / odpoczynku / koniec pracy; przycisk „Okienko” w HUD. W tle system może zatrzymać odświeżanie (iPhone prawie zawsze) — nieaktualna prędkość = „—” |
| Nawigacja dla ciężarówek (beta, etap 1) | ✅ Ustawienia → Pojazd i nawigacja (wymiary, masa, osie, ADR, v max); Trasa: wyszukiwanie celu i trasa TomTom dla ciężarówki przez RoadPilot API; odcinki autostrada / miasto / poza miastem zasilają silnik przerw; manewry, pasy i ograniczenia zapisane lokalnie pod HUD (etap 2) |
| Premium i administracja | ✅ `users.role` (admin) i `users.premium_until`; nawigacja tylko z Premium (sprawdzane na serwerze); Premium na razie nie do kupienia — admin nadaje je w Ustawieniach → Administracja (30 dni / rok / bez terminu / odbierz) |
| Nawigacja — osobny ekran | ✅ zakładka „Nawigacja” w menu (osobny system, niezależny od HUD): mapa w perspektywie (WebGL), następny manewr z odległością (zjazd, drogowskaz, „następnie”), pasy ruchu, znak ograniczenia prędkości, ostrzeżenia, komunikaty głosowe, wyszukiwanie celu i trasy alternatywne, znajomi, zgłoszenia; poza trasą — automatyczne wyznaczenie od bieżącej pozycji; bez trasy w urządzeniu, a z celem na koncie — trasa wyznacza się sama. HUD zostaje tablicą do jazdy (bez panelu nawigacji) |
| Limity TomTom | ✅ licznik zapytań w bazie (`api_usage`), serwer przestaje pytać TomTom przy 80% limitu miesięcznego (lub dziennego: `TOMTOM_PERIOD=day`); dzienny limit na konto, pamięć wyszukiwań 10 min, podpowiedzi od 3 znaków; podgląd w Administracji |
| Korki na żywo | ⏸ wyłączone od 2026-10-01 (licencja i limity TomTom; `TRAFFIC_ON` w `src/nav.ts` + `TRAFFIC_ENABLED=1` na serwerze włączają je z powrotem). Wcześniej: Nawigacja (oba silniki): co 5 min korki, roboty, zwężenia, wypadki i zamknięcia na ~150 km trasy przed nami (TomTom Traffic incidentDetails przez `POST /api/nav/traffic`, tylko zdarzenia wzdłuż trasy w naszym kierunku — druga jezdnia odpada); na mapie żółty / czerwony, na karcie najbliższe utrudnienie (do 8 km każde, do 100 km korek / zamknięcie / ≥ 5 min), „Korki teraz” w Trasie. Własny silnik dostaje korki od razu po wyznaczeniu trasy |
| Znajomi | ✅ zaproszenie po e-mailu konta, widoczność dopiero po akceptacji drugiej strony; karta „Kto gdzie jedzie” na Planie (odległość od Ciebie, jedzie / stoi / przerwa / odpoczynek, od kiedy i ile z planu, prędkość, cel z przyjazdem, ile zostało jazdy), kafelek „Najbliższy znajomy” w HUD i znaczniki na mapie (styl Nawigacja); Ustawienia → Znajomi: zaproszenia, usuwanie, dla każdego znajomego status (jedzie / stoi / pauza i od kiedy, prędkość, cel, od kiedy sygnał) i „Gdzie jest” — mapa z pozycją (Premium) albo link do aplikacji map; przełącznik „Udostępniaj moją pozycję” (wysyłka co 20 s tylko przy GPS; wyłączenie kasuje dane na serwerze). Z trasą z nawigacji odległości po trasie („przed / za Tobą”), inaczej w linii prostej |
| HUD: prędkość a limit | ✅ prędkość na zielono do limitu z trasy (i ogranicznika pojazdu, gdy niższy), żółto do +5 km/h, czerwono wyżej; ograniczenie nie znika w lukach danych TomTom (ostatnie znane trzymane do 3 km) |
| Własna mapa (styl RoadPilot) | ✅ kafelki wektorowe z OpenStreetMap budowane na serwerze (`scripts/tiles-build.sh`, tilemaker) i rysowane w WebGL własnym stylem: dzień (jasne tło, szare drogi) / noc / automatycznie (Ustawienia → HUD); drogi z zakazem dla zestawu czerwono-białe (zakaz HGV) albo czerwone z białymi kreskami (masa, wysokość, oś, szerokość, długość); nazwy miejscowości, numery dróg i nazwy ulic wzdłuż drogi (od zoomu 15, bez nachodzenia); tylko Polska — poza nią kafelki TomTom. Bez limitu TomTom na mapę |
| Rodzaj trasy | ✅ Ustawienia → Pojazd i nawigacja: najszybsza / najkrótsza / ekonomiczna — TomTom `routeType`, własny silnik `shortest` (eco = najszybsza); własny silnik zawsze z `use_truck_route` — trzyma się autostrad i tras dla ciężarówek zamiast ścinać przez wojewódzkie |
| Mapa: przesuwanie i zoom | ✅ Nawigacja: przeciągnięcie / szczypanie przechodzi w przeglądanie (widok z góry, strzałka „my” jako znacznik), +/− oddala do całej Polski, przycisk „Wróć do mojej pozycji” (w jeździe sam po 20 s bez dotykania); w prowadzeniu +/− od zoomu 10. Porównanie tras: przeciąganie, szczypanie, kółko, +/− i „Cała trasa” |
| Pinezki na trasie | ✅ mapa Nawigacji: parking / MOP (niebieskie „P”, MOP ze stacją z pomarańczową kropką), stacja paliw, fotoradar, początek odcinkowego pomiaru i przekreślony koniec; w prowadzeniu 20 km przed nami, przy przeglądaniu cała trasa (rozrzedzane wg zoomu, najpierw fotoradary). Miejsca z OSM (`osm_pois`: stacje ≤150 m, MOP-y / parkingi TIR ≤250 m od trasy), na autostradzie / ekspresówce bez tych po lewej (przeciwny kierunek); przychodzą razem z ostrzeżeniami (`POST /api/nav/warnings` → `pois`) |
| Pinezka → informacja, punkty pośrednie | ✅ dotknięcie pinezki: karta nad dolnym paskiem — co to jest (stacja / MOP / parking / fotoradar / odcinek z długością), nazwa, „za X km · ok. Y min” (średnia prędkość trasy), strona drogi i odległość od niej; stację / MOP / parking można dodać do trasy („Jedź przez to miejsce”). Przytrzymanie mapy 0,6 s (także pochylonej — odwrócony rzut kamery) → „Jedź przez ten punkt”. Do 5 punktów pośrednich (fioletowe pinezki z numerem, dotknięcie → „Usuń z trasy”), w kolejności przejazdu; ponowne wyznaczenie trasy zachowuje nieprzejechane. Serwer: `via` w `POST /api/nav/route` (TomTom — punkty w ścieżce, Valhalla — `type: through`; bez alternatyw) |
| Odcinkowy pomiar i limit dla ciężarówki | ✅ Nawigacja: znak z limitem dla pojazdu > 3,5 t — obszar zabudowany 50, poza nim 70, autostrada / ekspresowa 80 km/h; wyższy znak (np. 70 w mieście) nie podnosi limitu, niższy obowiązuje; kolor prędkości wg tego limitu. Odcinkowy pomiar: zapowiedź od 3 km (od 500 m pulsuje), w trakcie pasek postępu z bramkami, średnia od wjazdu (zielona / żółta / czerwona) i „do końca X km”, przy za wysokiej średniej podpowiedź „do końca jedź najwyżej N km/h”; po wyjeździe podsumowanie ze średnią; głos: początek z limitem i koniec ze średnią. Własny silnik: znaki i klasa drogi z Valhalli (`trace_attributes`), obszar zabudowany z tagów OSM `PL:urban` / `PL:rural` (`zones.tsv` z `osm-update.sh`, luki do 3 km między odcinkami zabudowanymi = nadal miasto); TomTom: sekcje URBAN / MOTORWAY |
| Parking przy celu | ✅ w Trasie, przy wybranym celu nawigacji: opinie kierowców dla miejsc do 300 m od celu — „jest parking” / „ograniczony” / „brak” + komentarz; inni potwierdzają 👍 / 👎 (opinia z przewagą 👎 wypada z podsumowania); jedna opinia na kierowcę przy celu (zmiana zeruje głosy), limit 30 dziennie, admin może usuwać. API: `GET/POST/DELETE /api/parking`, `POST /api/parking/vote` |
| Pro tip: wydruk z tachografu | ✅ karta na Planie z formułkami na odwrót wydruku do skopiowania: art. 12 rozp. 561/2006 (dojazd do miejsca postoju, +1 h / +2 h do bazy lub domu na odpoczynek tygodniowy), art. 35 i 37 rozp. 165/2014 (uszkodzona / zgubiona karta, awaria tachografu) oraz zasady opisywania wydruków |
| Mapa RoadPilot (zbieranie danych) | ✅ za zgodą (prośba na Planie, Ustawienia → Dane): ślad przejazdu w Polsce i zgłoszenia z HUD (wiadukt, tonaż, prędkość, zakaz, zamknięcie, parking); „Usuń moje dane z mapy” kasuje wszystko i cofa zgodę |
| Mapa TomTom w HUD | ✅ styl Nawigacja na prawdziwej mapie (kafelki TomTom, styl nocny) — obrót wg kierunku jazdy, pochylenie jak w nawigacji, trasa, punkt manewru, zielona strzałka; kafelki przez serwer (klucz ukryty, w budżecie 80%, pamięć 24 h, 1500/dzień na konto) |
| OSM Polska + podgląd | ✅ `scripts/osm-update.sh`: ~219 tys. ograniczeń dla ciężarówek z OpenStreetMap (wysokość, masa, nacisk osi, szerokość, długość, zakazy, prędkość TIR) w tabeli `osm_restrictions`; Administracja → mapa danych z warstwami OSM, zgłoszeniami i śladami |
| Ostrzeżenia na trasie | ✅ z naszych danych (OSM + zgłoszenia): wiadukty, masa, nacisk osi, szerokość, długość, zakazy, zamknięcia — tylko te, których pojazd nie spełnia; lista w Trasie, w HUD od 3 km przed miejscem (pulsuje od 500 m) |
| Zgłoszenia vs OSM | ✅ Administracja: każde zgłoszenie porównane z OSM (brak w OSM / inna wartość / zgodne), potwierdzenia od kilku kierowców, stuknięcie pokazuje miejsce na mapie |
| Dom, ulubione, ostatnie trasy | ✅ pod pustą wyszukiwarką celu (Nawigacja → „Cel i trasy” oraz Trasa): przycisk Dom, lista ulubionych i ostatnich tras (data, km, czas jazdy) — dotknięcie wybiera cel bez szukania w TomTom; przy wybranym celu „Do ulubionych” / „Ustaw jako dom”, × usuwa; z kontem synchronizowane z ustawieniami (`core/places.ts`, `SavedPlaces.tsx`) |
| Silnik RoadPilot (beta) | ✅ Valhalla na OSM Polska na naszym serwerze — jedyny silnik tras (wybór TomTom usunięty 2026-10-01); TomTom tylko awaryjnie po stronie serwera: punkt poza Polską albo Valhalla nie wyznaczy trasy |
| Nawigacja — wygląd | ✅ wg projektu: mapa na cały ekran, karta manewru (zielona strzałka, odległość, ulica, pasy, ostrzeżenie), przyciski: głos 🔊, lista ograniczeń ⚠, +/−; prędkość, znak ograniczenia; karta Do celu / Przyjazd / Postój-przerwa / Trasa (A1 · S7 …); rząd: Zgłoś, Okienko, nawigacja, muzyka; komunikaty głosowe po polsku |
| Silnik RoadPilot: omijanie ograniczeń | ✅ trasa sprawdzana naszą bazą (OSM + zgłoszenia); przy konflikcie z pojazdem (oś, masa, wysokość, szerokość, długość, zakaz) liczona od nowa z wykluczonym miejscem; mniej fałszywych ostrzeżeń na węzłach i skrzyżowaniach |
| HUD: droga | ✅ animowane pasy ruchu po bokach prędkości (tempo zależy od prędkości, wyłączane w menu HUD i Ustawieniach), średnia prędkość dzisiejszej jazdy, nazwa/numer drogi i miejscowość z OpenStreetMap (dopasowanie do drogi liczone w telefonie) |

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
Gdy aplikacja była zamknięta (luka w odczytach ≥ 2 min): z kontem serwer liczy drogę ciężarówki z ostatniej pozycji do obecnej
(Valhalla, Polska) i czas jej przejazdu; bez konta, poza Polską albo gdy droga nie mieści się w czasie luki — linia prosta × 1,2
przy 70 km/h. Reszta luki to postój zaliczany jak każdy inny (przerwa, odpoczynek): jeśli staliśmy przed luką albo teraz jedziemy —
postój był na początku, jeśli jechaliśmy i teraz stoimy — postój trwa do teraz. Luka trafia do Historii jako „oszacowano”.

**Przekroczenia** (`violations.ts`): przy każdej jeździe z GPS — jazda bez przerwy > 4,5 h, dzienna > 9 h (10 h, póki są wydłużenia),
tygodniowa > 56 h, w 2 tygodniach > 90 h, jazda po 13 h / 15 h od początku dnia (okres 24 h) i za krótki odpoczynek dzienny. Zapis
z chwilą i pozycją przekroczenia, „o ile” rośnie do przerwy / odpoczynku. W Historii na czerwono; po dotknięciu: miejscowość, droga
i MOP / stacja (serwer: `osm_places` + Valhalla `/locate` + `osm_pois`), wiersze jak na wydruku i notatka na odwrót wydruku (art. 12)
z wybranym powodem — do skopiowania.
Opcja „przyjazd z prędkości z ostatnich 10 min” zastępuje prędkości typów dróg średnią z GPS (min. 5 min danych,
poniżej 10 km/h — postój, korek — wraca do zwykłego wyliczenia). Ręczna zmiana dystansu zeruje licznik.

**Tryb HUD** (`HudView.tsx`, przycisk „HUD” w nagłówku): pełnoekranowy widok do jazdy, poziomo lub pionowo.
Układ (v0.6.1): u góry godzina z datą, km do celu, prędkość, średnia dzisiejsza, pogoda i menu; pod nimi **oś trasy**
Start → Cel (przejechana część, ciężarówka z % trasy, znaczniki postojów z planu, MOP-u i serwisu); wiersz
**Pokonano / Pozostało / Szacowany czas dojazdu** (przyjazd z planu — z przerwami i odpoczynkami); kafelki **Czas jazdy
dziś** (x / 9 h), **Następna przerwa** (z segmentami ciągłej jazdy po 30 min, dotknięcie otwiera postój) i **Czas pracy**
(x / 13 h lub 15 h); na dole **Lepszy scenariusz** (tylko gdy inny start lub opcja z „Co jeśli?” daje przyjazd ≥ 15 min
wcześniej — dotknięcie przełącza plan po potwierdzeniu; nie przy planie pod rozładunek), najbliższy MOP i serwis.
Stacje paliw usunięte z HUD na prośbę użytkownika (v0.6.1) — nie są już pobierane.
Wszystkie odległości na osi i w kafelkach liczone od bieżącej pozycji („za 92 km”). Menu: odbicie lustrzane (na szybę),
animacja drogi, postój, Zakończ/Rozpocznij dzień, pełny ekran, wyjście. Ekran nie gaśnie (Wake Lock).

- Najbliższy MOP / parking TIR (`stations.ts`, `nearby.ts`): z OpenStreetMap (Overpass API) w promieniu 25 km, lista
  odświeżana po 10 km; w trakcie jazdy wybierany najbliższy **przed Tobą** (±70° od kierunku jazdy), odległość w linii
  prostej. (`parseOverpass` dla stacji paliw zostało w silniku z testami, ale HUD go już nie używa.)
- Pogoda: Open-Meteo, odświeżana co 20 min; ostrzeżenie przy ≤ 2 °C, mgle, śniegu, marznących opadach, burzy.
- Serwis (`service.ts`, Ustawienia → Serwis): data i/lub „za ile km”. Kilometry odliczane licznikiem GPS
  (`odoKm`, niezależnym od trasy), ostrzeżenie 14 dni / 1000 km przed terminem.
- Prywatność: dane z internetu są pobierane tylko przy otwartym HUD i włączonym GPS, a pozycja wysyłana
  do serwisów jest zaokrąglona do ~1 km. Bez sieci HUD działa dalej, bez parkingów i pogody.

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
    ├── api.ts, sync.ts      # konto: zapytania do API, synchronizacja stanu (ostatni zapis wygrywa)
    ├── App.tsx, main.tsx, styles.css
server/                      # RoadPilot API (Node, bez frameworka + mysql2)
├── index.mjs                # rejestracja, logowanie, sesje, zapis/odczyt stanu, usunięcie konta
└── schema.sql               # tabele users, sessions, user_state (tworzone przy starcie)
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

**API kont** (`server/`) działa jako usługa `roadpilot-api.service` (Node, 127.0.0.1:7781), Nginx przekazuje
`/roadpilot/api/` → `/api/`. Baza `roadpilot` w MariaDB na hoście, połączenie przez gniazdo `/run/mysqld/mysqld.sock`,
dane logowania w `/etc/roadpilot-api.env`. Hasła: scrypt z solą; w bazie tylko skróty SHA-256 tokenów sesji;
limit prób logowania (10 / 15 min na IP i e-mail). Po zmianach w `server/`:

```bash
cd server && npm install --omit=dev   # tylko przy zmianie zależności
sudo systemctl restart roadpilot-api
curl -s https://148-113-237-210.sslip.io/roadpilot/api/health
```

W trybie `npm run dev` / `vite preview` zapytania `/roadpilot/api` idą do lokalnego API (proxy w `vite.config.ts`).

**E-maile** (reset hasła) wysyła API przez SMTP simply.com (`smtp.simply.com:587`, dane w `/etc/roadpilot-api.env`).
`websmtp.simply.com` działa tylko z serwerów WWW simply.com, a nadawca musi być adresem z domeny tuike.pl.

**Drugi hosting — tuike.pl** (simply.com, Apache): `npm run deploy:tuike` buduje front z `VITE_API_URL` (API na VPS)
i wysyła go przez FTPS do `/public_html/roadpilot/` → https://tuike.pl/roadpilot/. Dane FTP są w
`~/.config/roadpilot/ftp.env` (poza repozytorium). API przepuszcza zapytania z adresów w `APP_ORIGINS` (CORS).
Cache i typ manifestu ustawia `public/.htaccess`. Główny `/public_html/.htaccess` przekierowuje sam adres tuike.pl na `/roadpilot/` (302); reszta hostingu (Fleetra, Impostor) bez zmian. Wymaga włączonego certyfikatu SSL dla tuike.pl w panelu simply.com.

## Status

**v0.5 — działające MVP z GPS i trybem HUD.** Silnik liczy według przepisów opisanych wyżej, ale RoadPilot pozostaje asystentem
planowania: wyniki zawsze trzeba weryfikować z tachografem.
