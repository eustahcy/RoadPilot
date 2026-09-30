// OSM → fotoradary, odcinkowe pomiary prędkości i kamery na czerwonym świetle (Polska). Czyste funkcje.
// Wejście: wiersze OPL z `osmium tags-filter … n/highway=speed_camera r/type=enforcement` + `osmium cat -f opl`
// (tags-filter dokłada węzły członków relacji, więc mamy ich współrzędne).

/** OPL koduje znaki specjalne jako %hex% — np. „%20%” to spacja. */
const unescape = (s) => s.replace(/%([0-9a-f]+)%/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** Jeden wiersz OPL → { type: "n" | "w" | "r", id, tags, lat?, lon?, members? }. */
export function parseOpl(line) {
  const [head, ...fields] = line.trim().split(" ");
  if (!head) return null;
  const o = { type: head[0], id: head.slice(1), tags: {} };
  for (const f of fields) {
    const v = f.slice(1);
    if (f[0] === "T" && v) {
      for (const kv of v.split(",")) {
        const i = kv.indexOf("=");
        o.tags[unescape(kv.slice(0, i))] = unescape(kv.slice(i + 1));
      }
    } else if (f[0] === "x" && v) o.lon = Number(v);
    else if (f[0] === "y" && v) o.lat = Number(v);
    else if (f[0] === "M") {
      o.members = v ? v.split(",").map((m) => {
        const at = m.indexOf("@");
        return { type: m[0], id: m.slice(1, at), role: unescape(m.slice(at + 1)) };
      }) : [];
    }
  }
  return o;
}

/** Prędkość z tagu („70”, „50 km/h”); null, gdy brak albo nieliczbowa („signals”, „none”). */
function kmh(v) {
  const n = parseInt(v ?? "", 10);
  return n >= 5 && n <= 150 ? n : null;
}

/** Dla ciężarówki liczy się limit dla hgv, jeśli jest podany (np. 70 zamiast 90 na odcinku). */
const limitOf = (tags) => kmh(tags["maxspeed:hgv"]) ?? kmh(tags.maxspeed);

const RELATION_KIND = { maxspeed: "camera", average_speed: "section", traffic_signals: "red_light" };

/**
 * Obiekty OPL → wiersze tabeli osm_enforcement:
 * { osmId, kind: camera | section | red_light, value (km/h | null), lat, lon, fromLat, fromLon, toLat, toLon, ref }.
 * camera / red_light: lat, lon = urządzenie; from = skąd jedzie mierzony pojazd (kierunek) — null, gdy nieznany.
 * section: lat, lon = początek odcinka (from), to = koniec. Fotoradar będący urządzeniem relacji nie jest dublowany.
 */
export function enforcementRows(objects) {
  const nodes = new Map();
  const relations = [];
  for (const o of objects) {
    if (!o) continue;
    if (o.type === "n" && Number.isFinite(o.lat) && Number.isFinite(o.lon)) nodes.set(o.id, o);
    else if (o.type === "r" && o.tags.type === "enforcement") relations.push(o);
  }
  const rows = [];
  const usedDevices = new Set();
  for (const r of relations) {
    const kind = RELATION_KIND[r.tags.enforcement];
    if (!kind) continue;
    const role = (name) => (r.members ?? []).filter((m) => m.type === "n" && m.role === name).map((m) => nodes.get(m.id)).filter(Boolean);
    const [from] = role("from");
    const [to] = role("to");
    const devices = role("device");
    const base = { osmId: `r${r.id}`, kind, value: limitOf(r.tags), ref: (r.tags.ref ?? "").slice(0, 40) };
    if (kind === "section") {
      if (!from || !to) continue;
      devices.forEach((d) => usedDevices.add(d.id));
      rows.push({ ...base, lat: from.lat, lon: from.lon, fromLat: from.lat, fromLon: from.lon, toLat: to.lat, toLon: to.lon });
      continue;
    }
    const device = devices[0];
    if (!device) continue;
    devices.forEach((d) => usedDevices.add(d.id));
    rows.push({ ...base, value: base.value ?? limitOf(device.tags), lat: device.lat, lon: device.lon, fromLat: from?.lat ?? null, fromLon: from?.lon ?? null, toLat: null, toLon: null });
  }
  // Fotoradary bez relacji — kierunek nieznany, ostrzegamy w obu.
  for (const n of nodes.values()) {
    if (n.tags.highway !== "speed_camera" || usedDevices.has(n.id)) continue;
    rows.push({ osmId: `n${n.id}`, kind: "camera", value: limitOf(n.tags), lat: n.lat, lon: n.lon, fromLat: null, fromLon: null, toLat: null, toLon: null, ref: (n.tags.ref ?? "").slice(0, 40) });
  }
  return rows;
}
