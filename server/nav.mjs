// Nawigacja dla ciężarówek (TomTom): budowa zapytań i zamiana odpowiedzi na zwarty format aplikacji.
// Czyste funkcje — pobieranie jest w index.mjs (klucz TomTom zostaje na serwerze).

const TOMTOM = "https://api.tomtom.com";

/** Rozsądne granice danych pojazdu — poza nimi TomTom i tak odrzuci zapytanie. */
export const VEHICLE_LIMITS = {
  heightM: [1, 5],
  widthM: [1, 3.5],
  lengthM: [2, 30],
  weightKg: [1000, 80000],
  axleWeightKg: [1000, 20000],
  axles: [2, 12],
  maxKmh: [30, 130],
};

const ADR_CODES = new Set(["B", "C", "D", "E"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export function validPoint(p) {
  const lat = num(p?.lat);
  const lon = num(p?.lon);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

/** Dane pojazdu z aplikacji → parametry TomTom (poza granicami → błąd z nazwą pola). */
export function vehicleParams(v) {
  const out = new URLSearchParams({ travelMode: "truck", vehicleCommercial: "true" });
  const field = (key, param) => {
    const x = num(v?.[key]);
    const [min, max] = VEHICLE_LIMITS[key];
    if (!(x >= min && x <= max)) throw new Error(`Nieprawidłowe dane pojazdu: ${key}`);
    out.set(param, String(x));
  };
  field("heightM", "vehicleHeight");
  field("widthM", "vehicleWidth");
  field("lengthM", "vehicleLength");
  field("weightKg", "vehicleWeight");
  field("axleWeightKg", "vehicleAxleWeight");
  field("axles", "vehicleNumberOfAxles");
  field("maxKmh", "vehicleMaxSpeed");
  if (v?.adr && v.adr !== "none") {
    if (!ADR_CODES.has(v.adr)) throw new Error("Nieprawidłowa kategoria tunelowa ADR.");
    out.set("vehicleAdrTunnelRestrictionCode", v.adr);
    out.set("vehicleLoadType", "otherHazmatGeneral");
  }
  return out;
}

/** `alternatives` — ile tras alternatywnych (TomTom liczy je w tym samym zapytaniu, bez dodatkowego kosztu). */
export function routeUrl(from, to, vehicle, key, alternatives = 0) {
  const q = vehicleParams(vehicle);
  if (alternatives > 0) q.set("maxAlternatives", String(alternatives));
  q.set("key", key);
  q.set("traffic", "true");
  q.set("routeType", "fastest");
  q.set("instructionsType", "tagged");
  q.set("language", "pl-PL");
  for (const s of ["motorway", "urban", "lanes", "speedLimit", "traffic"]) q.append("sectionType", s);
  return `${TOMTOM}/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json?${q}`;
}

export function searchUrl(query, near, key) {
  const q = new URLSearchParams({ key, limit: "6", language: "pl-PL", typeahead: "true" });
  if (near) {
    q.set("lat", String(near.lat));
    q.set("lon", String(near.lon));
  }
  return `${TOMTOM}/search/2/search/${encodeURIComponent(query)}.json?${q}`;
}

/** Wyniki wyszukiwania → { label, sub, lat, lon }. */
export function parseSearch(json) {
  return (json?.results ?? [])
    .filter((r) => r?.position && typeof r.position.lat === "number")
    .map((r) => {
      const address = r.address?.freeformAddress ?? "";
      const name = r.poi?.name;
      return {
        label: name || address || "Bez nazwy",
        sub: [name ? address : "", r.address?.country].filter(Boolean).join(", "),
        lat: r.position.lat,
        lon: r.position.lon,
      };
    });
}

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
export function distanceKm(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "");

/** Co ile km zostawiamy punkt geometrii (plus punkty manewrów i pasów). */
const POINT_EVERY_KM = 0.05;

/**
 * Odpowiedź calculateRoute → trasa aplikacji: długość, czas, odcinki wg typu drogi (dla silnika przerw),
 * geometria z km od startu, manewry, pasy ruchu, ograniczenia prędkości i korki (do HUD). `idx` — która z tras (alternatywy).
 */
export function parseRoute(json, idx = 0) {
  const r = json?.routes?.[idx];
  if (!r) return null;
  const pts = r.legs.flatMap((l, i) => (i === 0 ? l.points : l.points.slice(1)));
  const km = [0];
  for (let i = 1; i < pts.length; i++) km.push(km[i - 1] + distanceKm(pts[i - 1], pts[i]));
  // Kilometry z geometrii skalujemy do długości z TomTom — różnica to tylko zaokrąglenia współrzędnych.
  const total = r.summary.lengthInMeters / 1000;
  const scale = km[km.length - 1] > 0 ? total / km[km.length - 1] : 1;
  for (let i = 0; i < km.length; i++) km[i] *= scale;

  const sections = r.sections ?? [];
  const kind = new Array(Math.max(0, pts.length - 1)).fill("rural");
  for (const s of sections) {
    const type = s.sectionType === "MOTORWAY" ? "motorway" : s.sectionType === "URBAN" ? "urban" : null;
    if (!type) continue;
    for (let i = s.startPointIndex; i < s.endPointIndex && i < kind.length; i++) kind[i] = type;
  }
  const segments = [];
  kind.forEach((type, i) => {
    const d = km[i + 1] - km[i];
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.km += d;
    else segments.push({ type, km: d });
  });

  const keep = new Set([0, pts.length - 1]);
  const instructions = (r.guidance?.instructions ?? []).map((g) => {
    keep.add(g.pointIndex);
    return {
      km: round(km[g.pointIndex] ?? g.routeOffsetInMeters / 1000, 3),
      maneuver: g.maneuver,
      text: stripTags(g.message),
      ...(g.street ? { street: g.street } : {}),
      ...(g.signpostText ? { signpost: g.signpostText } : {}),
      ...(g.exitNumber ? { exit: g.exitNumber } : {}),
      ...(g.roundaboutExitNumber ? { roundaboutExit: g.roundaboutExitNumber } : {}),
      ...(typeof g.turnAngleInDecimalDegrees === "number" ? { angle: g.turnAngleInDecimalDegrees } : {}),
    };
  });
  const lanes = sections
    .filter((s) => s.sectionType === "LANES" && Array.isArray(s.lanes))
    .map((s) => {
      keep.add(s.startPointIndex);
      return {
        km: round(km[s.startPointIndex], 3),
        toKm: round(km[s.endPointIndex] ?? km[s.startPointIndex], 3),
        lanes: s.lanes.map((l) => ({ dirs: l.directions ?? [], ...(l.follow ? { follow: l.follow } : {}) })),
      };
    });
  const speedLimits = sections
    .filter((s) => s.sectionType === "SPEED_LIMIT" && typeof s.maxSpeedLimitInKmh === "number")
    .map((s) => ({ km: round(km[s.startPointIndex], 3), toKm: round(km[s.endPointIndex], 3), kmh: s.maxSpeedLimitInKmh }));

  // Natężenie ruchu na trasie: korki, roboty, zamknięcia (z opóźnieniem i stopniem 1 = małe … 3 = duże, 4 = zamknięte).
  const traffic = sections
    .filter((s) => s.sectionType === "TRAFFIC")
    .map((s) => ({
      km: round(km[s.startPointIndex], 3),
      toKm: round(km[s.endPointIndex] ?? km[s.startPointIndex], 3),
      delayMin: round((s.delayInSeconds ?? 0) / 60, 1),
      // magnitudeOfDelay: 1 małe, 2 średnie, 3 duże, 4 = nieznane (np. roboty) → traktujemy jak małe.
      level: s.simpleCategory === "ROAD_CLOSURE" ? 4 : s.magnitudeOfDelay >= 1 && s.magnitudeOfDelay <= 3 ? s.magnitudeOfDelay : 1,
      cause: s.simpleCategory === "ROAD_WORK" ? "roadwork" : s.simpleCategory === "ROAD_CLOSURE" ? "closed" : "jam",
      ...(typeof s.effectiveSpeedInKmh === "number" ? { kmh: s.effectiveSpeedInKmh } : {}),
    }));

  const points = [];
  let lastKm = -Infinity;
  pts.forEach((p, i) => {
    if (keep.has(i) || km[i] - lastKm >= POINT_EVERY_KM) {
      points.push([round(p.latitude, 5), round(p.longitude, 5), round(km[i], 3)]);
      lastKm = km[i];
    }
  });

  return {
    // Prom na trasie — kierowca powinien o nim wiedzieć (rezerwacja, inny czas pracy).
    ferry: instructions.some((i) => i.maneuver === "TAKE_FERRY"),
    lengthKm: round(total, 3),
    travelMin: round(r.summary.travelTimeInSeconds / 60, 1),
    trafficMin: round((r.summary.trafficDelayInSeconds ?? 0) / 60, 1),
    segments: segments.filter((s) => s.km > 0.001).map((s) => ({ type: s.type, km: round(s.km, 3) })),
    points,
    instructions,
    lanes,
    speedLimits,
    traffic,
  };
}

/** Wszystkie trasy z odpowiedzi (pierwsza = najlepsza, potem alternatywy). */
export function parseRoutes(json) {
  return (json?.routes ?? []).map((_, i) => parseRoute(json, i)).filter(Boolean);
}

/** Komunikat błędu TomTom dla kierowcy (np. brak trasy przez ograniczenia pojazdu). */
export function routeError(json) {
  const msg = json?.error?.description ?? json?.detailedError?.message ?? "";
  if (/no route|NO_ROUTE_FOUND|unreachable/i.test(msg)) return "Nie ma trasy dla tego pojazdu — sprawdź wymiary, masę i ADR.";
  return "Nie udało się wyznaczyć trasy. Spróbuj ponownie za chwilę.";
}
