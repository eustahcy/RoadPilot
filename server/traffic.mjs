// Korki na dowolnej trasie (także z własnego silnika): zdarzenia TomTom Traffic (incidentDetails) w prostokątach
// wzdłuż trasy, nałożone na km trasy. Czyste funkcje (testy w traffic.test.mjs); zapytania do TomTom są w index.mjs.

import { nearest, routeBoxes } from "./warnings.mjs";

/** TomTom przyjmuje prostokąt najwyżej 10 000 km² — trzymamy zapas. */
const MAX_BOX_KM2 = 9_000;
/** Zdarzenie leży na trasie, gdy jego początek, środek i koniec są bliżej niż tyle metrów. */
const ON_ROUTE_M = 50;

/** Kategorie TomTom (iconCategory), które pokazujemy: wypadek, korek, zwężenie, zamknięcie, roboty, zepsuty pojazd. */
export const TRAFFIC_CATEGORIES = [1, 6, 7, 8, 9, 14];

const areaKm2 = (b) => (b.maxLat - b.minLat) * 111.32 * (b.maxLon - b.minLon) * 111.32 * Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);

/** Prostokąty wzdłuż trasy do zapytań incidentDetails: kawałki po ~25 km sklejane, dopóki mieszczą się w limicie pola. */
export function trafficBoxes(route) {
  const out = [];
  for (const b of routeBoxes(route, 25, 0.005)) {
    const last = out[out.length - 1];
    const merged = last && { ...last, to: b.to, minLat: Math.min(last.minLat, b.minLat), maxLat: Math.max(last.maxLat, b.maxLat), minLon: Math.min(last.minLon, b.minLon), maxLon: Math.max(last.maxLon, b.maxLon) };
    if (merged && areaKm2(merged) <= MAX_BOX_KM2) out[out.length - 1] = merged;
    else out.push(b);
  }
  return out;
}

/** bbox do URL TomTom: minLon,minLat,maxLon,maxLat. */
export const bboxParam = (b) => [b.minLon, b.minLat, b.maxLon, b.maxLat].map((x) => x.toFixed(4)).join(",");

const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

/**
 * Zdarzenia TomTom → utrudnienia na trasie ({ km, toKm, delayMin, level, cause } jak w parseRoute), posortowane.
 * Bierzemy tylko zdarzenia biegnące wzdłuż trasy w naszym kierunku — korek na drugiej jezdni autostrady ma
 * koniec przed początkiem (km maleje), a droga obok / przecinająca nie trzyma się trasy.
 */
export function incidentSections(route, incidents) {
  const out = [];
  const seen = new Set();
  for (const inc of incidents ?? []) {
    const p = inc?.properties ?? {};
    const coords = inc?.geometry?.type === "LineString" ? inc.geometry.coordinates : null;
    if (!coords || coords.length < 2 || !TRAFFIC_CATEGORIES.includes(p.iconCategory)) continue;
    if (p.id && seen.has(p.id)) continue;
    const [a, m, z] = [coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]].map(([lon, lat]) => nearest(route, lat, lon));
    if (a.d > ON_ROUTE_M || m.d > ON_ROUTE_M || z.d > ON_ROUTE_M) continue;
    const lengthKm = Number.isFinite(p.length) ? p.length / 1000 : 0;
    // Zgodny kierunek i zasięg: koniec dalej niż początek, o co najmniej połowę długości zdarzenia.
    if (z.km <= a.km || z.km - a.km < lengthKm * 0.5) continue;
    if (p.id) seen.add(p.id);
    const cause = p.iconCategory === 8 ? "closed" : p.iconCategory === 9 ? "roadwork" : "jam";
    out.push({
      km: round(a.km, 3),
      toKm: round(z.km, 3),
      delayMin: round((Number.isFinite(p.delay) ? p.delay : 0) / 60, 1),
      // magnitudeOfDelay: 1 małe, 2 średnie, 3 duże, 4 = nieokreślone (zamknięcia); 0 = nieznane → małe.
      level: cause === "closed" ? 4 : p.magnitudeOfDelay >= 1 && p.magnitudeOfDelay <= 3 ? p.magnitudeOfDelay : 1,
      cause,
    });
  }
  return out.sort((x, y) => x.km - y.km);
}
