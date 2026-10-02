// Lista podejrzanych ograniczeń z jazdy kierowców: node --env-file=/etc/roadpilot-api.env server/suspects-build.mjs
// Ograniczenie (wysokość, masa, zakaz), przez które wzdłuż drogi przejechało ≥ SUSPECT_USERS kierowców (za zgodą na dane),
// których pojazd z ustawień konta go nie spełnia → map_suspects (Ustawienia → Administracja → Błędy mapy). Co tydzień.

import mysql from "mysql2/promise";
import { SUSPECT_USERS, suspectPasses } from "./mapcheck.mjs";

const db = await mysql.createConnection({
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306) }),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? "roadpilot",
});

// Pojazdy kierowców z ustawień zsynchronizowanych z kontem.
const vehicles = new Map();
const [states] = await db.query("SELECT s.user_id, s.state FROM user_state s JOIN users u ON u.id = s.user_id WHERE u.data_consent_at IS NOT NULL");
for (const s of states) {
  try {
    const v = JSON.parse(s.state)?.settings?.vehicle;
    if (v && Number(v.heightM) > 0 && Number(v.weightKg) > 0) vehicles.set(s.user_id, { heightM: Number(v.heightM), weightKg: Number(v.weightKg) });
  } catch { /* uszkodzony stan — pomijamy */ }
}

const [points] = await db.query("SELECT user_id AS user, lat, lon, kmh, heading FROM gps_points WHERE t > NOW() - INTERVAL 365 DAY AND heading IS NOT NULL");
// Siatka odczytów (~220 m) — dla ograniczenia sprawdzamy tylko odczyty z komórek wokół niego.
const G = 0.002;
const grid = new Map();
for (const p of points) {
  if (!vehicles.has(p.user)) continue;
  const k = `${Math.floor(p.lat / G)}:${Math.floor(p.lon / G)}`;
  (grid.get(k) ?? grid.set(k, []).get(k)).push(p);
}

const [rows] = await db.query("SELECT osm_id, kind, value, raw, lat, lon, geom, name FROM osm_restrictions WHERE geom IS NOT NULL AND (kind = 'height' OR kind = 'weight' OR (kind = 'hgv' AND raw = 'no'))");
const found = [];
for (const r of rows) {
  const geom = JSON.parse(r.geom);
  const lats = geom.map((g) => g[0]), lons = geom.map((g) => g[1]);
  const cand = [];
  for (let a = Math.floor(Math.min(...lats) / G) - 1; a <= Math.floor(Math.max(...lats) / G) + 1; a++)
    for (let b = Math.floor(Math.min(...lons) / G) - 1; b <= Math.floor(Math.max(...lons) / G) + 1; b++) cand.push(...(grid.get(`${a}:${b}`) ?? []));
  if (!cand.length) continue;
  const users = suspectPasses([{ key: r.osm_id, kind: r.kind, value: r.value, raw: r.raw, geom }], cand, vehicles).get(r.osm_id);
  if (users && users.size >= SUSPECT_USERS) found.push([r.osm_id, r.kind, r.value, users.size, r.lat, r.lon, r.name]);
}

await db.beginTransaction();
await db.query("DELETE FROM map_suspects");
if (found.length) await db.query("INSERT INTO map_suspects (osm_id, kind, value, users, lat, lon, name) VALUES ?", [found]);
await db.commit();
console.log(`Kierowców z pojazdem: ${vehicles.size}, odczytów: ${points.length}, ograniczeń: ${rows.length}, podejrzanych: ${found.length}`);
await db.end();
