// Prowadzenie po trasie z nawigacji: gdzie na trasie jesteśmy, następny manewr, pasy i ograniczenie prędkości.
// Czyste funkcje — geometria trasy: [lat, lon, km od startu] (server/nav.mjs → parseRoute).

import { TRUCK_SPEED } from "./rules";

export type RoutePoint = [number, number, number];

export interface NavInstruction {
  km: number;
  maneuver: string;
  text: string;
  street?: string;
  signpost?: string;
  exit?: string;
  roundaboutExit?: string;
  angle?: number;
}

export interface LaneSection {
  km: number;
  toKm: number;
  lanes: { dirs: string[]; follow?: string }[];
}

export interface SpeedLimit {
  km: number;
  toKm: number;
  kmh: number;
}

export const NAV = {
  /** Dalej od trasy niż tyle metrów (plus dokładność GPS) = zjechaliśmy z trasy. */
  offRouteM: 50,
  /** Tyle czasu poza trasą, zanim wyznaczymy ją od nowa (ms). */
  rerouteAfterMs: 15_000,
  /** Nie częściej niż co tyle ms — każda trasa to zapytanie do limitu TomTom. */
  rerouteEveryMs: 60_000,
  /** Pasy pokazujemy od tylu km przed miejscem, gdzie są potrzebne. */
  lanesAheadKm: 1.5,
  /** Szukanie pozycji wokół poprzedniej: tyle punktów wstecz i naprzód (punkty co ~50 m). */
  windowBack: 40,
  windowAhead: 600,
  /** Dane o ograniczeniu mają luki — ostatnie znane trzymamy jeszcze tyle km za końcem odcinka (dalej lepiej nic niż nieaktualne). */
  limitCarryKm: 3,
  /** Prędkość: do tylu km/h nad limitem żółto, powyżej czerwono. */
  overWarnKmh: 5,
} as const;

const M_PER_DEG = 111_320;

export interface RoutePos {
  /** Km od startu trasy (rzut na trasę). */
  km: number;
  /** Odległość od trasy (m). */
  offM: number;
  /** Indeks odcinka — podpowiedź do następnego wyszukiwania. */
  idx: number;
}

/**
 * Rzut pozycji na trasę. Z podpowiedzią `hint` szukamy w oknie wokół niej (szybko, bez przeskoków na
 * równoległy fragment trasy); bez niej — po całej trasie.
 */
export function locate(points: RoutePoint[], pos: { lat: number; lon: number }, hint?: number): RoutePos | undefined {
  if (points.length < 2) return undefined;
  const from = hint === undefined ? 0 : Math.max(0, hint - NAV.windowBack);
  const to = hint === undefined ? points.length - 1 : Math.min(points.length - 1, hint + NAV.windowAhead);
  const kx = M_PER_DEG * Math.cos((pos.lat * Math.PI) / 180);
  let best: RoutePos | undefined;
  for (let i = from; i < to; i++) {
    const [aLat, aLon, aKm] = points[i];
    const [bLat, bLon, bKm] = points[i + 1];
    // Płaskie współrzędne w metrach względem punktu A — na odcinkach po kilkadziesiąt metrów to wystarcza.
    const bx = (bLon - aLon) * kx;
    const by = (bLat - aLat) * M_PER_DEG;
    const px = (pos.lon - aLon) * kx;
    const py = (pos.lat - aLat) * M_PER_DEG;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    if (!best || off < best.offM) best = { km: aKm + t * (bKm - aKm), offM: off, idx: i };
  }
  return best;
}

/** Następny manewr przed nami (pomijamy „wyjedź”) i odległość do niego (km). */
export function nextInstruction(list: NavInstruction[], km: number): { ins: NavInstruction; inKm: number; then?: NavInstruction } | undefined {
  const i = list.findIndex((x) => x.maneuver !== "DEPART" && x.km > km + 0.005);
  if (i < 0) return undefined;
  const ins = list[i];
  const after = list[i + 1];
  // „Następnie …” — gdy kolejny manewr jest tuż za tym.
  const then = after && after.km - ins.km <= 0.3 ? after : undefined;
  return { ins, inKm: ins.km - km, then };
}

/** Pasy potrzebne na najbliższym odcinku (od `lanesAheadKm` przed nim do jego końca). */
export function lanesAhead(list: LaneSection[], km: number): (LaneSection & { inKm: number }) | undefined {
  const s = list.find((x) => x.toKm >= km && x.km - km <= NAV.lanesAheadKm);
  return s && { ...s, inKm: Math.max(0, s.km - km) };
}

export function speedLimitAt(list: SpeedLimit[], km: number): number | undefined {
  const here = list.find((x) => km >= x.km && km < x.toKm);
  if (here) return here.kmh;
  // Luka w danych: ostatni odcinek, który skończył się niedawno (na autostradzie znak nie znika co kilometr).
  let last: SpeedLimit | undefined;
  for (const x of list) if (x.toKm <= km && (!last || x.toKm > last.toKm)) last = x;
  return last && km - last.toKm <= NAV.limitCarryKm ? last.kmh : undefined;
}

/** Rodzaj drogi wg przepisów o prędkości: obszar zabudowany, poza nim, autostrada / droga ekspresowa. */
export type RoadKind = "urban" | "rural" | "motorway";

