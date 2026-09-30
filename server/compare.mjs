// Porównanie zgłoszeń kierowców z OpenStreetMap — gdzie OSM nie ma danych albo ma inne. Czyste funkcje.

/** Rodzaj zgłoszenia → rodzaj ograniczenia w OSM. Parking / inne / zamknięcie nie mają odpowiednika. */
export const REPORT_TO_OSM = { height: "height", weight: "weight", speed: "speed_hgv", truck_ban: "hgv" };

const M_PER_DEG = 111_320;
/** Tak blisko (m) szukamy odpowiednika w OSM i innych zgłoszeń w tym samym miejscu. */
export const MATCH_M = 60;

export function metres(a, b) {
  const kx = M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * M_PER_DEG);
}

function distToFeature(r, f) {
  const pts = Array.isArray(f.geom) && f.geom.length ? f.geom.map(([lat, lon]) => ({ lat, lon })) : [f];
  return Math.min(...pts.map((p) => metres(r, p)));
}

/**
 * Zgłoszenia + ograniczenia OSM z okolicy → pozycje porównania: status missing / match / diff / info,
 * liczba potwierdzeń (zgłoszenia tego samego rodzaju w promieniu MATCH_M, także od innych kierowców).
 */
export function compareReports(reports, osm) {
  const used = new Set();
  const out = [];
  for (const r of reports) {
    if (used.has(r.id)) continue;
    const same = reports.filter((o) => o.kind === r.kind && metres(r, o) <= MATCH_M);
    same.forEach((o) => used.add(o.id));
    const osmKind = REPORT_TO_OSM[r.kind];
    const item = { id: r.id, kind: r.kind, value: r.value, lat: r.lat, lon: r.lon, at: r.at, confirmations: same.length, drivers: new Set(same.map((o) => o.userId)).size };
    if (!osmKind) {
      out.push({ ...item, status: "info" });
      continue;
    }
    const near = osm.filter((f) => f.kind === osmKind).map((f) => ({ f, d: distToFeature(r, f) })).filter((x) => x.d <= MATCH_M).sort((a, b) => a.d - b.d)[0];
    if (!near) {
      out.push({ ...item, status: "missing" });
      continue;
    }
    const f = near.f;
    const match = r.value === null || f.value === null || Math.abs(Number(f.value) - Number(r.value)) < (r.kind === "speed" ? 1 : 0.15);
    out.push({ ...item, status: match ? "match" : "diff", osmId: f.id, osmValue: f.value === null ? null : Number(f.value), osmRaw: f.raw, distM: Math.round(near.d) });
  }
  // Najpierw to, co warto poprawić w mapie: brak w OSM i różnice, potem zgodne.
  const rank = { missing: 0, diff: 1, info: 2, match: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.confirmations - a.confirmations || b.at - a.at);
}
