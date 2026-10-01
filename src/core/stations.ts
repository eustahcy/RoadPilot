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

export interface NearestStation<T = Station> {
  station: T;
  /** W linii prostej. */
  km: number;
  /** Przed nami (w kierunku jazdy) — null, gdy kierunek nieznany. */
  ahead: boolean | null;
  /** km liczone po trasie z nawigacji (miejsce leży przy trasie), nie w linii prostej. */
  onRoute?: boolean;
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

/** Parking dla ciężarówek / MOP (OpenStreetMap: highway=rest_area|services, amenity=parking z hgv). */
export interface Parking {
  id: string;
  lat: number;
  lon: number;
  name: string;
  /** mop = miejsce odpoczynku, services = MOP z obsługą (stacja, bar), truck = parking dla ciężarówek. */
  kind: "mop" | "services" | "truck";
}

/** Zapytanie Overpass: MOP-y i parkingi dla ciężarówek w promieniu jak dla stacji. */
export function parkingsQuery(p: { lat: number; lon: number }): string {
  const around = `(around:${STATIONS.radiusM},${p.lat},${p.lon})`;
  return `[out:json][timeout:20];(nwr["highway"~"^(rest_area|services)$"]${around};nwr["amenity"="parking"]["hgv"~"^(yes|designated)$"]${around};);out center tags 300;`;
}

export function parseParkings(json: unknown): Parking[] {
  const elements = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: Parking[] = [];
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const tags = e.tags ?? {};
    if (typeof lat !== "number" || typeof lon !== "number" || tags.hgv === "no" || tags.access === "private") continue;
    const kind = tags.highway === "services" ? "services" : tags.highway === "rest_area" ? "mop" : "truck";
    out.push({ id: `${e.type}/${e.id}`, lat, lon, kind, name: tags.name || (kind === "truck" ? "Parking TIR" : "MOP") });
  }
  return out;
}

/** Najbliższe miejsce — gdy znamy kierunek jazdy, najpierw spośród tych przed nami. */
export function nearestStation<T extends { lat: number; lon: number } = Station>(stations: T[], pos: { lat: number; lon: number }, heading: number | null): NearestStation<T> | undefined {
  let best: NearestStation<T> | undefined;
  let bestAhead: NearestStation<T> | undefined;
  for (const s of stations) {
    const km = distanceM(pos, s) / 1000;
    const ahead = heading === null ? null : angleDiff(bearingDeg(pos, s), heading) <= STATIONS.aheadDeg;
    const n = { station: s, km, ahead };
    if (!best || km < best.km) best = n;
    if (ahead && (!bestAhead || km < bestAhead.km)) bestAhead = n;
  }
  return bestAhead ?? best;
}

/**
 * Miejsca przed nami w linii prostej (bez trasy): do `maxKm`, w stożku ±STATIONS.aheadDeg od kierunku jazdy,
 * od najbliższego. Bez kierunku (stoimy od początku) — wszystkie w promieniu.
 */
export function placesAhead<T extends { lat: number; lon: number }>(list: T[], pos: { lat: number; lon: number }, heading: number | null, maxKm: number): { item: T; km: number }[] {
  const out: { item: T; km: number }[] = [];
  for (const item of list) {
    const km = distanceM(pos, item) / 1000;
    if (km > maxKm) continue;
    if (heading !== null && angleDiff(bearingDeg(pos, item), heading) > STATIONS.aheadDeg) continue;
    out.push({ item, km });
  }
  return out.sort((a, b) => a.km - b.km);
}

function angleDiff(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
