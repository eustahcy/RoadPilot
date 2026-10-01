// Prowadzenie po trasie z nawigacji: gdzie na trasie jesteśmy, następny manewr, pasy i ograniczenie prędkości.
// Czyste funkcje — geometria trasy: [lat, lon, km od startu] (server/nav.mjs → parseRoute).

import { distanceM } from "./gps";
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
  /** Kierunek z odbiornika GPS wiarygodny dopiero od tej prędkości (km/h) — wolniej z przesunięcia albo z drogi. */
  headingMinKmh: 15,
  /** Kierunek z przesunięcia: co najmniej tyle metrów między odczytami. */
  headingMinMoveM: 20,
  /** Odcinek trasy „w naszym kierunku”: różnica kierunków najwyżej tyle stopni. */
  dirMatchDeg: 70,
  /** Bez odczytów (tunel) przewidujemy ruch po trasie najwyżej tyle s i tyle km. */
  deadReckonS: 60,
  deadReckonKm: 1.5,
  /** Przybliżenie mapy przed manewrem od tylu km. */
  junctionZoomKm: 0.4,
  /** Tyle s bez odczytu = „GPS słaby” (przewidujemy). */
  weakGpsS: 5,
  /** Tyle czasu poza trasą, zanim wyznaczymy ją od nowa (ms). */
  rerouteAfterMs: 8_000,
  /** Dalej niż tyle metrów od trasy — wyznaczamy od razu (na pewno inna droga). */
  offRouteFarM: 200,
  /** Powrót na trasę liczy się dopiero po tylu ms na niej — pojedynczy odczyt przy progu nie zeruje odliczania. */
  backOnRouteMs: 5_000,
  /** Kolejna próba (np. po błędzie sieci) nie częściej niż co tyle ms — trasy liczy nasz silnik (bez limitu TomTom). */
  rerouteEveryMs: 20_000,
  /** Pasy pokazujemy od tylu km przed miejscem, gdzie są potrzebne. */
  lanesAheadKm: 2,
  /** Bramki (punkt poboru opłat) pokazujemy na karcie od tylu km. */
  tollAheadKm: 3,
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

/** Odczyt do śladu dopasowania: pozycja, prędkość i kierunek z odbiornika (może go nie być). */
export interface TrackFix {
  lat: number;
  lon: number;
  kmh: number | null;
  heading: number | null;
}

const bearingDeg = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  ((Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI + 360) % 360;
const angleDiff = (a: number, b: number) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return Math.min(d, 360 - d); };

/**
 * Kierunek jazdy: z odbiornika tylko od NAV.headingMinKmh (wolniej iPhone podaje go z dużym błędem), inaczej z przesunięcia
 * między odczytami (≥ NAV.headingMinMoveM); null = nie wiemy (postój) — mapa się nie obraca.
 */
export function travelHeading(fixes: TrackFix[]): number | null {
  const last = fixes[fixes.length - 1];
  if (!last) return null;
  if (last.heading !== null && (last.kmh ?? 0) >= NAV.headingMinKmh) return last.heading;
  for (let i = fixes.length - 2; i >= 0; i--) {
    const a = fixes[i];
    const d = Math.hypot((last.lat - a.lat) * M_PER_DEG, (last.lon - a.lon) * M_PER_DEG * Math.cos((last.lat * Math.PI) / 180));
    if (d >= NAV.headingMinMoveM) return bearingDeg(a, last);
  }
  return null;
}

/**
 * Dopasowanie do trasy po śladzie: najbliższy odcinek w naszym kierunku (±NAV.dirMatchDeg) — trasa biegnąca obok w drugą
 * stronę (pętla, zjazd, druga jezdnia przy zawracaniu) nie przejmuje pozycji; odległość od trasy = mediana z ostatnich
 * odczytów (pojedynczy zły odczyt przy wiadukcie nie daje „Poza trasą”). Bez kierunku — jak `locate`.
 */
