// Parking przy celu („czy da się stanąć koło firmy?”): opinie kierowców przypięte do miejsca na mapie
// i potwierdzenia innych (👍 / 👎). Bez bazy — czyste funkcje (testy w parking.test.mjs); SQL jest w index.mjs.

/** Opinie w tym promieniu od celu nawigacji uznajemy za „przy tej firmie”. */
export const PARKING_RADIUS_M = 300;
/** Ile opinii jeden kierowca może dodać / zmienić w ciągu doby. */
export const PARKING_DAILY_MAX = 30;

/** 2 = jest parking dla ciężarówek, 1 = ograniczony (mało miejsc, płatny, krótko), 0 = brak — staje się na ulicy / w zatoce. */
export const PARKING_STATUSES = new Set([0, 1, 2]);

const num = (v, min, max) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Opinia z aplikacji → to, co zapisujemy. Rzuca Error z komunikatem po polsku. */
export function cleanParking(body) {
  const b = body ?? {};
  const lat = num(b.lat, -90, 90);
  const lon = num(b.lon, -180, 180);
  if (lat === undefined || lon === undefined) throw new Error("Brak położenia celu.");
  const status = Number(b.status);
  if (!PARKING_STATUSES.has(status)) throw new Error("Wybierz, czy jest parking.");
  return {
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    label: text(b.label, 120),
    status,
    note: text(b.note, 280),
  };
}

/** Prostokąt (lat/lon) obejmujący okrąg o promieniu `m` metrów — do zapytania SQL, potem dokładny dystans. */
export function boxAround(lat, lon, m) {
  const dLat = m / 111_320;
  const dLon = m / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

export function distanceM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

/**
 * Wiersze z bazy (opinia + sumy głosów + głos pytającego) → lista dla aplikacji: tylko w promieniu,
 * najpierw najlepiej potwierdzone, potem najnowsze. Autor anonimowy — widać tylko, czy to moja opinia.
 */
export function parkingView(rows, at, userId) {
  const items = rows
    .map((r) => ({
      id: Number(r.id),
      status: Number(r.status),
      note: r.note ?? "",
      label: r.label ?? "",
      distanceM: Math.round(distanceM(at, { lat: Number(r.lat), lon: Number(r.lon) })),
      at: new Date(r.updated_at).getTime(),
      up: Number(r.up ?? 0),
      down: Number(r.down ?? 0),
      myVote: Number(r.my_vote ?? 0),
      mine: Number(r.user_id) === userId,
    }))
    .filter((o) => o.distanceM <= PARKING_RADIUS_M)
    .sort((a, b) => b.up - b.down - (a.up - a.down) || b.at - a.at);
  const summary = { yes: 0, limited: 0, no: 0 };
  for (const o of items) {
    // Opinia, którą więcej osób zaprzeczyło niż potwierdziło, nie liczy się do podsumowania.
    if (o.down > o.up) continue;
    if (o.status === 2) summary.yes++;
    else if (o.status === 1) summary.limited++;
    else summary.no++;
  }
  return { items, summary };
}
