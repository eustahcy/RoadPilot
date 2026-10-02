// Zbieranie danych do własnej mapy (za zgodą kierowcy): walidacja punktów śladu i zgłoszeń. Czyste funkcje.

/** Polska z małym zapasem — poza nią nic nie zapisujemy. */
export const POLAND = { minLat: 48.95, maxLat: 54.95, minLon: 14.05, maxLon: 24.2 };

export const inPoland = (lat, lon) => lat >= POLAND.minLat && lat <= POLAND.maxLat && lon >= POLAND.minLon && lon <= POLAND.maxLon;

export const REPORT_KINDS = {
  camera: { label: "Fotoradar" },
  section: { label: "Odcinkowy pomiar prędkości" },
  police: { label: "Kontrola policji" },
  itd: { label: "Kontrola ITD" },
  height: { label: "Niski wiadukt / most", unit: "m", min: 1.5, max: 6 },
  weight: { label: "Ograniczenie tonażu", unit: "t", min: 1, max: 60 },
  speed: { label: "Ograniczenie prędkości", unit: "km/h", min: 5, max: 140 },
  truck_ban: { label: "Zakaz dla ciężarówek" },
  closed: { label: "Droga zamknięta" },
  roadworks: { label: "Roboty drogowe / przebudowa" },
  parking: { label: "Parking dla ciężarówek" },
  mop: { label: "MOP — miejsce obsługi podróżnych" },
  fuel: { label: "Stacja paliw" },
  gate: { label: "Wjazd dla ciężarówek (brama przy celu)" },
  bad_turn: { label: "Zły manewr — tu nie da się skręcić" },
  other: { label: "Inne" },
};

const MAX_POINTS = 1000;

/**
 * Punkty [t(ms), lat, lon, kmh|null, heading|null] → wiersze do zapisu. Odrzuca punkty spoza Polski,
 * z przyszłości / starsze niż 7 dni i z nieprawdopodobną prędkością.
 */
export function cleanPoints(points, now) {
  if (!Array.isArray(points) || points.length > MAX_POINTS) throw new Error(`Maksymalnie ${MAX_POINTS} punktów naraz.`);
  const out = [];
  for (const p of points) {
    if (!Array.isArray(p)) continue;
    const [t, lat, lon, kmh, heading] = p.map((x) => (x === null ? null : Number(x)));
    if (!Number.isFinite(t) || t > now + 60_000 || t < now - 7 * 86_400_000) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inPoland(lat, lon)) continue;
    const speed = Number.isFinite(kmh) && kmh >= 0 && kmh <= 160 ? Math.round(kmh) : null;
    const dir = Number.isFinite(heading) && heading >= 0 && heading < 360 ? Math.round(heading) : null;
    out.push([t, Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, speed, dir]);
  }
  return out;
}

/** Zgłoszenie z aplikacji → wiersz; błąd z opisem dla nieprawidłowych danych. */
export function cleanReport(r) {
  const kind = String(r?.kind ?? "");
  const def = REPORT_KINDS[kind];
  if (!def) throw new Error("Nieznany rodzaj zgłoszenia.");
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Brak pozycji.");
  if (!inPoland(lat, lon)) throw new Error("Zgłoszenia zbieramy na razie tylko w Polsce.");
  let value = null;
  if (def.unit) {
    value = Number(r.value);
    if (!(value >= def.min && value <= def.max)) throw new Error(`Podaj wartość ${def.min}–${def.max} ${def.unit}.`);
  }
  const heading = Number.isFinite(Number(r.heading)) && r.heading !== null ? Math.round(Number(r.heading)) % 360 : null;
  return { kind, lat, lon, heading, value, note: String(r.note ?? "").trim().slice(0, 200) };
}