export interface RoadSection {
  km: number;
  toKm: number;
  kind: RoadKind;
}

export function roadKindAt(list: RoadSection[] | undefined, km: number): RoadKind | undefined {
  return list?.find((x) => km >= x.km && km <= x.toKm)?.kind;
}

export interface LegalLimit {
  /** Limit dla naszego pojazdu (na znaku w aplikacji). */
  kmh: number;
  /** Znak na drodze, gdy jest wyższy niż limit ciężarówki (np. 70 w mieście — nas dalej obowiązuje 50). */
  ignoredSign?: number;
  kind?: RoadKind;
}

/**
 * Ograniczenie dla pojazdu na danym km: znak z trasy i — dla ciężarówki — limit z przepisów dla rodzaju drogi
 * (TRUCK_SPEED); obowiązuje niższy. Bez znaku i bez rodzaju drogi — brak danych.
 */
export function legalLimitAt(route: { speedLimits: SpeedLimit[]; roads?: RoadSection[] }, km: number, truck: boolean): LegalLimit | undefined {
  const sign = speedLimitAt(route.speedLimits, km);
  const kind = roadKindAt(route.roads, km);
  const cap = truck && kind ? TRUCK_SPEED[kind] : undefined;
  if (cap === undefined) return sign === undefined ? undefined : { kmh: sign, kind };
  if (sign === undefined || sign >= cap) return { kmh: cap, kind, ...(sign !== undefined && sign > cap ? { ignoredSign: sign } : {}) };
  return { kmh: sign, kind };
}

export type SpeedTone = "ok" | "warn" | "over";

/** Kolor prędkości: zielony do limitu, żółty do NAV.overWarnKmh nad nim, czerwony wyżej; bez limitu — bez oceny. */
export function speedTone(kmh: number | null, limit: number | undefined): SpeedTone | undefined {
  if (kmh === null || limit === undefined) return undefined;
  return kmh <= limit ? "ok" : kmh <= limit + NAV.overWarnKmh ? "warn" : "over";
}

/** Poza trasą: odległość większa niż próg plus niepewność pozycji. */
export function isOffRoute(p: RoutePos, accuracyM: number): boolean {
  return p.offM > NAV.offRouteM + Math.min(accuracyM, 50);
}

/** Punkt trasy na danym km (interpolacja między punktami geometrii). */
export function pointAtKm(points: RoutePoint[], km: number): { lat: number; lon: number } | undefined {
  if (!points.length) return undefined;
  if (km <= points[0][2]) return { lat: points[0][0], lon: points[0][1] };
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLon, aKm] = points[i - 1];
    const [bLat, bLon, bKm] = points[i];
    if (km <= bKm) {
      const t = bKm > aKm ? (km - aKm) / (bKm - aKm) : 0;
      return { lat: aLat + t * (bLat - aLat), lon: aLon + t * (bLon - aLon) };
    }
  }
  const last = points[points.length - 1];
  return { lat: last[0], lon: last[1] };
}

/** Kierunek trasy (stopnie od północy) na odcinku od km do km + span — do obracania widoku „kierunek jazdy w górę”. */
export function bearingAtKm(points: RoutePoint[], km: number, span = 0.08): number | undefined {
  const a = pointAtKm(points, Math.max(0, km - span / 4));
  const b = pointAtKm(points, km + span);
  if (!a || !b) return undefined;
  const kx = Math.cos((a.lat * Math.PI) / 180);
  const dx = (b.lon - a.lon) * kx;
  const dy = b.lat - a.lat;
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return undefined;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Fragment geometrii trasy między km `from` i `to` (z punktami na brzegach). */
export function routeSlice(points: RoutePoint[], from: number, to: number): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  const start = pointAtKm(points, from);
  if (start) out.push(start);
  for (const [lat, lon, km] of points) if (km > from && km < to) out.push({ lat, lon });
  const end = pointAtKm(points, to);
  if (end) out.push(end);
  return out;
}

/** Tak daleko od trasy (m) punkt wciąż liczymy jako „na trasie” (MOP przy zjeździe, znajomy na tej samej drodze). */
export const ON_ROUTE_M = 300;

export interface AlongRoute {
  /** Km po trasie od nas: dodatnie = przed nami, ujemne = za nami. */
  km: number;
  offM: number;
}

/** Odległość po trasie do punktu, jeśli leży przy niej (≤ maxOffM); inaczej undefined. `myKm` = nasz rzut na trasę. */
export function alongRoute(points: RoutePoint[], target: { lat: number; lon: number }, myKm: number, maxOffM = ON_ROUTE_M): AlongRoute | undefined {
  const p = locate(points, target);
  if (!p || p.offM > maxOffM) return undefined;
  return { km: p.km - myKm, offM: p.offM };
}

/** Najbliższe przed nami po trasie spośród punktów leżących przy niej — np. MOP na naszej drodze. */
export function nearestOnRoute<T extends { lat: number; lon: number }>(items: T[], points: RoutePoint[], myKm: number, maxOffM = ON_ROUTE_M): { item: T; km: number } | undefined {
  let best: { item: T; km: number } | undefined;
  for (const item of items) {
    const a = alongRoute(points, item, myKm, maxOffM);
    if (a && a.km >= 0 && (!best || a.km < best.km)) best = { item, km: a.km };
  }
  return best;
}
