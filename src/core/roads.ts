// Nazwa drogi i miejscowości do HUD — z dróg i miejscowości z OpenStreetMap (Overpass) wokół przybliżonej pozycji.
// Dopasowanie do dokładnej pozycji i kierunku jazdy liczymy lokalnie; pobieranie jest w src/nearby.ts.

import { bearingDeg, distanceM } from "./gps";

type LatLon = { lat: number; lon: number };

export interface Road {
  id: number;
  name?: string;
  ref?: string;
  highway: string;
  geom: LatLon[];
}

export interface Place {
  name: string;
  kind: "city" | "town" | "village";
  lat: number;
  lon: number;
}

export interface RoadData {
  roads: Road[];
  places: Place[];
}

export const ROADS = {
  /** Promień pobierania dróg wokół przybliżonej pozycji (m) — pokrywa błąd zaokrąglenia i zapas na jazdę. */
  radiusM: 1_300,
  /** Po takim przesunięciu (m) pobieramy od nowa. */
  refetchM: 600,
  /** Promień szukania miejscowości (m). */
  placeRadiusM: 8_000,
  /** Droga dalej niż tyle metrów od nas to nie ta, którą jedziemy. */
  maxDistM: 45,
  /** Odchylenie kierunku odcinka od kierunku jazdy (°), powyżej którego droga jest mniej prawdopodobna (np. wiadukt). */
  maxAngleDeg: 35,
  /** Kara za niezgodny kierunek (m) — przy równej odległości wygrywa droga zgodna z kierunkiem jazdy. */
  anglePenaltyM: 40,
} as const;

/** Waga miejscowości: miasto „sięga” dalej niż wieś. */
const PLACE_WEIGHT: Record<Place["kind"], number> = { city: 4, town: 2, village: 1 };

const HIGHWAYS = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"];

/** Zapytanie Overpass: drogi z nazwą lub numerem (z geometrią) i miejscowości w pobliżu. */
export function roadsQuery(p: LatLon): string {
  return (
    `[out:json][timeout:20];` +
    `way(around:${ROADS.radiusM},${p.lat},${p.lon})[highway~"^(${HIGHWAYS.join("|")})$"][~"^(name|ref)$"~"."];out tags geom;` +
    `node(around:${ROADS.placeRadiusM},${p.lat},${p.lon})[place~"^(city|town|village)$"][name];out tags;`
  );
}

/** Odpowiedź Overpass → drogi i miejscowości. */
export function parseRoads(json: unknown): RoadData {
  const elements = (json as { elements?: unknown[] } | null)?.elements;
  const out: RoadData = { roads: [], places: [] };
  if (!Array.isArray(elements)) return out;
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; geometry?: LatLon[]; tags?: Record<string, string> };
    const t = e.tags ?? {};
    if (e.type === "way" && Array.isArray(e.geometry) && e.geometry.length >= 2 && t.highway) {
      out.roads.push({ id: e.id ?? 0, name: t.name || undefined, ref: t.ref || undefined, highway: t.highway, geom: e.geometry.map((g) => ({ lat: g.lat, lon: g.lon })) });
    } else if (e.type === "node" && typeof e.lat === "number" && typeof e.lon === "number" && t.name && (t.place === "city" || t.place === "town" || t.place === "village")) {
      out.places.push({ name: t.name, kind: t.place, lat: e.lat, lon: e.lon });
    }
  }
  return out;
}

/** Odległość punktu od odcinka (m) — w lokalnym rzucie płaskim, wystarczającym na kilkadziesiąt metrów. */
function segmentDistM(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lon - p.lon) * k, ay = a.lat - p.lat;
  const bx = (b.lon - p.lon) * k, by = b.lat - p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * 111_320;
}

/** Różnica kierunków bez zwrotu (0–90°) — droga dwukierunkowa pasuje w obie strony. */
function axisDiff(a: number, b: number) {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

/** Droga, którą najpewniej jedziemy: najbliższa, z karą za kierunek niezgodny z kierunkiem jazdy. */
export function matchRoad(roads: Road[], pos: LatLon, heading: number | null): Road | undefined {
  let best: { road: Road; score: number } | undefined;
  for (const road of roads) {
    for (let i = 1; i < road.geom.length; i++) {
      const d = segmentDistM(pos, road.geom[i - 1], road.geom[i]);
      if (d > ROADS.maxDistM) continue;
      const off = heading === null ? 0 : axisDiff(heading, bearingDeg(road.geom[i - 1], road.geom[i]));
      const score = d + (off > ROADS.maxAngleDeg ? ROADS.anglePenaltyM : 0);
      if (!best || score < best.score) best = { road, score };
    }
  }
  return best?.road;
}

/** Miejscowość „przy nas”: najbliższa, przy czym miasto liczy się z dalszej odległości niż wieś. */
export function nearestPlace(places: Place[], pos: LatLon): Place | undefined {
  let best: { place: Place; score: number } | undefined;
  for (const place of places) {
    const score = distanceM(pos, place) / PLACE_WEIGHT[place.kind];
    if (!best || score < best.score) best = { place, score };
  }
  return best?.place;
}

/** „A2 · Autostrada Wolności”, „S8”, „ul. Długa” → do wyświetlenia. */
export function roadLabel(r: Road): string {
  return r.ref && r.name ? `${r.ref} · ${r.name}` : (r.ref ?? r.name ?? "");
}