export function locateTrace(points: RoutePoint[], fixes: TrackFix[], hint?: number): RoutePos | undefined {
  const last = fixes[fixes.length - 1];
  if (!last || points.length < 2) return undefined;
  const heading = travelHeading(fixes);
  let pos: RoutePos | undefined;
  if (heading === null) pos = locate(points, last, hint);
  else {
    const from = hint === undefined ? 0 : Math.max(0, hint - NAV.windowBack);
    const to = hint === undefined ? points.length - 1 : Math.min(points.length - 1, hint + NAV.windowAhead);
    const kx = M_PER_DEG * Math.cos((last.lat * Math.PI) / 180);
    let any: RoutePos | undefined;
    for (let i = from; i < to; i++) {
      const [aLat, aLon, aKm] = points[i];
      const [bLat, bLon, bKm] = points[i + 1];
      const bx = (bLon - aLon) * kx, by = (bLat - aLat) * M_PER_DEG;
      const px = (last.lon - aLon) * kx, py = (last.lat - aLat) * M_PER_DEG;
      const len2 = bx * bx + by * by;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
      const off = Math.hypot(px - t * bx, py - t * by);
      const cand = { km: aKm + t * (bKm - aKm), offM: off, idx: i };
      if (!any || off < any.offM) any = cand;
      if (len2 > 0 && angleDiff(bearingDeg({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon }), heading) > NAV.dirMatchDeg) continue;
      if (!pos || off < pos.offM) pos = cand;
    }
    // Nigdzie w naszym kierunku — jedziemy pod prąd trasy (zawracamy): najbliższy odcinek, a odległość zdecyduje o „poza trasą”.
    pos ??= any;
  }
  if (!pos || fixes.length < 3) return pos;
  // Mediana odległości ostatnich 3 odczytów od trasy w okolicy dopasowania.
  const offs = fixes.slice(-3).map((f) => locate(points, f, pos!.idx)?.offM ?? Infinity).sort((a, b) => a - b);
  return { ...pos, offM: Math.min(pos.offM, offs[1]) };
}

/**
 * Przybliżenie mapy przed manewrem (poziomy zoomu do dodania): od NAV.junctionZoomKm do manewru +1, przy złożonym miejscu
 * (rondo, pasy do wyboru, kolejny manewr w 300 m) +1,3; za manewrem 0 (wraca płynnie). Prosto / „jedź dalej” — bez zmian.
 */
