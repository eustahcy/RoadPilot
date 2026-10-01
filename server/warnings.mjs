// Ostrzeżenia na trasie z naszych danych (OSM + zgłoszenia kierowców): ograniczenia, których pojazd nie spełnia.
// Czyste funkcje — zapytania do bazy są w index.mjs (po prostokątach wzdłuż trasy).

import { conditionNote, effectiveRestriction } from "./conditional.mjs";

const M_PER_DEG = 111_320;

/** Kiedy ograniczenie dotyczy pojazdu: wartość poniżej parametru pojazdu (albo zakaz / zamknięcie). */
export const CONFLICT = {
  height: (v, veh) => v < veh.heightM,
  weight: (v, veh) => v < veh.weightKg / 1000,
  axle: (v, veh) => v < veh.axleWeightKg / 1000,
  width: (v, veh) => v < veh.widthM,
  length: (v, veh) => v < veh.lengthM,
  hgv: () => true,
  truck_ban: () => true,
  closed: () => true,
  // Stromy odcinek dotyczy każdej ciężarówki (import bierze tylko ≥ 8%) — ostrzegamy, nie omijamy.
  incline: () => true,
};

/** Punkt „na trasie”: bliżej niż tyle metrów (punkty, np. znak lub bramka). */
const NEAR_POINT_M = 20;
/** Odcinek drogi z ograniczeniem musi biec wzdłuż trasy: co najmniej 2 i ALONG_SHARE jego punktów bliżej niż ALONG_M
 *  i w tym samym kierunku (±ALONG_DEG) — inaczej to most nad naszą drogą albo przecinająca ją droga na węźle. */
const ALONG_M = 25;
const ALONG_SHARE = 0.6;
const ALONG_DEG = 30;

/** Kierunek odcinka a→b (stopnie, 0–180 — bez zwrotu: droga w obie strony). */
function axis(aLat, aLon, bLat, bLon) {
  const kx = Math.cos((aLat * Math.PI) / 180);
  return ((Math.atan2((bLon - aLon) * kx, bLat - aLat) * 180) / Math.PI + 360) % 180;
}

/** Ograniczenie wysokości na moście „przepisane” z drogi pod nim: droga bez mostu z tą samą wartością bliżej niż tyle metrów. */
const BRIDGE_COPY_M = 40;

/** Punkty obiektu: łamana z geom ([[lat, lon], …]) albo sam punkt. */
const rowPoints = (r) => (Array.isArray(r.geom) && r.geom.length ? r.geom : [[r.lat, r.lon]]);

/** Najmniejsza odległość (m) między punktami jednej łamanej a odcinkami drugiej. */
function polyDistM(a, b) {
  let best = Infinity;
  for (const [lat, lon] of a) {
    const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < Math.max(1, b.length - 1); i++) {
      const [p, q] = [b[i], b[Math.min(i + 1, b.length - 1)]];
      const bx = (q[1] - p[1]) * kx, by = (q[0] - p[0]) * M_PER_DEG;
      const px = (lon - p[1]) * kx, py = (lat - p[0]) * M_PER_DEG;
      const l2 = bx * bx + by * by;
      const t = l2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
      best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
    }
  }
  return best;
}

/**
 * Częsty błąd w OSM: maxheight wiaduktu pod spodem wpisany na sam most (np. Estakada Kwiatkowskiego w Gdyni ma 3,5 m
 * jak ulica Leszczynki pod nią). Ograniczenie wysokości na moście pomijamy, gdy tuż obok jest droga bez mostu z tą samą
 * wartością — prawdziwe ograniczenia na mostach (konstrukcja nad jezdnią) zostają.
 */
export function dropCopiedBridgeHeights(rows) {
  const below = rows.filter((r) => r.kind === "height" && !r.bridge);
  return rows.filter((r) => !(r.kind === "height" && r.bridge && below.some((u) => Number(u.value) === Number(r.value) && polyDistM(rowPoints(r), rowPoints(u)) <= BRIDGE_COPY_M)));
}

/** Odległość punktu od łamanej trasy (m) i km trasy w najbliższym miejscu. Trasa: [lat, lon, km][]. */
export function nearest(route, lat, lon, from = 0, to = route.length - 1) {
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  let best = { d: Infinity, km: 0, i: 0 };
  for (let i = Math.max(0, from); i < Math.min(to, route.length - 1); i++) {
    const [aLat, aLon, aKm] = route[i];
    const [bLat, bLon, bKm] = route[i + 1];
    const bx = (bLon - aLon) * kx, by = (bLat - aLat) * M_PER_DEG;
    const px = (lon - aLon) * kx, py = (lat - aLat) * M_PER_DEG;
    const l2 = bx * bx + by * by;
    const t = l2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best.d) best = { d, km: aKm + t * (bKm - aKm), i };
  }
  return best;
}

