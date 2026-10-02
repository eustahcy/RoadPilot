// Słupki kilometrowe (OSM highway=milestone) → pikietaż na trasie: „S19 · km 432”. Czyste funkcje; testy: milestones.test.mjs.

import { makeLocator } from "./livetraffic.mjs";

/** „432”, „432,5”, „432+400” (km + m) → km; inaczej null. */
export function parseMilestone(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  let m = /^(\d{1,4})\s*\+\s*(\d{1,3})$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 1000;
  m = /^(\d{1,4}(?:\.\d{1,3})?)(?:\s*km)?$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** Wiersz geojsonseq → { lat, lon, km, ref } albo null. */
export function milestoneRow(f) {
  const p = f?.properties ?? {};
  const km = parseMilestone(p.distance ?? p.pk ?? p["railway:position"]);
  const [lon, lat] = f?.geometry?.coordinates ?? [];
  if (km === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, km, ref: String(p.ref ?? "").split(";")[0].replace(/\s/g, "").slice(0, 20) };
}

/** Słupek dalej od trasy niż tyle metrów — przy innej drodze. */
const NEAR_M = 40;

/**
 * Słupki przy trasie → [{ km: km trasy, v: km drogi, ref }] posortowane po km trasy. Pojedyncze słupki bez sąsiada z tym samym
 * numerem drogi zostają (aplikacja liczy kierunek z par).
 */
export function routeMilestones(route, rows) {
  if (route.length < 2) return [];
  const locate = makeLocator(route);
  const out = [];
  for (const r of rows) {
    const p = locate(r.lat, r.lon);
    if (p && p.offM <= NEAR_M) out.push({ km: Math.round(p.km * 1000) / 1000, v: Number(r.km), ref: r.ref ?? "" });
  }
  return out.sort((a, b) => a.km - b.km);
}
