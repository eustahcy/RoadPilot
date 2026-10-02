// Prędkości ciężarówek z jazdy kierowców RoadPilot (gps_points, za zgodą): siatka komórek ~250 m × kierunek jazdy (8 sektorów)
// → mediana prędkości z przejazdów. Przy trasie: odcinki z wystarczającą liczbą przejazdów dostają zmierzoną prędkość
// (plan przerw i czas przejazdu), reszta zostaje z mapy. Czyste funkcje; budowa tabeli: speed-build.mjs, testy: speeds.test.mjs.

/** Rozmiar komórki w stopniach (~280 m × ~270 m w Polsce). */
const CELL_LAT = 0.0025;
const CELL_LON = 0.004;
/** Komórka liczy się, gdy ma tyle przejazdów od tylu różnych kierowców. */
export const SPEED_MIN = { passes: 5, users: 2 };
/** Odczyty wolniejsze niż tyle km/h to postój / korek przy wjeździe — nie wchodzą do mediany. */
const MOVING_KMH = 5;
/** Krok próbkowania trasy (km). */
const STEP_KM = 0.25;
/** Odcinek trasy dostaje zmierzoną prędkość, gdy dane pokrywają co najmniej tyle jego długości. */
const COVER_MIN = 0.6;

export const cellOf = (lat, lon) => `${Math.floor(lat / CELL_LAT)}:${Math.floor(lon / CELL_LON)}`;
export const dirOf = (heading) => Math.round((((heading % 360) + 360) % 360) / 45) % 8;

const bearing = (a, b) => {
  const kx = Math.cos((a.lat * Math.PI) / 180);
  return ((Math.atan2((b.lon - a.lon) * kx, b.lat - a.lat) * 180) / Math.PI + 360) % 360;
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Odczyty [{ user, t (ms), lat, lon, kmh, heading }] posortowane po kierowcy i czasie → komórki
 * [{ cell, dir, passes, users, kmh }]. Przejazd = kierowca × dzień × komórka × kierunek (jedna wartość: mediana jego odczytów).
 * Brak kierunku z odbiornika — z przesunięcia od poprzedniego odczytu tego kierowcy.
 */
export function buildCells(points) {
  const passes = new Map();
  let prev = null;
  for (const p of points) {
    const same = prev && prev.user === p.user && p.t - prev.t < 120_000;
    const heading = p.heading ?? (same ? bearing(prev, p) : null);
    prev = p;
    if (heading === null || !(p.kmh > MOVING_KMH)) continue;
    const key = `${cellOf(p.lat, p.lon)}|${dirOf(heading)}|${p.user}|${Math.floor(p.t / 86_400_000)}`;
    const list = passes.get(key) ?? [];
    list.push(p.kmh);
    passes.set(key, list);
  }
  const cells = new Map();
  for (const [key, speeds] of passes) {
    const [cell, dir, user] = key.split("|");
    const id = `${cell}|${dir}`;
    const c = cells.get(id) ?? { cell, dir: Number(dir), speeds: [], users: new Set() };
    c.speeds.push(median(speeds));
    c.users.add(user);
    cells.set(id, c);
  }
  return [...cells.values()].map((c) => ({ cell: c.cell, dir: c.dir, passes: c.speeds.length, users: c.users.size, kmh: Math.round(median(c.speeds)) }));
}

/**
 * Trasa aplikacji (points [lat, lon, km], segments [{ type, km }], travelMin) + `lookup(cell, dir)` → komórka albo undefined
 * → odcinki z prędkością z jazdy (`kmh`) tam, gdzie dane pokrywają ≥ COVER_MIN odcinka, nowy czas jazdy i udział trasy z danymi.
 */
export function applySpeeds(route, lookup) {
  const pts = route.points;
  if (!pts?.length || !route.segments?.length || !(route.lengthKm > 0)) return route;
  const baseMinPerKm = route.travelMin / route.lengthKm;
  // Próbki co STEP_KM: prędkość z komórki w kierunku trasy (albo brak).
  const samples = [];
  let j = 0;
  for (let k = STEP_KM / 2; k < route.lengthKm; k += STEP_KM) {
    while (j < pts.length - 2 && pts[j + 1][2] < k) j++;
    const [a, b] = [pts[j], pts[Math.min(pts.length - 1, j + 1)]];
    const f = b[2] > a[2] ? (k - a[2]) / (b[2] - a[2]) : 0;
    const p = { lat: a[0] + f * (b[0] - a[0]), lon: a[1] + f * (b[1] - a[1]) };
    const c = lookup(cellOf(p.lat, p.lon), dirOf(bearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] })));
    samples.push({ km: k, kmh: c && c.passes >= SPEED_MIN.passes && c.users >= SPEED_MIN.users ? c.kmh : undefined });
  }
  let start = 0, minutes = 0, known = 0;
  const segments = route.segments.map((s) => {
    const inSeg = samples.filter((x) => x.km >= start && x.km < start + s.km);
    start += s.km;
    const withData = inSeg.filter((x) => x.kmh !== undefined);
    if (inSeg.length && withData.length / inSeg.length >= COVER_MIN) {
      // Średnia harmoniczna — czas przejazdu odcinka z prędkości na jego kawałkach.
      const kmh = Math.round(withData.length / withData.reduce((sum, x) => sum + 1 / x.kmh, 0));
      minutes += (s.km / kmh) * 60;
      known += s.km;
      return { ...s, kmh };
    }
    minutes += s.km * baseMinPerKm;
    return s;
  });
  if (!known) return route;
  return { ...route, segments, travelMin: Math.round(minutes * 10) / 10, realSpeedShare: Math.round((known / route.lengthKm) * 100) / 100 };
}
