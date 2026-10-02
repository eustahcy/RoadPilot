// Import słupków kilometrowych z OSM: node --env-file=/etc/roadpilot-api.env server/milestone-import.mjs plik.geojsonseq
// Plik z: osmium export milestones.osm.pbf -f geojsonseq (zob. scripts/osm-update.sh). Tabela zastępowana w jednej transakcji.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import mysql from "mysql2/promise";
import { milestoneRow } from "./milestones.mjs";

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
await db.query("DELETE FROM osm_milestones");
let batch = [];
let total = 0;
const flush = async () => {
  if (!batch.length) return;
  await db.query("INSERT INTO osm_milestones (lat, lon, km, ref) VALUES ?", [batch]);
  total += batch.length;
  batch = [];
};
for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const r = milestoneRow(JSON.parse(line.replace(/^\x1e/, "")));
  if (r) batch.push([r.lat, r.lon, r.km, r.ref]);
  if (batch.length >= 2000) await flush();
}
await flush();
await db.commit();
console.log(`Zaimportowano ${total} słupków kilometrowych.`);
await db.end();