export function junctionZoom(list: NavInstruction[], lanes: LaneSection[], km: number): number {
  const next = nextInstruction(list, km);
  if (!next || next.inKm > NAV.junctionZoomKm || /^(STRAIGHT|FOLLOW|DEPART)$/.test(next.ins.maneuver)) return 0;
  const complex = next.ins.maneuver.startsWith("ROUNDABOUT") || !!next.then || lanes.some((l) => Math.abs(l.km - next.ins.km) <= 0.2);
  return complex ? 1.3 : 1;
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

/** Gdzie się ustawić: `count` pasów prowadzi trasą; „right” = same prawe, „left” = same lewe, „middle” = środkowe. */
export interface LaneHint {
  side: "right" | "left" | "middle";
  /** Pasy prowadzące trasą (numery od lewej, od 1). */
  lanes: number[];
  total: number;
  text: string;
}

/**
 * Asystent pasa: z układu pasów przed manewrem (np. dwa prosto + zjazdowy, który dopiero się zacznie) — którym pasem jechać.
 * Pas zjazdowy po prawej, którego jeszcze nie ma, osiągniemy z prawego pasa, więc „trzymaj się prawego pasa” już teraz.
 * undefined = każdy pas prowadzi trasą (nie ma czego podpowiadać).
 */
export function laneHint(s: Pick<LaneSection, "lanes">): LaneHint | undefined {
  const total = s.lanes.length;
  const ok = s.lanes.flatMap((l, i) => (l.follow ? [i + 1] : []));
  if (!ok.length || ok.length === total || total < 2) return undefined;
  const right = ok[ok.length - 1] === total;
  const left = ok[0] === 1;
  const many = ok.length > 1;
  if (right && !left) return { side: "right", lanes: ok, total, text: many ? "Trzymaj się prawych pasów" : total >= 3 ? "Jedź skrajnie prawym pasem" : "Jedź prawym pasem" };
  if (left && !right) return { side: "left", lanes: ok, total, text: many ? "Trzymaj się lewych pasów" : total >= 3 ? "Jedź skrajnie lewym pasem" : "Jedź lewym pasem" };
  return { side: "middle", lanes: ok, total, text: many ? `Jedź pasami ${ok[0]}–${ok[ok.length - 1]} (od lewej)` : `Jedź pasem ${ok[0]} od lewej` };
}

/** Stan wykrywania zjazdu z trasy: od kiedy poza trasą, od kiedy znów na niej (ms), kiedy ostatnio wyznaczaliśmy. */
export interface OffRouteState {
  offSince: number | null;
  onSince: number | null;
  lastReroute: number;
}

export const OFF_ROUTE_IDLE: OffRouteState = { offSince: null, onSince: null, lastReroute: -Infinity };

/**
 * Czy wyznaczyć trasę od nowa. `off` — odczyt poza trasą, `offM` — odległość od niej, `missing` — jest cel, a nie ma trasy
 * w urządzeniu (wtedy od razu). Poza trasą od NAV.rerouteAfterMs, daleko (NAV.offRouteFarM) od razu; powrót na trasę dopiero po
 * NAV.backOnRouteMs — przy zjeździe odległość waha się wokół progu i każdy odczyt „na trasie” zaczynał odliczanie od nowa.
 */
export function nextOffRoute(s: OffRouteState, o: { off: boolean; offM?: number; missing: boolean; now: number; rerouting: boolean }): { state: OffRouteState; reroute: boolean } {
  if (!o.off && !o.missing) {
    if (s.offSince === null) return { state: s.onSince === null ? s : { ...s, onSince: null }, reroute: false };
    const onSince = s.onSince ?? o.now;
    const back = o.now - onSince >= NAV.backOnRouteMs;
    return { state: { ...s, offSince: back ? null : s.offSince, onSince: back ? null : onSince }, reroute: false };
  }
  const offSince = s.offSince ?? o.now;
  const wait = o.missing || (o.offM ?? 0) > NAV.offRouteFarM ? 0 : NAV.rerouteAfterMs;
  const due = !o.rerouting && o.now - offSince >= wait && o.now - s.lastReroute >= NAV.rerouteEveryMs;
  return { state: { offSince, onSince: null, lastReroute: due ? o.now : s.lastReroute }, reroute: due };
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

// ── Ograniczenie bez trasy ────────────────────────────────────────────────────────────────────────────
// Bez wyznaczonej trasy (albo poza nią) serwer dopasowuje do mapy ślad z ostatnich odczytów (/api/nav/here) —
// kolejność punktów daje kierunek jazdy, więc droga obok czy wiadukt nie mylą.

export const HERE = {
  /** Punkty śladu co najmniej co tyle metrów. */
  stepM: 25,
  /** Długość śladu (m) — wystarczy do dopasowania, a pozycja nie trafia na serwer z dłuższej historii. */
  keepM: 400,
  /** Najwięcej punktów śladu. */
  maxPoints: 20,
  /** Ślad musi mieć tyle metrów, żeby było co dopasować. */
  minM: 60,
  /** Pytamy ponownie po tylu metrach jazdy. */
  askEveryM: 150,
  /** Odpowiedź ważna, dopóki nie odjedziemy dalej niż tyle metrów od miejsca zapytania. */
  validM: 600,
} as const;

export type TrailPoint = [lat: number, lon: number];

/** Dokłada odczyt do śladu (co HERE.stepM) i przycina ślad od początku do HERE.keepM / HERE.maxPoints. */
export function pushTrail(trail: TrailPoint[], p: { lat: number; lon: number }): TrailPoint[] {
  const last = trail[trail.length - 1];
  if (last && distanceM({ lat: last[0], lon: last[1] }, p) < HERE.stepM) return trail;
  const out = [...trail, [p.lat, p.lon] as TrailPoint].slice(-HERE.maxPoints);
  while (out.length > 2 && trailM(out.slice(1)) >= HERE.keepM) out.shift();
  return out;
}

/** Długość śladu (m). */
export function trailM(trail: TrailPoint[]): number {
  let m = 0;
  for (let i = 1; i < trail.length; i++) m += distanceM({ lat: trail[i - 1][0], lon: trail[i - 1][1] }, { lat: trail[i][0], lon: trail[i][1] });
  return m;
}
