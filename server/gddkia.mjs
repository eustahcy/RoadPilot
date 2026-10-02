// Utrudnienia GDDKiA (roboty, zwężenia, ruch wahadłowy, zamknięcia, ograniczenia) na drogach krajowych — plik XML
// https://www.archiwum.gddkia.gov.pl/dane/zima_html/utrdane.xml (CC BY-SA 4.0, „Źródło: GDDKiA”). Czyste funkcje + pobieranie z cache;
// testy: gddkia.test.mjs. Bez zależności XML — plik ma prostą, płaską strukturę <utr>…</utr>.

import { makeLocator } from "./livetraffic.mjs";

export const GDDKIA_URL = "https://www.archiwum.gddkia.gov.pl/dane/zima_html/utrdane.xml";
/** Plik odświeżamy najwyżej co tyle ms (GDDKiA aktualizuje go kilka razy na godzinę). */
export const GDDKIA_TTL_MS = 10 * 60_000;
/** Punkt początku utrudnienia dalej od trasy niż tyle metrów — inna droga (współrzędne GDDKiA bywają przybliżone). */
const NEAR_M = 80;

const tag = (block, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? m[1].trim() : "";
};
const num = (s) => {
  const x = Number.parseFloat(String(s).replace(",", "."));
  return Number.isFinite(x) ? x : null;
};
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** XML GDDKiA → lista utrudnień { id, road, lat, lon, roadKm, lenKm, from, to, text, place, type, limits, closed, contraflow, alternating, signals }. */
export function parseGddkia(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<utr>([\s\S]*?)<\/utr>/g)) {
    const b = m[1];
    const lat = num(tag(b, "geo_lat"));
    const lon = num(tag(b, "geo_long"));
    if (lat === null || lon === null) continue;
    const road = tag(b, "nr_drogi").replace(/\s/g, "");
    const roadKm = num(tag(b, "km"));
    const from = Date.parse(tag(b, "data_powstania").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const to = Date.parse(tag(b, "data_likwidacji").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const bool = (n) => tag(b, n) === "true";
    out.push({
      id: `g${road}:${roadKm}:${Number.isFinite(from) ? from : 0}`,
      road,
      lat,
      lon,
      roadKm,
      lenKm: num(tag(b, "dl")) ?? 0,
      from: Number.isFinite(from) ? from : null,
      to: Number.isFinite(to) ? to : null,
      text: decode(tag(b, "objazd")).replace(/\s+/g, " ").slice(0, 400),
      place: decode(tag(b, "nazwa_odcinka")).slice(0, 120),
      type: tag(b, "typ"),
      limits: {
        weight: num(tag(b, "ogr_nosnosc")),
        axle: num(tag(b, "ogr_nacisk")),
        height: num(tag(b, "ogr_skrajnia_pionowa")),
        width: num(tag(b, "ogr_szerokosc")),
        speed: num(tag(b, "ogr_predkosc")),
      },
      closed: bool("droga_zamknieta"),
      contraflow: bool("ruch_2_kierunkowy"),
      alternating: bool("ruch_wahadlowy"),
      signals: bool("sygnalizacja_swietlna"),
    });
  }
  return out;
}

/** Trwające teraz (bez daty końca — trwa). */
export const activeAt = (items, now) => {
  const live = items.filter((u) => (u.from === null || u.from <= now) && (u.to === null || u.to >= now));
  // To samo utrudnienie z dwóch oddziałów (granica województw) — zostaje to z dokładniejszym opisem ruchu.
  const score = (u) => (u.closed ? 4 : 0) + (u.contraflow ? 2 : 0) + (u.alternating ? 1 : 0);
  const best = new Map();
  for (const u of live) {
    const k = `${u.road}:${u.roadKm}:${u.lenKm}`;
    if (!best.has(k) || score(u) > score(best.get(k))) best.set(k, u);
  }
  return [...best.values()];
};

/** Numer drogi bez spacji i przedrostków: „DK 91” → „91”, „S7” → „S7”. */
const normRoad = (r) => String(r ?? "").toUpperCase().replace(/\s/g, "").replace(/^D[KW]/, "");

/**
 * Utrudnienia przy trasie → ostrzeżenia w formacie aplikacji (RouteWarning). Odcinek [km drogi, km + dł.] przeliczony na km trasy
 * przez nasze słupki tej drogi (milestones: { km, v, ref }); bez słupków — od punktu GDDKiA na trasie lenKm do przodu.
 * Roboty → kind „roadworks” (raw: contraflow / alternating / narrow / works); zamknięcie → „closed”;
 * ograniczenia masy / nacisku / wysokości / szerokości poniżej pojazdu → osobne ostrzeżenia (twarde — objazd).
 */
export function gddkiaWarnings(route, items, vehicle, milestones = []) {
  if (route.length < 2 || !items.length) return [];
  const locate = makeLocator(route);
  const lastKm = route.at(-1)[2];
  const out = [];
  for (const u of items) {
    // Najpewniej po pikietażu: nasze słupki tej drogi na trasie → km trasy dla km drogi (współrzędne GDDKiA bywają przesunięte o kilka km).
    const ms = milestones.filter((m) => normRoad(m.ref) === normRoad(u.road)).sort((x, y) => x.km - y.km);
    const s1 = u.roadKm !== null ? routeKmAt(ms, u.roadKm) : undefined;
    const s2 = u.roadKm !== null ? routeKmAt(ms, u.roadKm + u.lenKm) : undefined;
    let a, b;
    if (s1 !== undefined || s2 !== undefined) {
      // Jeden koniec poza słupkami: drugi = znany ± długość, w kierunku pikietażu na trasie.
      const dir = ms.length >= 2 && ms.at(-1).v !== ms[0].v ? Math.sign(ms.at(-1).v - ms[0].v) : 1;
      const x = s1 ?? s2 - dir * u.lenKm, y = s2 ?? s1 + dir * u.lenKm;
      [a, b] = [Math.max(0, Math.min(x, y)), Math.min(lastKm, Math.max(x, y))];
      // Dwie drogi równolegle (np. A1 i DK 91 obok siebie): słupki drogi, którą jedziemy, są bliżej osi trasy.
      const offNear = (list) => median(list.filter((m) => Math.abs(m.km - a) <= 2 && m.off !== undefined).map((m) => m.off));
      const mine = offNear(ms), others = offNear(milestones.filter((m) => m.ref && normRoad(m.ref) !== normRoad(u.road)));
      if (mine !== undefined && others !== undefined && others < mine) continue;
    } else {
      const p = locate(u.lat, u.lon);
      if (!p || p.offM > NEAR_M) continue;
      // Tu jedziemy inną drogą (słupki innego numeru tuż obok, np. A1 nad DK 91) — to utrudnienie nie na naszej jezdni.
      const other = milestones.find((m) => Math.abs(m.km - p.km) <= 1.5 && m.ref && normRoad(m.ref) !== normRoad(u.road));
      if (other) continue;
      a = p.km;
      b = Math.min(lastKm, p.km + u.lenKm);
    }
    // Odcinek za nami (zaczął się przed startem trasy) i tak ma sens — liczy się część na trasie.
    const base = { source: "gddkia", lat: u.lat, lon: u.lon, name: [u.road, u.place].filter(Boolean).join(" · "), note: u.text.slice(0, 160) };
    const sub = u.contraflow ? "contraflow" : u.alternating ? "alternating" : u.limits.width ? "narrow" : "works";
    out.push({ ...base, id: u.id, km: round3(a), ...(b - a >= 0.05 ? { toKm: round3(b) } : {}), kind: u.closed ? "closed" : "roadworks", value: u.limits.speed, raw: u.closed ? "gddkia" : sub, soft: u.closed ? true : undefined });
    const lim = [["weight", u.limits.weight, vehicle.weightKg / 1000], ["axle", u.limits.axle, vehicle.axleWeightKg / 1000], ["height", u.limits.height, vehicle.heightM], ["width", u.limits.width, vehicle.widthM]];
    for (const [kind, v, mine] of lim) if (v !== null && v < mine) out.push({ ...base, id: `${u.id}:${kind}`, km: round3(a), kind, value: v, raw: "gddkia" });
  }
  return out;
}

const round3 = (x) => Math.round(x * 1000) / 1000;
const median = (xs) => {
  if (!xs.length) return undefined;
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/** km trasy, w którym droga ma pikietaż `v` — interpolacja między sąsiednimi słupkami (ms posortowane po km trasy); poza nimi undefined. */
function routeKmAt(ms, v) {
  for (let i = 1; i < ms.length; i++) {
    const [p, q] = [ms[i - 1], ms[i]];
    // Para słupków z sensownym przyrostem (nie skok między jezdniami / drogami).
    if (q.km - p.km > 3 || Math.abs(q.v - p.v) > (q.km - p.km) * 1.5 + 0.5) continue;
    const lo = Math.min(p.v, q.v), hi = Math.max(p.v, q.v);
    if (v >= lo - 0.05 && v <= hi + 0.05 && q.v !== p.v) return p.km + ((v - p.v) / (q.v - p.v)) * (q.km - p.km);
  }
  return undefined;
}

let cache = { at: 0, items: [] };

/** Aktualne utrudnienia (z cache do GDDKIA_TTL_MS); błąd sieci — zostają poprzednie. */
export async function gddkiaItems(now = Date.now()) {
  if (now - cache.at < GDDKIA_TTL_MS) return activeAt(cache.items, now);
  try {
    const r = await fetch(GDDKIA_URL, { signal: AbortSignal.timeout(15_000) });
    if (r.ok) cache = { at: now, items: parseGddkia(await r.text()) };
    else cache.at = now - GDDKIA_TTL_MS + 60_000;
  } catch {
    cache.at = now - GDDKIA_TTL_MS + 60_000;
  }
  return activeAt(cache.items, now);
}
