// Własny silnik tras RoadPilot: Valhalla na danych OpenStreetMap (Polska). Zapytanie dla ciężarówki i zamiana
// odpowiedzi na ten sam format co trasa TomTom (parseRoute) — HUD, ostrzeżenia i plan przerw działają bez zmian.

import { distanceKm } from "./nav.mjs";

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
export function valhallaRequest(from, to, v, exclude = [], alternates = 0) {
  return {
    ...(alternates > 0 ? { alternates } : {}),
    locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
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
  for (const m of leg.maneuvers ?? []) {
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
    });
  }

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
  };
}
