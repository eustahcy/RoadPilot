// Własny silnik tras RoadPilot: Valhalla na danych OpenStreetMap (Polska). Zapytanie dla ciężarówki i zamiana
// odpowiedzi na ten sam format co trasa TomTom (parseRoute) — HUD, ostrzeżenia i plan przerw działają bez zmian.

import { distanceKm } from "./nav.mjs";
import { nearest } from "./warnings.mjs";

/** Polyline6 (Valhalla) → [{ latitude, longitude }]. */
export function decodePolyline6(s) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let r = 0, shift = 0, b;
    do {
      b = s.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push({ latitude: lat / 1e6, longitude: lon / 1e6 });
  }
  return out;
}

/** Zapytanie Valhalla /route dla ciężarówki z danymi pojazdu z aplikacji. */
/** `routeType` "shortest" → Valhalla liczy po długości, nie po czasie; "eco" u nas = najszybsza. */
/** `via` — punkty pośrednie (typ „through”: przejazd bez zatrzymania i zawracania, trasa zostaje jednym odcinkiem). */
export function valhallaRequest(from, to, v, exclude = [], alternates = 0, routeType = "fastest", via = []) {
  return {
    ...(alternates > 0 && !via.length ? { alternates } : {}),
    locations: [{ lat: from.lat, lon: from.lon }, ...via.map((p) => ({ lat: p.lat, lon: p.lon, type: "through" })), { lat: to.lat, lon: to.lon }],
    ...(exclude.length ? { exclude_locations: exclude.map((p) => ({ lat: p.lat, lon: p.lon })) } : {}),
    costing: "truck",
    costing_options: {
      truck: {
        height: v.heightM,
        width: v.widthM,
        length: v.lengthM,
        weight: v.weightKg / 1000,
        axle_load: v.axleWeightKg / 1000,
        axle_count: v.axles,
        hazmat: !!v.adr && v.adr !== "none",
        top_speed: v.maxKmh,
        // Trzymaj się dróg dla ciężarówek: bez tego Valhalla ścina łuki autostrad wojewódzkimi przez wsie
        // (np. A1 Piątek → 703/702/708 → Stryków zamiast A1/A2), choć czas wychodzi prawie ten sam.
        use_truck_route: true,
        ...(routeType === "shortest" ? { shortest: true } : {}),
        // Unikanie dróg (Nawigacja → Ustawienia): 0 = omijaj, o ile da się dojechać inaczej.
        ...(v.avoid?.tolls ? { use_tolls: 0 } : {}),
        ...(v.avoid?.motorways ? { use_highways: 0 } : {}),
        ...(v.avoid?.ferries ? { use_ferry: 0 } : {}),
      },
    },
    directions_options: { units: "kilometers", language: "pl-PL" },
  };
}

/** Typ manewru Valhalla → nazwa jak w TomTom (ikony i opisy w HUD). */
const MANEUVER = {
  1: "DEPART", 2: "DEPART", 3: "DEPART", 4: "ARRIVE", 5: "ARRIVE_RIGHT", 6: "ARRIVE_LEFT",
  7: "FOLLOW", 8: "STRAIGHT", 9: "BEAR_RIGHT", 10: "TURN_RIGHT", 11: "SHARP_RIGHT", 12: "MAKE_UTURN", 13: "MAKE_UTURN",
  14: "SHARP_LEFT", 15: "TURN_LEFT", 16: "BEAR_LEFT", 17: "STRAIGHT", 18: "KEEP_RIGHT", 19: "KEEP_LEFT",
  20: "MOTORWAY_EXIT_RIGHT", 21: "MOTORWAY_EXIT_LEFT", 22: "STRAIGHT", 23: "KEEP_RIGHT", 24: "KEEP_LEFT", 25: "STRAIGHT",
  26: "ROUNDABOUT_RIGHT", 27: "FOLLOW", 28: "TAKE_FERRY", 29: "FOLLOW", 37: "STRAIGHT", 38: "STRAIGHT",
};

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/** Typ drogi odcinka z jego średniej prędkości (Valhalla nie podaje klasy drogi w trasie). */
function roadType(km, s) {
  const kmh = s > 0 ? km / (s / 3600) : 0;
  return kmh >= 68 ? "motorway" : kmh < 38 ? "urban" : "rural";
}

