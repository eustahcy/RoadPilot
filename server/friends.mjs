// Znajomi: sprawdzanie danych obecności wysyłanych przez aplikację i składanie widoku znajomego dla drugiej strony.
// Bez bazy — czyste funkcje (testy w friends.test.mjs); zapytania SQL są w index.mjs.

/** Po tylu ms bez odświeżenia obecność jest nieaktualna (aplikacja zamknięta, brak sieci) — znajomy widzi ją jako „ostatnio”. */
export const PRESENCE_TTL_MS = 10 * 60_000;
/** Ostatnią pozycję pokazujemy najwyżej tyle po zamknięciu aplikacji. */
export const LAST_SEEN_MAX_MS = 7 * 86_400_000;

export const PRESENCE_STATUSES = new Set(["driving", "standing", "break", "rest", "dayEnd"]);

const num = (v, min, max) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Obecność z aplikacji → to, co zapisujemy (i co zobaczą znajomi). Pozycja z dokładnością do ~10 m.
 * Rzuca Error z komunikatem po polsku przy braku pozycji lub nieznanym statusie.
 */
export function cleanPresence(body, now) {
  const b = body ?? {};
  const lat = num(b.lat, -90, 90);
  const lon = num(b.lon, -180, 180);
  if (lat === undefined || lon === undefined) throw new Error("Brak pozycji.");
  const status = String(b.status ?? "");
  if (!PRESENCE_STATUSES.has(status)) throw new Error("Nieznany status.");
  const since = num(b.since, 0, now + 60_000);
  return {
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
    kmh: num(b.kmh, 0, 300) !== undefined ? Math.round(b.kmh) : null,
    heading: num(b.heading, 0, 360) !== undefined ? Math.round(b.heading) : null,
    status,
    /** Od kiedy trwa jazda / postój (ms). */
    since: since !== undefined ? Math.round(since) : null,
    /** Planowana długość postoju (min) — null = do ruszenia. */
    targetMin: num(b.targetMin, 0, 24 * 60 * 7) !== undefined ? Math.round(b.targetMin) : null,
    dest: text(b.dest, 120),
    /** Przewidywany przyjazd (ms) i km do celu. */
    arrival: num(b.arrival, 0, now + 30 * 86_400_000) !== undefined ? Math.round(b.arrival) : null,
    leftKm: num(b.leftKm, 0, 100_000) !== undefined ? Math.round(b.leftKm) : null,
    /** Tachograf: ile zostało jazdy dziś i do przerwy (min). */
    driveLeftMin: num(b.driveLeftMin, -600, 600) !== undefined ? Math.round(b.driveLeftMin) : null,
    untilBreakMin: num(b.untilBreakMin, -600, 600) !== undefined ? Math.round(b.untilBreakMin) : null,
  };
}

/**
 * Wiersz z bazy (users + friends + presence) → znajomy w odpowiedzi API.
 * `relation`: accepted = widzimy się nawzajem; invited = my zaprosiliśmy, czeka; pending = zaprosili nas, do akceptacji.
 * Obecność tylko dla zaakceptowanych; starsza niż PRESENCE_TTL_MS ma offline: true (ostatnia znana), starsza niż LAST_SEEN_MAX_MS → null.
 * Wyłączenie udostępniania kasuje obecność, więc wtedy też null.
 */
export function friendView(row, me, now) {
  const relation = row.accepted_at ? "accepted" : row.user_id === me ? "invited" : "pending";
  let presence = null;
  if (relation === "accepted" && row.presence) {
    const at = new Date(row.presence_at).getTime();
    if (now - at <= LAST_SEEN_MAX_MS) {
      try {
        presence = { ...JSON.parse(row.presence), at, ...(now - at > PRESENCE_TTL_MS ? { offline: true } : {}) };
      } catch {
        presence = null;
      }
    }
  }
  return { id: row.user_id === me ? row.friend_id : row.user_id, name: row.name || row.email.split("@")[0], email: row.email, relation, presence };
}