/** Prostokąty (z zapasem) wzdłuż trasy co ~`chunkKm` — do zapytań w bazie po indeksie (lat, lon). */
export function routeBoxes(route, chunkKm = 25, padDeg = 0.003) {
  const boxes = [];
  let cur = null;
  route.forEach(([lat, lon, km], i) => {
    if (!cur || km - cur.startKm > chunkKm) {
      if (cur) boxes.push(cur);
      cur = { startKm: km, from: Math.max(0, i - 1), to: i, minLat: lat, maxLat: lat, minLon: lon, maxLon: lon };
    }
    cur.to = i;
    cur.minLat = Math.min(cur.minLat, lat); cur.maxLat = Math.max(cur.maxLat, lat);
    cur.minLon = Math.min(cur.minLon, lon); cur.maxLon = Math.max(cur.maxLon, lon);
  });
  if (cur) boxes.push(cur);
  return boxes.map((b) => ({ ...b, minLat: b.minLat - padDeg, maxLat: b.maxLat + padDeg, minLon: b.minLon - padDeg * 1.6, maxLon: b.maxLon + padDeg * 1.6 }));
}

/**
 * Ograniczenia (wiersze z osm_restrictions lub road_reports) → ostrzeżenia z km trasy, posortowane.
 * row: { source: "osm" | "report", id, kind, value, lat, lon, geom?, name? }; box: zakres punktów trasy do szukania.
 */
export function routeWarnings(route, rows, vehicle, box) {
  const out = [];
  for (const r of rows) {
    const conflict = CONFLICT[r.kind];
    // Ograniczenie z warunkiem (godziny, „nie dotyczy dojazdu”) dopasowujemy zawsze — czy obowiązuje, ocenia applyConditions.
    const cond = typeof r.cond === "string" ? JSON.parse(r.cond) : r.cond;
    if (!conflict || (!cond?.length && !conflict(r.value === null ? null : Number(r.value), vehicle))) continue;
    const from = box ? box.from - 2 : 0;
    const to = box ? box.to + 2 : route.length - 1;
    let hit;
    if (Array.isArray(r.geom) && r.geom.length > 1) {
      const near = r.geom.map(([la, lo]) => nearest(route, la, lo, from, to));
      const idx = near.map((n, k) => (n.d <= ALONG_M ? k : -1)).filter((k) => k >= 0);
      if (idx.length < 2 || idx.length < r.geom.length * ALONG_SHARE) continue;
      // Kierunek fragmentu ograniczenia przy trasie vs kierunek trasy w tym miejscu.
      const [a, b] = [r.geom[idx[0]], r.geom[idx[idx.length - 1]]];
      const ri = near[idx[0]].i;
      const [ra, rb] = [route[ri], route[Math.min(route.length - 1, ri + 1)]];
      const diff = Math.abs(axis(a[0], a[1], b[0], b[1]) - axis(ra[0], ra[1], rb[0], rb[1]));
      if (Math.min(diff, 180 - diff) > ALONG_DEG) continue;
      const along = idx.map((k) => near[k]);
      hit = along.reduce((x, y) => (x.km < y.km ? x : y));
    } else {
      hit = nearest(route, r.lat, r.lon, from, to);
      if (hit.d > NEAR_POINT_M) continue;
    }
    // Punkt na trasie, w którym przechodzi ona przez ograniczenie — tu wykluczamy przy liczeniu objazdu.
    const [pa, pb] = [route[hit.i], route[Math.min(route.length - 1, hit.i + 1)]];
    const t = pb[2] > pa[2] ? (hit.km - pa[2]) / (pb[2] - pa[2]) : 0;
    const at = { lat: pa[0] + t * (pb[0] - pa[0]), lon: pa[1] + t * (pb[1] - pa[1]) };
    out.push({ km: Math.round(hit.km * 1000) / 1000, source: r.source, id: String(r.id), kind: r.kind, value: r.value === null ? null : Number(r.value), raw: r.raw ?? "", name: r.name ?? "", lat: r.lat, lon: r.lon, at, ...(cond?.length ? { cond } : {}) });
  }
  // Ten sam rodzaj ograniczenia w odstępie < 150 m to jedno miejsce (np. obie jezdnie, znak i droga).
  out.sort((a, b) => a.km - b.km);
  return out.filter((w, i) => !out.slice(0, i).some((p) => p.kind === w.kind && w.km - p.km < 0.15));
}