/** Różnica kierunków (°) → skręt w prawo dodatni, w lewo ujemny, w zakresie −180…180. */
export const turnAngle = (before, after) => {
  const d = (((after - before) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

/** Trasy alternatywne z odpowiedzi Valhalla (pole `alternates`). */
export function parseValhallaAlternates(json) {
  return (json?.alternates ?? []).map((a) => parseValhalla(a)).filter(Boolean);
}

/** Odpowiedź Valhalla → trasa aplikacji (bez pasów i ograniczeń prędkości — tych Valhalla nie daje). */
export function parseValhalla(json) {
  const leg = json?.trip?.legs?.[0];
  if (!leg?.shape) return null;
  const pts = decodePolyline6(leg.shape);
  const km = [0];
  for (let i = 1; i < pts.length; i++) km.push(km[i - 1] + distanceKm(pts[i - 1], pts[i]));
  const total = json.trip.summary.length;
  const scale = km[km.length - 1] > 0 ? total / km[km.length - 1] : 1;
  for (let i = 0; i < km.length; i++) km[i] *= scale;

  const segments = [];
  const instructions = [];
  const mans = leg.maneuvers ?? [];
  for (const [mi, m] of mans.entries()) {
    const type = roadType(m.length ?? 0, m.time ?? 0);
    const last = segments[segments.length - 1];
    if ((m.length ?? 0) > 0) {
      if (last && last.type === type) last.km += m.length;
      else segments.push({ type, km: m.length });
    }
    const signs = m.sign ?? {};
    const exit = signs.exit_number_elements?.[0]?.text;
    const toward = (signs.exit_toward_elements ?? signs.exit_branch_elements ?? []).map((e) => e.text).slice(0, 2).join(", ");
    instructions.push({
      km: round(km[m.begin_shape_index] ?? 0, 3),
      maneuver: MANEUVER[m.type] ?? "STRAIGHT",
      text: m.instruction ?? "",
      ...(m.street_names?.length ? { street: m.street_names[0] } : {}),
      ...(toward ? { signpost: toward } : {}),
      ...(exit ? { exit } : {}),
      ...(m.roundabout_exit_count ? { roundaboutExit: String(m.roundabout_exit_count) } : {}),
      ...(() => {
        // Kąt manewru (° w prawo, −180…180) z kierunku przed i po — do strzałki; na rondzie: wjazd → kierunek po zjeździe (następny manewr 27).
        const after = m.type === 26 ? mans.slice(mi + 1).find((x) => x.type === 27)?.bearing_after : m.bearing_after;
        return Number.isFinite(m.bearing_before) && Number.isFinite(after) ? { angle: turnAngle(m.bearing_before, after) } : {};
      })(),
    });
  }

  const curves = sharpCurves(pts, km, instructions);

  const points = [];
  let lastKm = -Infinity;
  pts.forEach((p, i) => {
    if (i === 0 || i === pts.length - 1 || km[i] - lastKm >= 0.05) {
      points.push([round(p.latitude, 5), round(p.longitude, 5), round(km[i], 3)]);
      lastKm = km[i];
    }
  });

  return {
    engine: "roadpilot",
    ferry: instructions.some((i) => i.maneuver === "TAKE_FERRY"),
    lengthKm: round(total, 3),
    travelMin: round(json.trip.summary.time / 60, 1),
    trafficMin: 0,
    segments: segments.map((s) => ({ type: s.type, km: round(s.km, 3) })),
    points,
    instructions,
    lanes: [],
    speedLimits: [],
    traffic: [],
    curves,
  };
}

/** Zakręt ciaśniejszy niż tyle metrów promienia — dla długiego zestawu trzeba zwolnić i zająć szerzej pas. */
export const CURVE_MAX_R = 25;
/** Zakręt na skrzyżowaniu (manewr w tylu km) to skręt, nie łuk drogi — nie ostrzegamy. */
const CURVE_MANEUVER_KM = 0.06;
/** Punkty do promienia: tyle metrów przed i za. */
const CURVE_SPAN_M = 15;

/**
 * Ciasne łuki drogi z geometrii trasy (pełna, przed rozrzedzeniem): promień okręgu przez punkty ±CURVE_SPAN_M.
 * Pomija skrzyżowania z manewrem i ronda; sąsiednie punkty jednego łuku → jeden zakręt z najmniejszym promieniem.
 */
export function sharpCurves(pts, km, instructions = []) {
  const out = [];
  const turns = instructions.filter((i) => i.maneuver !== "STRAIGHT" && i.maneuver !== "FOLLOW").map((i) => i.km);
  const at = (target) => {
    // Punkt na łamanej w danym km (interpolacja).
    let j = 1;
    while (j < km.length - 1 && km[j] < target) j++;
    const f = km[j] > km[j - 1] ? Math.max(0, Math.min(1, (target - km[j - 1]) / (km[j] - km[j - 1]))) : 0;
    return { lat: pts[j - 1].latitude + f * (pts[j].latitude - pts[j - 1].latitude), lon: pts[j - 1].longitude + f * (pts[j].longitude - pts[j - 1].longitude) };
  };
  const total = km[km.length - 1] ?? 0;
  const span = CURVE_SPAN_M / 1000;
  for (let k = span; k <= total - span; k += 0.01) {
    if (turns.some((t) => Math.abs(t - k) <= CURVE_MANEUVER_KM)) continue;
    const [a, b, c] = [at(k - span), at(k), at(k + span)];
    const kx = 111_320 * Math.cos((b.lat * Math.PI) / 180);
    const P = (p) => [(p.lon - b.lon) * kx, (p.lat - b.lat) * 111_320];
    const [A, C] = [P(a), P(c)];
    const ab = Math.hypot(A[0], A[1]), bc = Math.hypot(C[0], C[1]), ac = Math.hypot(C[0] - A[0], C[1] - A[1]);
    const cross = Math.abs(A[0] * C[1] - A[1] * C[0]);
    if (cross < 1e-6) continue;
    const r = (ab * bc * ac) / (2 * cross);
    if (r >= CURVE_MAX_R) continue;
    const last = out[out.length - 1];
    if (last && k - last.km < 0.08) { if (r < last.radiusM) { last.km = round(k, 3); last.radiusM = Math.round(r); } }
    else out.push({ km: round(k, 3), radiusM: Math.round(r) });
  }
  return out;
}

// ── Pasy ruchu (asystent pasa) ──────────────────────────────────────────────────────────────────────
// Valhalla podaje pasy tylko w formacie OSRM: na skrzyżowaniu lista pasów z kierunkami (z tagów OSM turn:lanes),
// `valid` = pasem da się jechać trasą, `valid_indication` = którą strzałką. Zamieniamy to na format TomTom (LaneSection).

/** Skrzyżowanie dalej od trasy niż tyle metrów pomijamy (inny fragment / błąd dopasowania). */
const LANE_NEAR_M = 30;
/** Szukanie skrzyżowania na trasie: tyle punktów naprzód od poprzedniego (punkty co ≥ 50 m) — bez skoku na równoległą jezdnię. */
const LANE_WINDOW = 400;
/** Więcej pasów niż tyle = plac poboru opłat, nie skrzyżowanie. */
const LANE_MAX = 5;
/** Manewr z trasy tyle km przed / za skrzyżowaniem z pasami = pasy dotyczą tego manewru. */
const LANE_MANEUVER_KM = { before: 0.15, after: 0.3 };

const LANE_DIR = { straight: "STRAIGHT", none: "STRAIGHT", "slight right": "SLIGHT_RIGHT", right: "RIGHT", "sharp right": "SHARP_RIGHT", "slight left": "SLIGHT_LEFT", left: "LEFT", "sharp left": "SHARP_LEFT", uturn: "U_TURN" };
const laneDir = (d) => LANE_DIR[d] ?? "STRAIGHT";

/**
 * Odpowiedź Valhalla w formacie OSRM (`idx` = która trasa) → pasy na trasie [{ km, toKm, lanes: [{ dirs, follow? }] }].
 * Tylko skrzyżowania, na których trzeba wybrać pas: skręcamy / zjeżdżamy, pas „prosto” nie prowadzi trasą, w tym miejscu
 * jest manewr z trasy (`instructions`, np. „trzymaj się lewej” na rozjeździe) albo odchodzą co najmniej dwa pasy.
 */
export function osrmLanes(json, points, idx = 0, instructions = []) {
  const out = [];
  let from = 0;
  for (const leg of json?.routes?.[idx]?.legs ?? []) {
    for (const step of leg.steps ?? []) {
      for (const it of step.intersections ?? []) {
        const lanes = it.lanes;
        // 6+ pasów w jednym kierunku to w Polsce plac poboru opłat (budki) — tam podpowiedź „lewymi pasami” myli.
        if (!Array.isArray(lanes) || lanes.length < 2 || lanes.length > LANE_MAX || lanes.every((l) => l.valid) || !lanes.some((l) => l.valid)) continue;
        const [lon, lat] = it.location ?? [];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const hit = nearest(points, lat, lon, from, from + LANE_WINDOW);
        if (hit.d > LANE_NEAR_M) continue;
        from = Math.max(0, hit.i - 1);
        const km = round(hit.km, 3);
        const mapped = lanes.map((l) => {
          const dirs = [...new Set((l.indications ?? []).map(laneDir))];
          const follow = l.valid ? laneDir(l.valid_indication ?? l.indications?.[0] ?? "straight") : undefined;
          return { dirs: dirs.length ? dirs : ["STRAIGHT"], ...(follow ? { follow } : {}) };
        });
        // Mijamy jeden pas zjazdu / do skrętu, a każdy pas „prosto” prowadzi trasą, i nie ma tu manewru — nie ma czego podpowiadać
        // (na autostradzie co zjazd). Rozjazd (≥ 2 pasy odchodzą, np. S6 → S7) albo manewr z trasy pokazujemy zawsze.
        const passing = mapped.every((l) => (l.follow ? l.follow === "STRAIGHT" : !l.dirs.includes("STRAIGHT")));
        const split = mapped.filter((l) => !l.follow).length >= 2;
        const atManeuver = instructions.some((i) => i.km >= km - LANE_MANEUVER_KM.before && i.km <= km + LANE_MANEUVER_KM.after && !/^(DEPART|STRAIGHT|FOLLOW)$/.test(i.maneuver));
        if (passing && !split && !atManeuver) continue;
        // To samo miejsce drugi raz (kilka skrzyżowań tuż obok, ten sam układ pasów).
        const last = out[out.length - 1];
        if (last && km - last.km < 0.05 && JSON.stringify(last.lanes) === JSON.stringify(mapped)) continue;
        out.push({ km, toKm: km, lanes: mapped });
      }
    }
  }
  return out;
}

// ── Ograniczenia prędkości i obszar zabudowany na trasie (trace_attributes) ─────────────────────────
// Valhalla /route nie podaje ograniczeń ani klasy drogi, więc dopasowujemy gotową trasę do mapy (trace_attributes)
// i z krawędzi bierzemy znak (speed_limit), klasę drogi i id drogi OSM. Teren zabudowany: drogi z tagami PL:urban
// (plik zones.tsv z osm-update.sh) — w OSM znak 60/70 w mieście zwykle gubi tag PL:urban, stąd wypełnianie luk.

/** Kawałek trasy na jedno zapytanie (limit trace w Valhalli: 200 km i 16 000 punktów). */
export const TRACE_CHUNK_KM = 150;
/** Luka bez danych między odcinkami zabudowanymi krótsza niż tyle km = nadal obszar zabudowany (np. znak 70 w mieście). */
export const URBAN_GAP_KM = 3;
/** Gęstość dróg Valhalli (0–15), od której droga bez tagów jest w mieście. */
export const URBAN_DENSITY = 8;

/** Punkty trasy [lat, lon, km] → kawałki do trace_attributes (sąsiednie dzielą punkt na styku). */
export function traceChunks(points, maxKm = TRACE_CHUNK_KM) {
  const out = [];
  let cur = [];
  for (const p of points) {
    cur.push(p);
    if (p[2] - cur[0][2] >= maxKm || cur.length >= 15000) {
      out.push(cur);
      cur = [p];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out.map((pts) => ({ fromKm: pts[0][2], toKm: pts[pts.length - 1][2], pts }));
}

/** `gps` — ślad z odczytów GPS (szum kilku–kilkunastu metrów): dopasowanie map_snap zamiast przejścia po geometrii trasy. */
export function traceRequest(pts, gps = false) {
  return {
    shape: pts.map(([lat, lon]) => ({ lat, lon })),
    costing: "truck",
    shape_match: gps ? "map_snap" : "walk_or_snap",
    filters: { attributes: ["edge.way_id", "edge.length", "edge.speed_limit", "edge.road_class", "edge.density"], action: "include" },
  };
}

/**
 * Krawędzie z trace_attributes (po kawałkach) → ograniczenia ze znaków i rodzaj drogi wg przepisów:
 * motorway (autostrada / ekspresowa), urban (obszar zabudowany), rural (poza nim). `zones`: id drogi OSM → "u" | "r".
 */
export function roadInfo(chunks, zones) {
  const edges = [];
  for (const c of chunks) {
    const total = c.edges.reduce((s, e) => s + (e.length ?? 0), 0);
    // Długości krawędzi skalujemy do km trasy — dopasowanie bywa o kilka metrów krótsze/dłuższe.
    const scale = total > 0 ? (c.toKm - c.fromKm) / total : 0;
    let km = c.fromKm;
    for (const e of c.edges) {
      const len = (e.length ?? 0) * scale;
      const zone = zones.get(e.way_id);
      const kind = e.road_class === "motorway" ? "motorway" : zone === "u" ? "urban" : zone === "r" ? "rural" : (e.density ?? 0) >= URBAN_DENSITY ? "urban" : null;
      const kmh = typeof e.speed_limit === "number" && e.speed_limit > 0 && e.speed_limit < 200 ? e.speed_limit : null;
      edges.push({ km, toKm: km + len, kind, kmh });
      km += len;
    }
  }
  // Luka bez tagów między dwoma odcinkami zabudowanymi (do URBAN_GAP_KM) — nadal miasto; reszta bez danych = poza.
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].kind !== null) continue;
    let j = i;
    while (j < edges.length && edges[j].kind === null) j++;
    const urban = i > 0 && j < edges.length && edges[i - 1].kind === "urban" && edges[j].kind === "urban" && edges[j - 1].toKm - edges[i].km <= URBAN_GAP_KM;
    for (let k = i; k < j; k++) edges[k].kind = urban ? "urban" : "rural";
    i = j - 1;
  }
  const merge = (key) => {
    const out = [];
    for (const e of edges) {
      if (e[key] === null) continue;
      const last = out[out.length - 1];
      if (last && last.v === e[key] && e.km - last.toKm < 0.01) last.toKm = e.toKm;
      else out.push({ km: e.km, toKm: e.toKm, v: e[key] });
    }
    return out.filter((r) => r.toKm - r.km > 0.001).map((r) => ({ km: round(r.km, 3), toKm: round(r.toKm, 3), v: r.v }));
  };
  return {
    speedLimits: merge("kmh").map(({ km, toKm, v }) => ({ km, toKm, kmh: v })),
    roads: merge("kind").map(({ km, toKm, v }) => ({ km, toKm, kind: v })),
  };
}

// ── Ograniczenie „tu i teraz” bez wyznaczonej trasy ─────────────────────────────────────────────────
// Ostatnie odczyty GPS (kilkaset metrów jazdy) dopasowujemy do mapy tak samo jak trasę — kierunek wynika z kolejności
// punktów, więc wiadukt czy jezdnia obok nie mylą. Ograniczenie bierzemy z końca śladu (miejsce, w którym jesteśmy).

/** Najwięcej punktów śladu w jednym zapytaniu. */
export const HERE_MAX_POINTS = 30;

/** [[lat, lon], …] → punkty [lat, lon, km] z narastającą odległością. */
export function tracePoints(list) {
  const out = [];
  for (const [lat, lon] of list) {
    const prev = out[out.length - 1];
    const km = prev ? prev[2] + distanceKm({ latitude: prev[0], longitude: prev[1] }, { latitude: lat, longitude: lon }) : 0;
    out.push([lat, lon, km]);
  }
  return out;
}

/** Krawędzie dopasowanego śladu → ograniczenia i rodzaj drogi na nim; `km` = koniec śladu (nasza pozycja). */
export function limitHere(pts, edges, zones) {
  const km = pts[pts.length - 1][2];
  return { km: round(km, 3), ...roadInfo([{ fromKm: 0, toKm: km, edges }], zones) };
}
