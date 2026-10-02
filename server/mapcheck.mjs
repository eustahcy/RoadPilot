// Błędy mapy z jazdy kierowców: ograniczenia, przez które przejechali kierowcy z pojazdem, którego one nie dopuszczają
// (podejrzane — do sprawdzenia przez admina), i manewry zgłaszane jako niemożliwe („zły manewr”). Czyste funkcje;
// zadanie: suspects-build.mjs, testy: mapcheck.test.mjs.

const M_PER_DEG = 111_320;
/** Odczyt bliżej ograniczenia niż tyle metrów i w kierunku drogi (±PASS_DEG) = przejazd przez nie. */
const PASS_M = 15;
const PASS_DEG = 30;
/** Ograniczenie jest podejrzane, gdy przejechało przez nie tylu różnych kierowców, których pojazd go nie spełnia. */
export const SUSPECT_USERS = 3;
/** Zgłoszenia „zły manewr” bliżej niż tyle metrów i w kierunku ±BAD_TURN_DEG to ten sam manewr. */
const BAD_TURN_M = 30;
const BAD_TURN_DEG = 30;
/** Manewr omijamy, gdy zgłosiło go tylu różnych kierowców. */
export const BAD_TURN_USERS = 2;

const kxOf = (lat) => M_PER_DEG * Math.cos((lat * Math.PI) / 180);
const angleDiff = (a, b) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return Math.min(d, 360 - d); };
const bearing = (a, b) => ((Math.atan2((b[1] - a[1]) * kxOf(a[0]), b[0] - a[0]) * 180) / Math.PI + 360) % 360;

/** Czy pojazd nie spełnia ograniczenia (pojazd z ustawień konta: heightM, weightKg). */
export function violates(r, v) {
  if (r.kind === "height") return v.heightM > Number(r.value);
  if (r.kind === "weight") return v.weightKg / 1000 > Number(r.value);
  if (r.kind === "hgv") return r.raw === "no";
  return false;
}

/** Odległość odczytu od łamanej ograniczenia (m) i kierunek najbliższego odcinka (stopnie, bez zwrotu → porównujemy ±180). */
function nearGeom(p, geom) {
  let best = { d: Infinity, axis: 0 };
  const kx = kxOf(p.lat);
  for (let i = 0; i < geom.length - 1; i++) {
    const [a, b] = [geom[i], geom[i + 1]];
    const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * M_PER_DEG;
    const px = (p.lon - a[1]) * kx, py = (p.lat - a[0]) * M_PER_DEG;
    const l2 = bx * bx + by * by;
    const t = l2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best.d) best = { d, axis: bearing(a, b) };
  }
  return best;
}

/**
 * Ograniczenia z łamaną ({ key, kind, value, raw, geom: [[lat, lon], …] }) i odczyty kierowców ({ user, lat, lon, heading,
 * kmh }) z pojazdami (Map user → vehicle) → klucz ograniczenia → zbiór kierowców, którzy przejechali przez nie wzdłuż drogi,
 * choć ich pojazd go nie spełnia. Ograniczenia punktowe (bez łamanej) pomijamy — kierunku drogi nie znamy.
 */
export function suspectPasses(restrictions, points, vehicles) {
  const out = new Map();
  for (const r of restrictions) {
    if (!Array.isArray(r.geom) || r.geom.length < 2) continue;
    for (const p of points) {
      const v = vehicles.get(p.user);
      if (!v || p.heading === null || p.heading === undefined || !(p.kmh > 5) || !violates(r, v)) continue;
      const n = nearGeom(p, r.geom);
      if (n.d > PASS_M) continue;
      if (Math.min(angleDiff(p.heading, n.axis), angleDiff(p.heading, n.axis + 180)) > PASS_DEG) continue;
      const set = out.get(r.key) ?? new Set();
      set.add(p.user);
      out.set(r.key, set);
    }
  }
  return out;
}

/**
 * Zgłoszenia „zły manewr” ({ user, lat, lon, heading }) → grupy tego samego manewru z liczbą różnych kierowców;
 * `confirmed` = co najmniej BAD_TURN_USERS kierowców (silnik omija punkt za manewrem).
 */
export function badTurnClusters(reports) {
  const groups = [];
  for (const r of reports) {
    const g = groups.find((x) => Math.hypot((x.lat - r.lat) * M_PER_DEG, (x.lon - r.lon) * kxOf(r.lat)) <= BAD_TURN_M && (x.heading === null || r.heading === null || angleDiff(x.heading, r.heading) <= BAD_TURN_DEG));
    if (g) { g.users.add(r.user); g.notes.add(r.note ?? ""); }
    else groups.push({ lat: r.lat, lon: r.lon, heading: r.heading ?? null, users: new Set([r.user]), notes: new Set([r.note ?? ""]) });
  }
  return groups.map((g) => ({ lat: g.lat, lon: g.lon, heading: g.heading, users: g.users.size, note: [...g.notes].filter(Boolean)[0] ?? "", confirmed: g.users.size >= BAD_TURN_USERS }));
}