/** Rodzaje, których pojazd fizycznie / prawnie nie może przejechać — silnik RoadPilot omija je ponownym liczeniem trasy. */
const HARD = new Set(["height", "weight", "axle", "width", "length", "hgv", "truck_ban", "closed"]);
/** Zakaz tranzytu (dojazd dozwolony) nie blokuje ostatnich tylu km — cel może leżeć w strefie. */
const DESTINATION_KM = 3;
/** Kolejne odcinki strefy „tylko dojazd” mogą być od siebie tyle km — dalej to już inna strefa (tranzyt). */
const ZONE_GAP_KM = 1.5;

/**
 * Ograniczenia warunkowe i „tylko dojazd” w chwili przejazdu: `timeAt(km)` — kiedy będziemy w tym miejscu (ms),
 * `destKm` — km celu; przy celu albo starcie (DESTINATION_KM) jesteśmy „dojazdem”. Obowiązujące zostają, nieobowiązujące
 * stają się miękką informacją (`soft`, nie zmieniają trasy) z opisem warunku (`note`), bez znaczenia dla nas — znikają.
 */
export function applyConditions(warnings, { timeAt, destKm, startKm = 0, weightT }) {
  const out = [];
  // Strefa „tylko dojazd” = ciąg takich ograniczeń (przerwy ≤ ZONE_GAP_KM) dochodzący do celu albo startu — cały jest dojazdem.
  const exempt = (w) => (w.kind === "hgv" && (w.raw === "destination" || w.raw === "delivery")) || w.cond?.some((c) => c.users?.some((u) => u === "destination" || u === "delivery"));
  const zone = new Set();
  let edge = destKm - DESTINATION_KM;
  for (const w of [...warnings].filter(exempt).sort((a, b) => b.km - a.km)) if (w.km >= edge - ZONE_GAP_KM) { zone.add(w); edge = Math.min(edge, w.km); }
  edge = startKm + DESTINATION_KM;
  for (const w of [...warnings].filter(exempt).sort((a, b) => a.km - b.km)) if (w.km <= edge + ZONE_GAP_KM) { zone.add(w); edge = Math.max(edge, w.km); }
  for (const w of warnings) {
    const transit = w.kind === "hgv" && (w.raw === "destination" || w.raw === "delivery");
    if (!w.cond && !transit) { out.push(w); continue; }
    const nearDest = zone.has(w) || destKm - w.km <= DESTINATION_KM || w.km - startKm <= DESTINATION_KM;
    const base = w.kind === "weight" ? w.value : w.raw || null;
    const e = effectiveRestriction(w.kind, base, w.cond, { t: timeAt(w.km), nearDest, weightT });
    const note = conditionNote(w.cond);
    const { cond, ...rest } = w;
    if (e.active) { out.push({ ...rest, ...(note ? { note } : {}) }); continue; }
    if (nearDest && (transit || cond?.some((c) => c.users?.some((u) => u === "destination" || u === "delivery")))) out.push({ ...rest, soft: true, note: "tylko dojazd — cel w strefie" });
    else if (note && cond?.some((c) => c.time)) out.push({ ...rest, soft: true, note: `${note} — w chwili przejazdu nie obowiązuje` });
  }
  return out;
}

/**
 * Ostrzeżenia → punkty do wykluczenia z trasy (Valhalla exclude_locations). Pomija zakaz tranzytu przy celu i miękkie (soft).
 * `lengthKm` — długość trasy.
 */
export function blockingPoints(warnings, lengthKm) {
  return warnings
    .filter((w) => HARD.has(w.kind) && !w.soft)
    .filter((w) => !(w.kind === "hgv" && (w.raw === "destination" || w.raw === "delivery") && lengthKm - w.km <= DESTINATION_KM && !w.note))
    .map((w) => ({ lat: w.at?.lat ?? w.lat, lon: w.at?.lon ?? w.lon, key: `${w.source}:${w.id}:${w.kind}` }));
}

// ── Fotoradary, odcinkowe pomiary, kontrole (ostrzeżenia bez względu na pojazd) ─────────────────────────────

