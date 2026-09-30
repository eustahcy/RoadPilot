// Import fotoradarów i odcinkowych pomiarów z OSM: node --env-file=/etc/roadpilot-api.env server/enforcement-import.mjs plik.opl
// Plik z: osmium tags-filter … n/highway=speed_camera r/type=enforcement → osmium cat -f opl (zob. scripts/osm-update.sh).
// Tabela jest zastępowana w całości w jednej transakcji.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import mysql from "mysql2/promise";
import { enforcementRows, parseOpl } from "./enforcement.mjs";

const file = process.argv[2];
if (!file) throw new Error("Podaj plik .opl");

const objects = [];
for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
  if (line[0] === "n" || line[0] === "r") objects.push(parseOpl(line));
}
const rows = enforcementRows(objects);

const db = await mysql.createConnection({
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306) }),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? "roadpilot",
  charset: "utf8mb4",
});
await db.beginTransaction();
await db.query("DELETE FROM osm_enforcement");
for (let i = 0; i < rows.length; i += 2000) {
  const batch = rows.slice(i, i + 2000).map((r) => [r.osmId, r.kind, r.value, r.lat, r.lon, r.fromLat, r.fromLon, r.toLat, r.toLon, r.ref]);
  await db.query("INSERT IGNORE INTO osm_enforcement (osm_id, kind, value, lat, lon, from_lat, from_lon, to_lat, to_lon, ref) VALUES ?", [batch]);
}
await db.commit();
const [kinds] = await db.query("SELECT kind, COUNT(*) AS n FROM osm_enforcement GROUP BY kind ORDER BY n DESC");
console.log(`Zaimportowano ${rows.length} miejsc kontroli prędkości:`, Object.fromEntries(kinds.map((k) => [k.kind, k.n])));
await db.end();
