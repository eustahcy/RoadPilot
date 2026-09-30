# RoadPilot — zakres pierwszej wersji

## Główna idea

RoadPilot nie ma być kolejną nawigacją. Jego głównym zadaniem jest porównywanie możliwych scenariuszy dnia kierowcy.

Przykład:

> „Mam 660 km. Mogę ruszyć teraz albo odpocząć 11 godzin. Kiedy dojadę w obu wariantach?”

Silnik ma odpowiedzieć konkretnymi godzinami oraz pokazać, z czego wynikają.

## Najważniejsze moduły

1. **Input trasy**
   - dystans do celu,
   - aktualna godzina,
   - dane o czasie jazdy/pracy,
   - informacje o przerwach i odpoczynku.

2. **Routing**
   - segmentacja trasy,
   - różne prędkości zależne od typu drogi,
   - później integracja z dostawcą map.

3. **RoadPilot Core**
   - deterministyczne obliczenia,
   - generowanie osi czasu,
   - walidacja ograniczeń,
   - porównywanie scenariuszy.

4. **Scenario Engine**
   - jazda od razu,
   - odpoczynek 9 h,
   - odpoczynek 11 h,
   - później kolejne legalne warianty.

5. **Parking intelligence**
   - wyznaczenie momentu, od którego warto szukać parkingu,
   - później integracja z bazą parkingów.

## Czego nie ma w MVP

- bezpośredniego odczytu tachografu,
- backendu,
- kont użytkowników,
- płatności,
- modułu firmowego,
- telematyki,
- AI podejmującego decyzje prawne.

## Kierunek technologiczny

React + TypeScript + Vite + PWA.

Backend zostanie dodany dopiero wtedy, gdy będzie uzasadniony potrzebą synchronizacji, kont, płatności lub integracji z zewnętrznymi usługami.
