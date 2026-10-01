// Gdzie to było: miejscowość (osm_places), droga (Valhalla /locate) i MOP / stacja obok (osm_pois) — do notatki o przekroczeniu
// w historii. Oraz droga ciężarówki między dwoma punktami — do luki, gdy aplikacja była zamknięta. Czyste funkcje, testy w geo.test.mjs.

/** Rodzaje miejscowości z OSM (place=…) i promień (km), w którym punkt uznajemy za „w” miejscowości. */
export const PLACE_IN_KM = { city: 6, town: 3, suburb: 1.5, village: 1.5 };
/** Dalej niż tyle km od każdej miejscowości — nie podajemy żadnej. */
export const PLACE_MAX_KM = 15;
/** MOP / stacja / parking dalej niż tyle metrów nie jest „przy” punkcie. */
export const POI_AT_M = 700;

/** Obiekt z `osmium export` (n/place=…) → wiersz osm_places albo null. */
export function placeRow(f) {
  const t = f?.properties ?? {};
  const kind = t.place;
  if (!(kind in PLACE_IN_KM)) return null;
  const name = String(t["name:pl"] || t.name || "").trim().slice(0, 120);
  const c = f.geometry?.type === "Point" ? f.geometry.coordinates : null;
  if (!name || !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { osmId: String(f.id ?? "").slice(0, 20), kind, lat: Math.round(c[1] * 1e6) / 1e6, lon: Math.round(c[0] * 1e6) / 1e6, name };
}

const distKm = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Najlepsza miejscowość dla punktu: ta, „w” której jesteśmy (promień zależny od rodzaju — w mieście dalej od środka), a gdy żadnej —
 * najbliższa. km = odległość od jej środka; inside = czy punkt jest w niej. null = nic w PLACE_MAX_KM.
 */
export function pickPlace(rows, at) {
  let inside = null;
  let near = null;
  for (const r of rows) {
    const km = distKm(at, r);
    const c = { name: r.name, kind: r.kind, km: Math.round(km * 10) / 10 };
    if (km <= PLACE_IN_KM[r.kind] && (!inside || km / PLACE_IN_KM[r.kind] < inside.km / PLACE_IN_KM[inside.kind])) inside = c;
    if (km <= PLACE_MAX_KM && (!near || km < near.km)) near = c;
  }
  return inside ? { ...inside, inside: true } : near ? { ...near, inside: false } : null;
}

/** Najbliższy MOP / stacja / parking TIR w POI_AT_M (wiersze osm_pois). */
export function pickPoi(rows, at) {
  let best = null;
  for (const r of rows) {
    const m = Math.round(distKm(at, r) * 1000);
    if (m <= POI_AT_M && (!best || m < best.m)) best = { kind: r.kind, name: r.name, m };
  }
  return best;
}

/**
 * Nazwy krawędzi z Valhalli (np. ["Łódzka", "14"], ["A2"]) → „A2”, „DK 14, Łódzka”, „DW 708, Ozorkowska”, „Ozorkowska”.
 * Same numery: do 99 drogi krajowe, od 100 wojewódzkie (numeracja w Polsce).
 */
export function roadLabel(names) {
  const list = (names ?? []).map((n) => String(n).trim()).filter(Boolean);
  const refs = [];
  const streets = [];
  for (const n of list) {
    if (/^[AS]\s?\d+[a-z]?$/i.test(n)) refs.push(n.replace(/\s/g, "").toUpperCase());
    else if (/^\d{1,3}$/.test(n)) refs.push(Number(n) < 100 ? `DK ${Number(n)}` : `DW ${Number(n)}`);
    else if (!/^E\s?\d+$/i.test(n)) streets.push(n);
  }
  const ref = refs[0];
  // Na autostradzie / ekspresówce nazwa („Autostrada Bursztynowa”) nic nie dodaje.
  if (ref && /^[AS]/.test(ref)) return ref;
  return [ref, streets[0]].filter(Boolean).join(", ") || null;
}

/** Odpowiedź /route Valhalli → droga i czas jazdy ciężarówki (km, min); null bez trasy. */
export function gapRoute(json) {
  const s = json?.trip?.summary;
  if (!s || !Number.isFinite(s.length) || !Number.isFinite(s.time)) return null;
  return { km: Math.round(s.length * 10) / 10, min: Math.round(s.time / 6) / 10 };
}

/** Zapytanie /route między dwoma punktami: ciężarówka, trasy dla ciężarówek (jak nawigacja), bez manewrów. */
export function gapRequest(from, to) {
  return {
    locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
    costing: "truck",
    costing_options: { truck: { use_truck_route: true, top_speed: 90 } },
    directions_type: "none",
    units: "kilometers",
  };
}