/** Rodzaje „uważaj na prędkość” — tylko ostrzegamy, nie omijamy. Kontrole ze zgłoszeń żyją ALERT_TTL_H. */
export const ALERT_KINDS = new Set(["camera", "red_light", "section", "police", "itd"]);
export const ALERT_TTL_H = { police: 3, itd: 3, camera: 24 * 365, section: 24 * 365 };
/** Urządzenie stoi obok jezdni — dalej niż przy znakach; kierunek jazdy zgodny z trasą z tolerancją ±ALERT_DEG. */
const ALERT_NEAR_M = 30;
const ALERT_DEG = 60;

/** Kierunek a→b (stopnie 0–360, 0 = północ). */
function bearing(aLat, aLon, bLat, bLon) {
  const kx = Math.cos((aLat * Math.PI) / 180);
  return ((Math.atan2((bLon - aLon) * kx, bLat - aLat) * 180) / Math.PI + 360) % 360;
}
const angleDiff = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
/** Kierunek trasy w punkcie `i` (odcinek i → i+1). */
const routeBearing = (route, i) => {
  const [a, b] = [route[Math.min(i, route.length - 2)], route[Math.min(i + 1, route.length - 1)]];
  return bearing(a[0], a[1], b[0], b[1]);
};

/**
 * Fotoradary / odcinkowe pomiary (osm_enforcement) i zgłoszenia (camera, section, police, itd) → ostrzeżenia z km trasy.
 * row: { source, id, kind, value, lat, lon, from_lat?, from_lon?, to_lat?, to_lon?, heading?, name? }.
 * Kierunek: z węzła „from” relacji OSM albo z kierunku jazdy zgłaszającego — przeciwny pas pomijamy.
 * Odcinkowy: początek i koniec na trasie, w tej kolejności → { km: początek, toKm: koniec }.
 */
export function routeAlerts(route, rows, box) {
  const from = box ? box.from - 2 : 0;
  const to = box ? box.to + 2 : route.length - 1;
  const out = [];
  for (const r of rows) {
    if (!ALERT_KINDS.has(r.kind)) continue;
    const hit = nearest(route, r.lat, r.lon, from, to);
    if (hit.d > ALERT_NEAR_M) continue;
    const dir = routeBearing(route, hit.i);
    let toKm;
    if (r.kind === "section" && r.to_lat != null) {
      const end = nearest(route, r.to_lat, r.to_lon, hit.i, route.length - 1);
      const straightKm = Math.hypot((r.to_lat - r.lat) * M_PER_DEG, (r.to_lon - r.lon) * M_PER_DEG * Math.cos((r.lat * Math.PI) / 180)) / 1000;
      if (end.d > ALERT_NEAR_M || end.km <= hit.km || end.km - hit.km > straightKm * 1.6 + 0.5) continue;
      toKm = Math.round(end.km * 1000) / 1000;
    } else if (r.from_lat != null && (r.from_lat !== r.lat || r.from_lon !== r.lon)) {
      if (angleDiff(bearing(r.from_lat, r.from_lon, r.lat, r.lon), dir) > ALERT_DEG) continue;
    } else if (r.heading != null && angleDiff(Number(r.heading), dir) > ALERT_DEG) {
      continue;
    }
    out.push({ km: Math.round(hit.km * 1000) / 1000, ...(toKm !== undefined && { toKm }), source: r.source, id: String(r.id), kind: r.kind, value: r.value === null || r.value === undefined ? null : Number(r.value), raw: "", name: r.name ?? "", lat: r.lat, lon: r.lon });
  }
  return out;
}

/** Stałe urządzenie (fotoradar, odcinek) znika, gdy tyle osób zagłosuje „nie ma” i jest ich ponad 2× więcej niż „jest”. */
const FIXED_GONE_DOWN = 3;
const FIXED_KINDS = new Set(["camera", "red_light", "section"]);

/**
 * Głosy kierowców → które ostrzeżenia zostają. votes: Map "source:id" → { up, down, lastUp, lastDown } (ms | null).
 * Kontrola (policja, ITD): znika, gdy ostatni głos to „nie ma” (odjechali). Stałe urządzenie: przy wyraźnej przewadze „nie ma”.
 */
export function applyVotes(alerts, votes) {
  return alerts.filter((w) => {
    const v = votes.get(`${w.source}:${w.id}`);
    if (!v) return true;
    if (FIXED_KINDS.has(w.kind)) return !(v.down >= FIXED_GONE_DOWN && v.down > 2 * v.up);
    return !(v.lastDown && (!v.lastUp || v.lastDown > v.lastUp));
  });
}
