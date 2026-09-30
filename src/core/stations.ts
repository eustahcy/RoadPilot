// Najbliższa stacja paliw — z listy stacji (OpenStreetMap / Overpass) i bieżącej pozycji.
// Czyste funkcje: pobieranie danych jest w src/nearby.ts.

import { bearingDeg, distanceM } from "./gps";

export interface Station {
  id: string;
  lat: number;
  lon: number;
  name: string;
  /** Oznaczona jako dostępna dla ciężarówek (hgv=yes / olej napędowy HGV). */
  truck: boolean;
}

export interface NearestStation {
  station: Station;
  /** W linii prostej. */
  km: number;
  /** Przed nami (w kierunku jazdy) — null, gdy kierunek nieznany. */
  ahead: boolean | null;
}

export const STATIONS = {
  /** Promień wyszukiwania (m). */
  radiusM: 25_000,
  /** Po takim przesunięciu od miejsca zapytania (m) pobieramy listę od nowa. */
  refetchM: 10_000,
  /** Stacja „przed nami”, gdy odchylenie od kierunku jazdy jest nie większe niż tyle stopni. */
  aheadDeg: 70,
} as const;

/** Odpowiedź Overpass API (`out center tags`) → lista stacji. Pomija stacje zamknięte dla ciężarówek. */
export function parseOverpass(json: unknown): Station[] {
  const elements = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: Station[] = [];
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const tags = e.tags ?? {};
    if (typeof lat !== "number" || typeof lon !== "number" || tags.hgv === "no") continue;
    out.push({
      id: `${e.type}/${e.id}`,
      lat,
      lon,
      name: tags.brand || tags.name || tags.operator || "Stacja paliw",
      truck: tags.hgv === "yes" || tags.hgv === "designated" || tags["fuel:HGV_diesel"] === "yes",
    });
  }
  return out;
}

/** Najbliższa stacja — gdy znamy kierunek jazdy, najpierw spośród tych przed nami. */
export function nearestStation(stations: Station[], pos: { lat: number; lon: number }, heading: number | null): NearestStation | undefined {
  let best: NearestStation | undefined;
  let bestAhead: NearestStation | undefined;
  for (const s of stations) {
    const km = distanceM(pos, s) / 1000;
    const ahead = heading === null ? null : angleDiff(bearingDeg(pos, s), heading) <= STATIONS.aheadDeg;
    const n = { station: s, km, ahead };
    if (!best || km < best.km) best = n;
    if (ahead && (!bestAhead || km < bestAhead.km)) bestAhead = n;
  }
  return bestAhead ?? best;
}

function angleDiff(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
