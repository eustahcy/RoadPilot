// OpenStreetMap → ograniczenia dla ciężarówek (podkładka pod mapę RoadPilot). Czyste funkcje; import: osm-import.mjs.

import { parseConditional } from "./conditional.mjs";
// Dane © współtwórcy OpenStreetMap, licencja ODbL — przy publikacji mapy podajemy źródło.

/** Tag OSM → rodzaj ograniczenia i jednostka wartości. */
export const OSM_KINDS = {
  maxheight: { kind: "height", unit: "m" },
  "maxheight:physical": { kind: "height", unit: "m" },
  maxweight: { kind: "weight", unit: "t" },
  maxweightrating: { kind: "weight", unit: "t" },
  "maxweight:hgv": { kind: "weight", unit: "t" },
  maxaxleload: { kind: "axle", unit: "t" },
  maxwidth: { kind: "width", unit: "m" },
  maxlength: { kind: "length", unit: "m" },
  "maxspeed:hgv": { kind: "speed_hgv", unit: "km/h" },
  hgv: { kind: "hgv", unit: null },
  incline: { kind: "incline", unit: "%" },
};

/** „3.6”, „3,6 m”, „12'6\"”, „7.5 t”, „15 st”, „60 mph” → liczba w jednostce aplikacji; null, gdy nie ma liczby. */
export function parseValue(raw, unit) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || unit === null) return null;
  // Nachylenie: „10%”, „-12 %” → wartość bezwzględna; „up”, „down”, „steep” bez liczby — pomijamy.
  if (unit === "%") {
    const p = /^[-+]?(\d+(?:[.,]\d+)?)\s*%$/.exec(s);
    return p ? round2(Number(p[1].replace(",", "."))) : null;
  }
  const ft = /^(\d+)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(s);
  if (ft && unit === "m") return round2(Number(ft[1]) * 0.3048 + Number(ft[2] ?? 0) * 0.0254);
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]*)$/.exec(s);
  if (!m) return null;
  let v = Number(m[1].replace(",", "."));
  const u = m[2];
  if (unit === "t" && (u === "kg")) v /= 1000;
  else if (unit === "t" && (u === "st")) v *= 0.907185;
  else if (unit === "t" && u === "lbs") v *= 0.000453592;
  else if (unit === "km/h" && u === "mph") v *= 1.609344;
  else if (unit === "m" && u === "cm") v /= 100;
  else if (u && !["m", "t", "kmh", "km"].includes(u)) return null;
  return Number.isFinite(v) && v > 0 && v < 1000 ? round2(v) : null;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Od tylu % nachylenia ostrzegamy (strome podjazdy i zjazdy dla ciężarówki). */
export const INCLINE_MIN_PCT = 8;

/** Tagi warunkowe (godziny, dni, „nie dotyczy dojazdu”) dla rodzaju ograniczenia — ocena przy trasie: conditional.mjs. */
export const COND_TAGS = {
  weight: ["maxweight:conditional", "maxweightrating:conditional", "maxweight:hgv:conditional"],
  hgv: ["hgv:conditional"],
};

/** Upraszczanie linii (co n-ty punkt + końce) — do podglądu wystarczy. */
function simplify(coords, max = 40) {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

/**
 * Obiekt GeoJSON z `osmium export --add-unique-id=type_id` → wiersze ograniczeń (jeden obiekt może mieć kilka, np.
 * masę i nacisk na oś). Pomija obiekty bez ograniczeń i bramki bez wysokości.
 */
export function featureRows(f) {
  const tags = f?.properties ?? {};
  const g = f?.geometry;
  if (!g) return [];
  const coords = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : null;
  if (!coords?.length) return [];
  const mid = coords[Math.floor(coords.length / 2)];
  const rows = [];
  const seen = new Set();
  for (const [tag, { kind, unit }] of Object.entries(OSM_KINDS)) {
    const raw = tags[tag];
    if (raw === undefined || seen.has(kind)) continue;
    if (kind === "hgv" && !["no", "destination", "delivery"].includes(raw)) continue;
    // Strome dopiero od INCLINE_MIN_PCT — łagodniejsze nachylenia ciężarówka pokonuje bez ostrzeżenia.
    if (kind === "incline" && !(parseValue(raw, unit) >= INCLINE_MIN_PCT)) continue;
    const value = parseValue(raw, unit);
    if (unit !== null && value === null) continue; // „none”, „default”, „signals” — nic nie ogranicza
    seen.add(kind);
    rows.push({
      osmId: String(f.id ?? tags["@id"] ?? ""),
      kind,
      value,
      raw: String(raw).slice(0, 60),
      lat: mid[1],
      lon: mid[0],
      geom: g.type === "LineString" ? JSON.stringify(simplify(coords).map(([x, y]) => [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5])) : null,
      name: String(tags.name ?? tags.ref ?? "").slice(0, 120),
      bridge: tags.bridge && tags.bridge !== "no" ? 1 : 0,
    });
  }
  // Warunki: dołączone do wiersza tego rodzaju albo osobny wiersz, gdy ograniczenie jest tylko warunkowe (np. zakaz 22–6).
  for (const [kind, tagsOf] of Object.entries(COND_TAGS)) {
    const items = tagsOf.flatMap((t) => (tags[t] ? parseConditional(tags[t]) : []));
    if (!items.length) continue;
    const cond = JSON.stringify(items);
    const row = rows.find((r) => r.kind === kind);
    if (row) row.cond = cond;
    else rows.push({ osmId: String(f.id ?? tags["@id"] ?? ""), kind, value: null, raw: String(kind === "hgv" ? tags.hgv ?? "" : "").slice(0, 60), lat: mid[1], lon: mid[0], geom: g.type === "LineString" ? JSON.stringify(simplify(coords).map(([x, y]) => [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5])) : null, name: String(tags.name ?? tags.ref ?? "").slice(0, 120), bridge: tags.bridge && tags.bridge !== "no" ? 1 : 0, cond });
  }
  return rows;
}
