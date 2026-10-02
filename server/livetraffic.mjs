// Korki i spowolnienia z jazdy kierowców RoadPilot (gps_points, za zgodą) — bez TomTom. Czyste funkcje; testy: livetraffic.test.mjs.
// Odczyty z ostatnich LIVE.windowMin minut rzutujemy na trasę (blisko i w tym samym kierunku), liczymy medianę prędkości
// w kawałkach po LIVE.binKm i porównujemy z typową prędkością ciężarówki na tym rodzaju drogi. Wolne kawałki sklejamy
// w odcinki z opóźnieniem — aplikacja rysuje je jak korki (żółty / czerwony) i dolicza do przyjazdu.

export const LIVE = {
  windowMin: 20,
  binKm: 0.5,
  /** Odczyt dalej od trasy niż tyle metrów — inna droga (druga jezdnia autostrady leży ~20–40 m obok, więc liczy się też kierunek). */
  nearM: 35,
  headingDeg: 50,
  /** Prędkość / typowa poniżej: korek (czerwony) i spowolnienie (żółty). */
  jamRatio: 0.35,
  slowRatio: 0.7,
  /** Kawałek liczy się od tylu odczytów (jeden kierowca co ~8 s daje kilka w każdym kawałku). */
  minPoints: 2,
  /** Odcinek pokazujemy od tylu minut opóźnienia. */
  minDelayMin: 1,
};

/** Typowa prędkość ciężarówki (km/h) wg rodzaju odcinka trasy — odniesienie, nie limit. */
export const EXPECT_KMH = { motorway: 80, expressway: 76, rural: 62, urban: 35, mixed: 55 };

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Rzut punktu na trasę [lat, lon, km][]: km po trasie, odległość (m) i kierunek odcinka — siatka 0,01° przyspiesza szukanie. */
export function makeLocator(route) {
  const cell = (lat, lon) => `${Math.floor(lat * 100)}:${Math.floor(lon * 100)}`;
  const grid = new Map();
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1], route[i]];
    const keys = new Set([cell(a[0], a[1]), cell(b[0], b[1])]);
    for (const k of keys) (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
  }
  return (lat, lon) => {
    const cand = new Set();
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) for (const i of grid.get(cell(lat + dy / 100, lon + dx / 100)) ?? []) cand.add(i);
    let best = null;
    const k = Math.cos(rad(lat));
    for (const i of cand) {
      const [a, b] = [route[i - 1], route[i]];
      // Lokalnie płasko (metry): x = lon·cos, y = lat.
      const ax = (a[1] - lon) * k, ay = a[0] - lat, bx = (b[1] - lon) * k, by = b[0] - lat;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      const m = Math.hypot(px, py) * rad(1) * R;
      if (!best || m < best.offM) best = { km: a[2] + t * (b[2] - a[2]), offM: m, heading: bearing(a, b) };
    }
    return best;
  };
}

/** Rodzaj odcinka trasy w km `km` (segments: { type, km }[] od startu). */
function typeAt(segments, km) {
  let at = 0;
  for (const s of segments) {
    at += s.km;
    if (km <= at) return s.type;
  }
  return segments.at(-1)?.type ?? "mixed";
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Odcinki z korkiem / spowolnieniem na trasie. `rows`: { lat, lon, kmh, heading }[] z ostatnich minut,
 * `segments`: rodzaje dróg trasy (od jej startu). Wynik w formacie TrafficSection aplikacji (km = km tej trasy).
 */
export function liveSections(route, segments, rows) {
  if (route.length < 2) return [];
  const locate = makeLocator(route);
  const bins = new Map();
  for (const r of rows) {
    if (r.kmh === null || r.kmh === undefined || !Number.isFinite(r.kmh)) continue;
    const p = locate(r.lat, r.lon);
    if (!p || p.offM > LIVE.nearM) continue;
    // Bez kierunku (postój, słaby GPS) — tylko bardzo blisko osi trasy.
    if (r.heading !== null && r.heading !== undefined ? angleDiff(r.heading, p.heading) > LIVE.headingDeg : p.offM > LIVE.nearM / 2) continue;
    const b = Math.floor(p.km / LIVE.binKm);
    (bins.get(b) ?? bins.set(b, []).get(b)).push(r.kmh);
  }
  const slow = [];
  for (const [b, speeds] of [...bins].sort((x, y) => x[0] - y[0])) {
    if (speeds.length < LIVE.minPoints) continue;
    const km = b * LIVE.binKm;
    const expect = EXPECT_KMH[typeAt(segments, km + LIVE.binKm / 2)] ?? 55;
    const kmh = median(speeds);
    const ratio = kmh / expect;
    if (ratio >= LIVE.slowRatio) continue;
    const delayMin = (LIVE.binKm / Math.max(4, kmh) - LIVE.binKm / expect) * 60;
    slow.push({ km, toKm: km + LIVE.binKm, kmh, delayMin, jam: ratio < LIVE.jamRatio });
  }
  // Sklejanie sąsiednich wolnych kawałków (przerwa do jednego kawałka — brak odczytów w środku korka).
  const out = [];
  for (const s of slow) {
    const last = out.at(-1);
    if (last && s.km - last.toKm <= LIVE.binKm + 1e-9) {
      last.toKm = s.toKm;
      last.delayMin += s.delayMin;
      last.speeds.push(s.kmh);
      last.jam ||= s.jam;
    } else out.push({ ...s, speeds: [s.kmh] });
  }
  return out
    .filter((s) => s.delayMin >= LIVE.minDelayMin)
    .map((s) => ({
      km: Math.round(s.km * 100) / 100,
      toKm: Math.round(Math.min(s.toKm, route.at(-1)[2]) * 100) / 100,
      delayMin: Math.round(s.delayMin * 10) / 10,
      level: s.jam ? 3 : 2,
      cause: "jam",
      kmh: Math.round(median(s.speeds)),
      live: true,
    }));
}
