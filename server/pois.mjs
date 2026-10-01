// Miejsca przy trasie do pinezek na mapie: stacje paliw, MOP-y i parkingi dla ciężarówek (OpenStreetMap, Polska).
// Import: scripts/osm-update.sh → osmium export → server/poi-import.mjs → tabela osm_pois. Czyste funkcje, testy w pois.test.mjs.

import { nearest } from "./warnings.mjs";

/** Miejsce dalej od trasy niż tyle metrów nie jest „przy trasie” (MOP z parkingiem bywa 150–250 m od osi jezdni). */
export const POI_NEAR_M = 250;
/** Stacja paliw musi być bliżej — w mieście 250 m to już stacje przy sąsiednich ulicach. */
export const FUEL_NEAR_M = 150;
/** Ten sam rodzaj w odstępie mniejszym niż tyle km to jedno miejsce (np. stacja i jej wiata, MOP i parking na nim). */
const SAME_KM = 0.3;

const centroid = (ring) => {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(1) : ring;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
};

/** Punkt obiektu GeoJSON (punkt albo środek wielokąta / linii) → [lon, lat]. */
function point(g) {
  if (!g) return null;
  if (g.type === "Point") return g.coordinates;
  if (g.type === "Polygon") return centroid(g.coordinates[0]);
  if (g.type === "MultiPolygon") return centroid(g.coordinates[0][0]);
  if (g.type === "LineString") return centroid(g.coordinates);
  return null;
}

/**
 * Obiekt z `osmium export` (geojsonseq, --add-unique-id=type_id) → wiersz osm_pois albo null.
 * kind: fuel (stacja paliw), services (MOP ze stacją / barem), mop (miejsce odpoczynku), parking (parking dla ciężarówek).
 */
export function poiRow(f) {
  const t = f?.properties ?? {};
  if (t.hgv === "no" || t.access === "private" || t.access === "no") return null;
  let kind;
  if (t.amenity === "fuel") kind = "fuel";
  else if (t.highway === "services") kind = "services";
  else if (t.highway === "rest_area") kind = "mop";
  else if (t.amenity === "parking" && (t.hgv === "yes" || t.hgv === "designated" || t.parking === "truck")) kind = "parking";
  else return null;
  const p = point(f.geometry);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const truck = t.hgv === "yes" || t.hgv === "designated" || t["fuel:HGV_diesel"] === "yes" || kind === "parking" ? 1 : 0;
  const name = String(t.brand || t.name || t.operator || "").slice(0, 120);
  return { osmId: String(f.id ?? "").slice(0, 20), kind, lat: Math.round(p[1] * 1e6) / 1e6, lon: Math.round(p[0] * 1e6) / 1e6, name, truck };
}

/**
 * Miejsca (wiersze osm_pois) → pinezki przy trasie z km i stroną drogi. Trasa: [lat, lon, km][].
 * side: "right" / "left" względem kierunku jazdy — na autostradzie MOP po lewej jest dla przeciwnego kierunku.
 */
export function routePois(route, rows, box) {
  const from = box ? box.from - 2 : 0;
  const to = box ? box.to + 2 : route.length - 1;
  const out = [];
  for (const r of rows) {
    const hit = nearest(route, r.lat, r.lon, from, to);
    if (hit.d > (r.kind === "fuel" ? FUEL_NEAR_M : POI_NEAR_M)) continue;
    const [a, b] = [route[hit.i], route[Math.min(route.length - 1, hit.i + 1)]];
    const kx = Math.cos((a[0] * Math.PI) / 180);
    // Iloczyn wektorowy (kierunek odcinka × wektor do miejsca): ujemny = po prawej (oś y na północ, x na wschód).
    const cross = (b[1] - a[1]) * kx * (r.lat - a[0]) - (b[0] - a[0]) * (r.lon - a[1]) * kx;
    out.push({ km: Math.round(hit.km * 1000) / 1000, id: String(r.osm_id), kind: r.kind, name: r.name ?? "", truck: !!r.truck, lat: r.lat, lon: r.lon, offM: Math.round(hit.d), side: cross < 0 ? "right" : "left" });
  }
  out.sort((x, y) => x.km - y.km);
  // MOP ze stacją i parkingiem to jedno miejsce: zostaje „ważniejszy” rodzaj, bliżej trasy.
  // Stacja na MOP-ie z obsługą też znika — pinezka MOP-u ma znaczek stacji.
  const rank = { services: 0, mop: 1, parking: 2, fuel: 3 };
  const group = (k) => (k === "fuel" ? "fuel" : "rest");
  const covers = (q, p) => (group(q.kind) === group(p.kind) || (q.kind === "services" && p.kind === "fuel")) && rank[q.kind] <= rank[p.kind];
  return out.filter((p, i) => !out.some((q, j) => j !== i && q.side === p.side && Math.abs(q.km - p.km) < SAME_KM && covers(q, p) && (rank[q.kind] < rank[p.kind] || q.offM < p.offM || (q.offM === p.offM && j < i))));
}
