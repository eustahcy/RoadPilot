// Import ograniczeń dla ciężarówek z OSM do bazy: node --env-file=/etc/roadpilot-api.env server/osm-import.mjs plik.geojsonseq
// Plik z: osmium export truck.osm.pbf -f geojsonseq --add-unique-id=type_id (zob. scripts/osm-update.sh).
// Tabela jest zastępowana w całości w jednej transakcji — do jej końca podgląd widzi poprzednie dane.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import mysql from "mysql2/promise";
import { featureRows } from "./osm.mjs";

const file = process.argv[2];
if (!file) throw new Error("Podaj plik .geojsonseq");

const db = await mysql.createConnection({
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306) }),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? "roadpilot",
  charset: "utf8mb4",
});

await db.beginTransaction();
await db.query("DELETE FROM osm_restrictions");

const COLS = "(osm_id, kind, value, raw, lat, lon, geom, name, bridge, cond)";
let batch = [];
let total = 0;
const flush = async () => {
  if (!batch.length) return;
  await db.query(`INSERT IGNORE INTO osm_restrictions ${COLS} VALUES ?`, [batch]);
  total += batch.length;
  batch = [];
};

for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  for (const r of featureRows(JSON.parse(line.replace(/^\x1e/, "")))) {
    batch.push([r.osmId, r.kind, r.value, r.raw, r.lat, r.lon, r.geom, r.name, r.bridge, r.cond ?? null]);
  }
  if (batch.length >= 2000) await flush();
}
await flush();

await db.commit();
const [kinds] = await db.query("SELECT kind, COUNT(*) AS n FROM osm_restrictions GROUP BY kind ORDER BY n DESC");
console.log(`Zaimportowano ${total} ograniczeń:`, Object.fromEntries(kinds.map((k) => [k.kind, k.n])));
await db.end();
