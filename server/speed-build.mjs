// Budowa tabeli speed_cells z gps_points (ostatnie 180 dni): node --env-file=/etc/roadpilot-api.env server/speed-build.mjs
// Tabela zastępowana w całości w jednej transakcji. Uruchamiane co tydzień (scripts/weekly-update.sh).

import mysql from "mysql2/promise";
import { buildCells } from "./speeds.mjs";

const db = await mysql.createConnection({
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306) }),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? "roadpilot",
});

const [rows] = await db.query("SELECT user_id AS user, UNIX_TIMESTAMP(t) * 1000 AS t, lat, lon, kmh, heading FROM gps_points WHERE t > NOW() - INTERVAL 180 DAY ORDER BY user_id, t");
const cells = buildCells(rows.map((r) => ({ ...r, t: Number(r.t) })));
await db.beginTransaction();
await db.query("DELETE FROM speed_cells");
for (let i = 0; i < cells.length; i += 2000) {
  const batch = cells.slice(i, i + 2000).map((c) => [c.cell, c.dir, c.passes, c.users, c.kmh]);
  await db.query("INSERT INTO speed_cells (cell, dir, passes, users, kmh) VALUES ?", [batch]);
}
await db.commit();
console.log(`Odczytów: ${rows.length}, komórek: ${cells.length}, z wystarczającymi danymi: ${cells.filter((c) => c.passes >= 5 && c.users >= 2).length}`);
await db.end();
