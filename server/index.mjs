// RoadPilot API — konta (rejestracja, logowanie) i synchronizacja stanu aplikacji w MariaDB.
// Bez frameworka: node:http + mysql2. Słucha tylko na 127.0.0.1 — z zewnątrz przez Nginx (/roadpilot/api/ → /api/).
// Konfiguracja ze zmiennych środowiska (plik /etc/roadpilot-api.env): DB_SOCKET albo DB_HOST + DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, PORT;
// poczta: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM_EMAIL, MAIL_FROM_NAME;
// APP_ORIGINS — adresy, z których działa aplikacja (CORS i linki w e-mailach), np. "https://tuike.pl,https://www.tuike.pl".

import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { cleanPoints, cleanReport, inPoland } from "./collect.mjs";
import { applySpeeds, SPEED_MIN } from "./speeds.mjs";
import { badTurnClusters } from "./mapcheck.mjs";
import { HERE_MAX_POINTS, limitHere, osrmLanes, parseValhalla, parseValhallaAlternates, roadInfo, traceChunks, tracePoints, traceRequest, valhallaRequest } from "./valhalla.mjs";
import { LIVE, liveSections } from "./livetraffic.mjs";
import { routeMilestones } from "./milestones.mjs";
import { ALERT_KINDS, ALERT_TTL_H, applyConditions, applyVotes, blockingPoints, dropCopiedBridgeHeights, routeAlerts, routeBoxes, routeWarnings } from "./warnings.mjs";
import { compareReports, REPORT_TO_OSM } from "./compare.mjs";
import { parseRoutes, parseSearch, ROUTE_TYPES, routeError, routeUrl, searchUrl, validPoint } from "./nav.mjs";
import { cleanPresence, friendView, keepReplayedPosAt } from "./friends.mjs";
import { bboxParam, incidentSections, TRAFFIC_CATEGORIES, trafficBoxes } from "./traffic.mjs";
import { routePois } from "./pois.mjs";
import { extendPremium, keyView, makeKey, MAX_KEY_DAYS, canonKey, redeemProblem } from "./premium.mjs";
import { gapRequest, gapRoute, pickPlace, pickPoi, PLACE_MAX_KM, POI_AT_M, roadLabel } from "./geo.mjs";
import { boxAround, cleanParking, distanceM, PARKING_DAILY_MAX, PARKING_RADIUS_M, parkingView } from "./parking.mjs";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { promisify } from "node:util";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";

const scrypt = promisify(scryptCb);

const PORT = Number(process.env.PORT ?? 7781);
const SESSION_DAYS = 365;
const MAX_BODY = 2 * 1024 * 1024;
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_MINUTES = 60;
// Nawigacja dla ciężarówek — klucz TomTom tylko na serwerze (aplikacja pyta /api/nav/…).
const TOMTOM_KEY = process.env.TOMTOM_KEY ?? "";
// Własny silnik tras (Valhalla na OSM Polska) — np. http://127.0.0.1:8002; puste = tylko TomTom.
const VALHALLA_URL = (process.env.VALHALLA_URL ?? "").replace(/\/+$/, "");
// Własne kafelki wektorowe mapy (scripts/tiles-build.sh → katalog z/x/y.pbf, gzip); puste = mapa z kafelków TomTom.
const VTILES_DIR = (process.env.VTILES_DIR ?? "").replace(/\/+$/, "");
/** Drogi OSM w obszarze zabudowanym / poza nim (id\tu|r) — z scripts/osm-update.sh; brak pliku = tylko gęstość dróg Valhalli. */
const ZONES_FILE = process.env.ZONES_FILE ?? "/opt/roadpilot-osm/zones.tsv";
// Zasięg własnych kafelków (Polska) — poza nim aplikacja wraca do TomTom.
const VTILES_BOUNDS = [14.07, 49.0, 24.15, 54.84];
const APP_ORIGINS = (process.env.APP_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      requireTLS: Number(process.env.SMTP_PORT) !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      connectionTimeout: 20_000,
    })
  : null;
const MAIL_FROM = { name: process.env.MAIL_FROM_NAME ?? "RoadPilot", address: process.env.MAIL_FROM_EMAIL ?? process.env.SMTP_USER ?? "" };

const db = mysql.createPool({
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306) }),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? "roadpilot",
  connectionLimit: 5,
  multipleStatements: true,
  charset: "utf8mb4",
});

// ── Hasła i tokeny ──────────────────────────────────────────────────────────

/** scrypt z losową solą: "scrypt$<sól hex>$<skrót hex>". */
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function checkPassword(password, stored) {
  const [kind, saltHex, keyHex] = String(stored).split("$");
  if (kind !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(keyHex, "hex");
  return want.length === key.length && timingSafeEqual(want, key);
}

// Porównanie z hasłem nieistniejącego konta zajmuje tyle samo — czas odpowiedzi nie zdradza, czy e-mail jest w bazie.
const DUMMY_HASH = await hashPassword(randomBytes(12).toString("hex"));

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))", [sha256(token), userId, SESSION_DAYS]);
  return token;
}

/** Użytkownik z nagłówka Authorization: Bearer <token> — albo null. */
async function authUser(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
  if (!m) return null;
  const hash = sha256(m[1]);
  const [rows] = await db.query(
    "SELECT u.id, u.email, u.name, u.role, u.premium_until, u.data_consent_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > NOW()",
    [hash],
  );
  if (!rows.length) return null;
  db.query("UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = ?", [hash]).catch(() => {});
  return { ...rows[0], tokenHash: hash };
}

// ── Ograniczenie prób logowania ─────────────────────────────────────────────

const ATTEMPTS = new Map();
const LIMIT = { max: 10, windowMs: 15 * 60_000 };

/** true = za dużo prób z tego adresu (lub na ten e-mail) w ostatnich 15 min. */
function limited(...keys) {
  const now = Date.now();
  let blocked = false;
  for (const key of keys) {
    const list = (ATTEMPTS.get(key) ?? []).filter((t) => now - t < LIMIT.windowMs);
    list.push(now);
    ATTEMPTS.set(key, list);
    if (list.length > LIMIT.max) blocked = true;
  }
  return blocked;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, list] of ATTEMPTS) if (list.every((t) => now - t >= LIMIT.windowMs)) ATTEMPTS.delete(k);
}, LIMIT.windowMs).unref();

// ── HTTP ────────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  const json = JSON.stringify(body ?? {});
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(json);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Za duże dane.");
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw new HttpError(400, "Nieprawidłowe dane.");
  }
}

const clientIp = (req) => String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "");
/** Premium aktywne: admin zawsze, inni do daty premium_until. */
const isAdmin = (u) => u?.role === "admin";
const hasPremium = (u) => isAdmin(u) || (u?.premium_until != null && new Date(u.premium_until).getTime() > Date.now());
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  admin: isAdmin(u),
  premium: hasPremium(u),
  premiumUntil: u.premium_until ? new Date(u.premium_until).getTime() : null,
  dataConsent: u.data_consent_at != null,
});

function credentials(body) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!EMAIL_RE.test(email) || email.length > 190) throw new HttpError(400, "Podaj prawidłowy adres e-mail.");
  return { email, password };
}

const routes = {
  "POST /api/register": async (req) => {
    const body = await readJson(req);
    const { email, password } = credentials(body);
    const name = String(body.name ?? "").trim().slice(0, 100);
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`);
    if (password.length > 200) throw new HttpError(400, "Hasło jest za długie.");
    if (limited(`reg:${clientIp(req)}`)) throw new HttpError(429, "Za dużo prób. Spróbuj za kilkanaście minut.");
    let id;
    try {
      const [r] = await db.query("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)", [email, name, await hashPassword(password)]);
      id = r.insertId;
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") throw new HttpError(409, "Konto z tym adresem e-mail już istnieje — zaloguj się.");
      throw e;
    }
    return [201, { token: await createSession(id), user: publicUser({ id, email, name, role: "user", premium_until: null }) }];
  },

  "POST /api/login": async (req) => {
    const { email, password } = credentials(await readJson(req));
    if (limited(`ip:${clientIp(req)}`, `email:${email}`)) throw new HttpError(429, "Za dużo prób logowania. Spróbuj za kilkanaście minut.");
    const [rows] = await db.query("SELECT id, email, name, role, premium_until, data_consent_at, password_hash FROM users WHERE email = ?", [email]);
    const ok = await checkPassword(password, rows[0]?.password_hash ?? DUMMY_HASH);
    if (!rows.length || !ok) throw new HttpError(401, "Nieprawidłowy e-mail lub hasło.");
    return [200, { token: await createSession(rows[0].id), user: publicUser(rows[0]) }];
  },

  "POST /api/logout": async (req, user) => {
    await db.query("DELETE FROM sessions WHERE token_hash = ?", [user.tokenHash]);
    return [200, {}];
  },

  "GET /api/me": async (req, user) => [200, { user: publicUser(user) }],

  "GET /api/state": async (req, user) => {
    const [rows] = await db.query("SELECT state, rev FROM user_state WHERE user_id = ?", [user.id]);
    return [200, rows.length ? { state: JSON.parse(rows[0].state), rev: rows[0].rev } : { state: null, rev: 0 }];
  },

  /**
   * Zapis stanu. Z `baseRev` (wersja, od której wyszedł zapis) odrzucamy go (409), gdy w międzyczasie zapisało inne
   * urządzenie — aplikacja pobiera wtedy stan z konta. Bez `baseRev` (starsze wersje aplikacji): ostatni zapis wygrywa.
   */
  "PUT /api/state": async (req, user) => {
    const body = await readJson(req);
    if (!body.state || typeof body.state !== "object" || body.state.version !== 1) throw new HttpError(400, "Nieprawidłowy stan aplikacji.");
    const json = JSON.stringify(body.state);
    // Warunkowy UPDATE jest atomowy — dwa urządzenia zapisujące naraz nie przejdą oba.
    const [upd] = Number.isInteger(body.baseRev) && body.baseRev > 0
      ? await db.query("UPDATE user_state SET state = ?, rev = rev + 1 WHERE user_id = ? AND rev = ?", [json, user.id, body.baseRev])
      : [{ affectedRows: 0 }];
    if (!upd.affectedRows) {
      const [cur] = await db.query("SELECT rev FROM user_state WHERE user_id = ?", [user.id]);
      if (cur.length && Number.isInteger(body.baseRev) && body.baseRev > 0) throw new HttpError(409, "Stan zmieniono na innym urządzeniu.");
      await db.query("INSERT INTO user_state (user_id, state) VALUES (?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state), rev = rev + 1", [user.id, json]);
    }
    const [rows] = await db.query("SELECT rev FROM user_state WHERE user_id = ?", [user.id]);
    return [200, { rev: rows[0].rev }];
  },

  /** Usunięcie konta razem z danymi (sesje i stan kasują się kaskadowo). */
  "DELETE /api/account": async (req, user) => {
    const { password } = await readJson(req);
    const [rows] = await db.query("SELECT password_hash FROM users WHERE id = ?", [user.id]);
    if (!(await checkPassword(String(password ?? ""), rows[0]?.password_hash))) throw new HttpError(401, "Nieprawidłowe hasło.");
    await db.query("DELETE FROM users WHERE id = ?", [user.id]);
    return [200, {}];
  },
};

const PUBLIC = new Set(["POST /api/register", "POST /api/login", "POST /api/password/forgot", "POST /api/password/reset", "GET /api/config"]);

// ── Nawigacja (TomTom) ──────────────────────────────────────────────────────
// Tylko dla kont Premium (i adminów); limit zapytań na adres IP dodatkowo chroni limit klucza.

function requirePremium(user) {
  if (!hasPremium(user)) throw new HttpError(403, "Nawigacja jest dostępna w RoadPilot Premium.");
}

const NAV_LIMITS = { search: { max: 120, windowMs: 10 * 60_000 }, route: { max: 30, windowMs: 10 * 60_000 }, here: { max: 600, windowMs: 10 * 60_000 }, nearby: { max: 60, windowMs: 10 * 60_000 }, gap: { max: 20, windowMs: 10 * 60_000 }, traffic: { max: 30, windowMs: 10 * 60_000 }, live: { max: 60, windowMs: 10 * 60_000 }, where: { max: 60, windowMs: 10 * 60_000 }, redeem: { max: 10, windowMs: 60 * 60_000 } };

// Limity darmowego planu TomTom (z panelu my.tomtom.com) — nie przekraczamy BUDGET_SHARE z nich.
// Okres: miesiąc (bezpieczniej) albo dzień — TOMTOM_PERIOD=day, jeśli limity w panelu są dzienne.
const TOMTOM_LIMITS = { search: Number(process.env.TOMTOM_LIMIT_SEARCH ?? 2500), route: Number(process.env.TOMTOM_LIMIT_ROUTING ?? 20000), tiles: Number(process.env.TOMTOM_LIMIT_TILES ?? 200000), traffic: Number(process.env.TOMTOM_LIMIT_TRAFFIC ?? 20000) };
const TOMTOM_PERIOD = process.env.TOMTOM_PERIOD === "day" ? "day" : "month";
const BUDGET_SHARE = 0.8;
/** Na jedno konto dziennie — żeby jeden kierowca nie zużył limitu wszystkich (admin bez limitu). */
const PER_USER_DAY = { search: 150, route: 40, tiles: 1500, traffic: 400 };
const USER_HITS = new Map();

const API_NAMES = { search: "wyszukiwań", route: "tras", tiles: "mapy", traffic: "korków" };

const periodKey = (d = new Date()) => (TOMTOM_PERIOD === "day" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7));

/** Zapisuje jedno zapytanie do TomTom — albo odmawia, gdy okres doszedł do 80% limitu. Licznik w bazie (przeżywa restart). */
async function spend(api) {
  const period = periodKey();
  const max = Math.floor(TOMTOM_LIMITS[api] * BUDGET_SHARE);
  await db.query("INSERT IGNORE INTO api_usage (api, period, count) VALUES (?, ?, 0)", [api, period]);
  const [r] = await db.query("UPDATE api_usage SET count = count + 1 WHERE api = ? AND period = ? AND count < ?", [api, period, max]);
  if (r.affectedRows === 0) {
    throw new HttpError(503, `Nawigacja chwilowo niedostępna — wykorzystano limit ${API_NAMES[api]} na ${TOMTOM_PERIOD === "day" ? "dziś" : "ten miesiąc"}.`);
  }
}

function userDaily(kind, user) {
  if (isAdmin(user)) return;
  const key = `${kind}:${user.id}:${new Date().toISOString().slice(0, 10)}`;
  const n = (USER_HITS.get(key) ?? 0) + 1;
  USER_HITS.set(key, n);
  if (n > PER_USER_DAY[kind]) throw new HttpError(429, `Dzienny limit ${API_NAMES[kind]} na konto wykorzystany — spróbuj jutro.`);
}

// Te same podpowiedzi wyszukiwania przez 10 min z pamięci — mniej zapytań przy pisaniu.
const SEARCH_CACHE = new Map();
const SEARCH_TTL = 10 * 60_000;
const NAV_HITS = new Map();

function navThrottle(kind, req) {
  const { max, windowMs } = NAV_LIMITS[kind];
  const key = `${kind}:${clientIp(req)}`;
  const now = Date.now();
  const list = (NAV_HITS.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  NAV_HITS.set(key, list);
  if (list.length > max) throw new HttpError(429, "Za dużo zapytań nawigacji. Spróbuj za kilka minut.");
}

setInterval(() => {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  for (const k of USER_HITS.keys()) if (!k.endsWith(today)) USER_HITS.delete(k);
  for (const [k, v] of SEARCH_CACHE) if (now - v.at > SEARCH_TTL) SEARCH_CACHE.delete(k);
  for (const [k, list] of NAV_HITS) if (list.every((t) => now - t >= 10 * 60_000)) NAV_HITS.delete(k);
}, 10 * 60_000).unref();

async function tomtom(url) {
  if (!TOMTOM_KEY) throw new HttpError(503, "Nawigacja nie jest skonfigurowana na serwerze.");
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new HttpError(502, "Brak połączenia z serwisem nawigacji.");
  }
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}

routes["GET /api/nav/search"] = async (req, user) => {
  requirePremium(user);
  navThrottle("search", req);
  const u = new URL(req.url, "http://x");
  const q = (u.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 120) throw new HttpError(400, "Wpisz co najmniej 2 znaki.");
  const near = u.searchParams.has("lat") ? validPoint({ lat: Number(u.searchParams.get("lat")), lon: Number(u.searchParams.get("lon")) }) : null;
  const cacheKey = `${q.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : ""}`;
  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL) return [200, { results: cached.results }];
  userDaily("search", user);
  await spend("search");
  const r = await tomtom(searchUrl(q, near, TOMTOM_KEY));
  if (!r.ok) throw new HttpError(502, "Wyszukiwanie nie działa. Spróbuj za chwilę.");
  const results = parseSearch(r.json);
  if (SEARCH_CACHE.size < 2000) SEARCH_CACHE.set(cacheKey, { at: Date.now(), results });
  return [200, { results }];
};

/** Tyle razy silnik RoadPilot liczy trasę od nowa, omijając ograniczenia z naszej bazy, których pojazd nie spełnia. */
const MAX_DETOURS = 6;

/** id drogi OSM → "u" (zabudowany) | "r" (poza) — wczytywane raz, przy pierwszej trasie. */
let zones = null;
function loadZones() {
  zones ??= (async () => {
    const map = new Map();
    try {
      for await (const line of createInterface({ input: createReadStream(ZONES_FILE) })) {
        const tab = line.indexOf("\t");
        if (tab > 0) map.set(Number(line.slice(0, tab)), line.slice(tab + 1));
      }
    } catch (e) {
      console.error(`Brak obszarów zabudowanych (${ZONES_FILE}): ${e.message}`);
    }
    return map;
  })();
  return zones;
}

/**
 * Pasy ruchu do trasy Valhalla: to samo zapytanie w formacie OSRM (tylko tam Valhalla podaje pasy); `idx` = która trasa
 * (0 = główna, 1… = alternatywy). Błąd = trasa bez pasów.
 */
async function withLanes(route, q, idx = 0) {
  if (!route || !q) return route;
  try {
    const r = await fetch(`${VALHALLA_URL}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...q, format: "osrm" }), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`route osrm ${r.status}`);
    return { ...route, lanes: osrmLanes(await r.json(), route.points, idx, route.instructions) };
  } catch (e) {
    console.error(`Pasy ruchu (Valhalla): ${e.message}`);
    return route;
  }
}

/** Trasa Valhalla + ograniczenia ze znaków i rodzaj drogi (trace_attributes po kawałkach) + pasy; błąd = trasa bez nich. */
async function withRoadInfo(found) {
  if (!found) return found;
  const { _q, _idx, ...plain } = found;
  const [route, laned] = await Promise.all([roadInfoFor(plain), withLanes(plain, _q, _idx)]);
  return { ...route, lanes: laned.lanes };
}

async function roadInfoFor(route) {
  try {
    const chunks = await Promise.all(traceChunks(route.points).map(async (c) => {
      const r = await fetch(`${VALHALLA_URL}/trace_attributes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(traceRequest(c.pts)), signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`trace_attributes ${r.status}`);
      return { ...c, edges: (await r.json()).edges ?? [] };
    }));
    return { ...route, ...roadInfo(chunks, await loadZones()) };
  } catch (e) {
    console.error(`Ograniczenia prędkości (Valhalla): ${e.message}`);
    return route;
  }
}

/**
 * Gdy start albo cel leży na drodze, z której ciężarówka nie wyjedzie (droga serwisowa, strefa zakazu w centrum, MOP),
 * Valhalla odpowiada „brak trasy” (442). Wtedy ponawiamy z szerszym dopasowaniem punktów (SNAP_RETRIES) — trasa kończy się
 * na najbliższej dostępnej dla ciężarówki drodze, a TomTom zostaje tylko na prawdziwe awarie / poza Polską.
 */
const SNAP_RETRIES = [{ radius: 400 }, { radius: 400, search_filter: { min_road_class: "tertiary" } }];

async function valhallaOnce(from, to, vehicle, exclude, routeType = "fastest", via = []) {
  for (const snap of [null, ...SNAP_RETRIES]) {
    const q = valhallaRequest(from, to, vehicle, exclude, 0, routeType, via);
    if (snap) for (const l of q.locations) Object.assign(l, snap);
    let r;
    try {
      r = await fetch(`${VALHALLA_URL}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q), signal: AbortSignal.timeout(30_000) });
    } catch {
      return null;
    }
    const json = await r.json().catch(() => null);
    const route = r.ok ? parseValhalla(json) : null;
    // Zapytanie zostaje przy trasie — withRoadInfo dociąga z nim pasy ruchu.
    if (route) return { ...route, _q: q };
    if (json?.error_code !== 442) {
      console.warn("valhalla: brak trasy", json?.error_code ?? r.status, json?.error ?? "");
      return null;
    }
  }
  console.warn("valhalla: brak trasy dla ciężarówki także po szerszym dopasowaniu", JSON.stringify({ from, to }));
  return null;
}

/**
 * Trasa z własnego silnika (Valhalla, OSM Polska). Valhalla nie zawsze uwzględnia tagi ograniczeń z OSM, więc
 * sprawdzamy trasę naszą bazą i przy twardym konflikcie (oś, masa, wysokość, szerokość, długość, zakaz) liczymy
 * od nowa z tym miejscem wykluczonym. Gdy objazdu nie ma — zostaje ostatnia wykonalna trasa z ostrzeżeniami.
 */
/** Słupki kilometrowe przy trasie (pikietaż „S19 · km 432”) — błąd bazy nie psuje trasy. */
async function withMilestones(route) {
  try {
    const rows = [];
    for (const box of routeBoxes(route.points, 25, 0.002)) {
      const [r] = await db.query("SELECT lat, lon, km, ref FROM osm_milestones WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", [box.minLat, box.maxLat, box.minLon, box.maxLon]);
      rows.push(...r);
    }
    const seen = new Set();
    return { ...route, milestones: routeMilestones(route.points, rows).filter((m) => !seen.has(m.km) && seen.add(m.km)) };
  } catch (e) {
    console.error("milestones", e);
    return route;
  }
}

/** Najwięcej punktów „omiń blokadę” w jednym zapytaniu (kilka kolejnych blokad na trasie). */
const MAX_AVOID = 12;

async function valhallaRoute(from, to, vehicle, routeType = "fastest", via = [], avoid = []) {
  if (!VALHALLA_URL) return null;
  let veh;
  try {
    veh = parseVehicle(vehicle);
  } catch {
    return withRoadInfo(await valhallaOnce(from, to, vehicle, [...avoid], routeType, via));
  }
  // Manewry zgłoszone jako niemożliwe przez kilku kierowców — omijamy punkt tuż za nimi; do tego „Omiń blokadę” kierowcy.
  const exclude = [...avoid, ...(await badTurnExcludes([from, ...via, to]))];
  const seen = new Set();
  let best = await valhallaOnce(from, to, vehicle, exclude, routeType, via);
  if (!best) return null;
  for (let i = 0; i < MAX_DETOURS; i++) {
    const blocking = blockingPoints(await findWarnings(best.points, veh, false, { kmh: best.travelMin > 0 ? (best.lengthKm / best.travelMin) * 60 : 60, destKm: best.lengthKm, startKm: 0 }), best.lengthKm).filter((p) => !seen.has(p.key));
    if (!blocking.length) return withRoadInfo({ ...best, detours: exclude.length });
    blocking.forEach((p) => {
      seen.add(p.key);
      exclude.push(p);
    });
    const next = await valhallaOnce(from, to, vehicle, exclude, routeType, via);
    if (!next) break; // bez objazdu — zostaje poprzednia trasa (ostrzeżenia pokaże aplikacja)
    best = next;
  }
  return withRoadInfo({ ...best, detours: exclude.length });
}

/** Trasy alternatywne z Valhalli (bez omijania ograniczeń — kierowca widzi ostrzeżenia przy porównaniu). */
async function valhallaAlternates(from, to, vehicle, routeType = "fastest") {
  try {
    const q = valhallaRequest(from, to, vehicle, [], 2, routeType);
    const r = await fetch(`${VALHALLA_URL}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q), signal: AbortSignal.timeout(30_000) });
    return r.ok ? Promise.all(parseValhallaAlternates(await r.json().catch(() => null)).map((a, i) => withRoadInfo({ ...a, _q: q, _idx: i + 1 }))) : [];
  } catch {
    return [];
  }
}

/** Alternatywa prawie taka sama jak główna (±1% długości i czasu) albo o ponad 35% wolniejsza nic nie wnosi. */
const distinct = (main, alts) => alts
  .filter((a) => Math.abs(a.lengthKm - main.lengthKm) > main.lengthKm * 0.01 || Math.abs(a.travelMin - main.travelMin) > main.travelMin * 0.01)
  .filter((a) => a.travelMin <= main.travelMin * 1.35)
  .slice(0, 2);

/**
 * Trasa dla ciężarówki: silnik wybrany przez kierowcę ("tomtom" / "roadpilot"). Własny działa tylko w Polsce;
 * gdy TomTom jest niedostępny lub wyczerpał limit 80% — w Polsce przechodzimy na własny silnik.
 */
/**
 * Ograniczenie prędkości tam, gdzie jedziemy, bez wyznaczonej trasy: ślad z ostatnich odczytów GPS → trace_attributes
 * (własna Valhalla, tylko Polska). Odpowiedź w formacie trasy (speedLimits, roads), `km` = nasza pozycja na śladzie.
 */
routes["POST /api/nav/here"] = async (req, user) => {
  requirePremium(user);
  navThrottle("here", req);
  if (!VALHALLA_URL) throw new HttpError(503, "Brak własnego silnika map na serwerze.");
  const body = await readJson(req);
  const list = Array.isArray(body.points) ? body.points.slice(-HERE_MAX_POINTS).map((p) => validPoint({ lat: p?.[0], lon: p?.[1] })) : [];
  if (list.length < 2 || list.some((p) => !p)) throw new HttpError(400, "Za mało punktów śladu.");
  if (!list.every((p) => inPoland(p.lat, p.lon))) return [200, { km: 0, speedLimits: [], roads: [] }];
  const pts = tracePoints(list.map((p) => [p.lat, p.lon]));
  let r;
  try {
    r = await fetch(`${VALHALLA_URL}/trace_attributes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(traceRequest(pts, true)), signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new HttpError(502, "Brak połączenia z silnikiem map.");
  }
  // 400 = śladu nie da się dopasować do drogi (parking, teren poza drogami) — po prostu brak ograniczenia.
  if (!r.ok) return [200, { km: 0, speedLimits: [], roads: [] }];
  return [200, limitHere(pts, (await r.json()).edges ?? [], await loadZones())];
};

const MAX_VIA = 5;

/** Potwierdzone „złe manewry” (≥ BAD_TURN_USERS kierowców) w prostokącie wokół punktów trasy — do exclude_locations. */
async function badTurnExcludes(points) {
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  const [rows] = await db.query("SELECT user_id AS user, lat, lon, heading, note FROM road_reports WHERE kind = 'bad_turn' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", [Math.min(...lats) - 0.3, Math.max(...lats) + 0.3, Math.min(...lons) - 0.5, Math.max(...lons) + 0.5]);
  return badTurnClusters(rows).filter((c) => c.confirmed).slice(0, 40).map((c) => ({ lat: c.lat, lon: c.lon }));
}

/** Prędkości z jazdy kierowców (speed_cells) w pamięci — odświeżane co godzinę; brak tabeli / błąd = trasa bez nich. */
let speedCells = { at: 0, map: new Map() };
async function speedLookup() {
  if (Date.now() - speedCells.at > 3_600_000) {
    try {
      const [rows] = await db.query("SELECT cell, dir, passes, users, kmh FROM speed_cells WHERE passes >= ? AND users >= ?", [SPEED_MIN.passes, SPEED_MIN.users]);
      speedCells = { at: Date.now(), map: new Map(rows.map((r) => [`${r.cell}|${r.dir}`, r])) };
    } catch (e) {
      console.error(`Prędkości z jazdy: ${e.message}`);
      speedCells = { at: Date.now(), map: new Map() };
    }
  }
  return (cell, dir) => speedCells.map.get(`${cell}|${dir}`);
}

/** Trasa z własnego silnika + zmierzone prędkości ciężarówek (plan przerw, czas przejazdu). */
async function withSpeeds(route) {
  return route?.engine === "roadpilot" ? applySpeeds(route, await speedLookup()) : route;
}

/** Zgłoszony wjazd TIR dalej od celu niż tyle metrów dotyczy innego miejsca. */
const GATE_NEAR_M = 400;

/** Najbliższy zgłoszony wjazd dla ciężarówek przy celu (road_reports kind „gate”) albo null. */
async function truckGate(to) {
  const dLat = GATE_NEAR_M / 111_320, dLon = dLat / Math.cos((to.lat * Math.PI) / 180);
  const [rows] = await db.query("SELECT lat, lon FROM road_reports WHERE kind = 'gate' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", [to.lat - dLat, to.lat + dLat, to.lon - dLon, to.lon + dLon]);
  const near = rows.map((r) => ({ lat: r.lat, lon: r.lon, m: distKmPts(to, r) * 1000 })).filter((r) => r.m <= GATE_NEAR_M).sort((a, b) => a.m - b.m)[0];
  return near ? { lat: near.lat, lon: near.lon } : null;
}
const distKmPts = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180));

/** Korki są na razie wyłączone (decyzja 2026-10-01: licencja i limity TomTom) — TRAFFIC_ENABLED=1 włącza je z powrotem. */
const TRAFFIC_ENABLED = process.env.TRAFFIC_ENABLED === "1";
/** Trasa TomTom bez utrudnień, gdy korki są wyłączone. */
const noTraffic = (r) => (TRAFFIC_ENABLED ? r : { ...r, traffic: [], trafficMin: 0 });

routes["POST /api/nav/route"] = async (req, user) => {
  requirePremium(user);
  navThrottle("route", req);
  const body = await readJson(req);
  const from = validPoint(body.from);
  const target = validPoint(body.to);
  if (!from || !target) throw new HttpError(400, "Brak punktu startu lub celu.");
  // Wjazd dla ciężarówek zgłoszony przez kierowcę przy celu — trasa prowadzi do niego, nie do środka budynku.
  const gate = await truckGate(target);
  const to = gate ?? target;
  const tag = (res) => (gate ? { ...res, route: { ...res.route, gate } } : res);
  // Prędkości z jazdy kierowców dla trasy i alternatyw (własny silnik).
  const finish = async (res) => tag({ ...res, route: await withMilestones(await withSpeeds(res.route)), ...(res.alternatives ? { alternatives: await Promise.all(res.alternatives.map(withSpeeds)) } : {}) });
  // Punkty pośrednie (przytrzymanie na mapie → „dodaj do trasy”); z nimi bez tras alternatywnych.
  const via = Array.isArray(body.via) ? body.via.map(validPoint) : [];
  if (via.length > MAX_VIA || via.some((p) => !p)) throw new HttpError(400, `Najwyżej ${MAX_VIA} punktów pośrednich.`);
  // „Omiń blokadę drogi”: punkty na drodze przed kierowcą, których trasa ma nie przechodzić (tylko własny silnik).
  const avoid = Array.isArray(body.avoid) ? body.avoid.slice(0, MAX_AVOID).map(validPoint).filter(Boolean) : [];
  const withAlts = body.alternatives === true && !via.length;
  const routeType = ROUTE_TYPES.has(body.routeType) ? body.routeType : "fastest";
  let url;
  try {
    url = routeUrl(from, to, body.vehicle, TOMTOM_KEY, withAlts ? 2 : 0, routeType, via);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const ownPossible = !!VALHALLA_URL && [from, ...via, to].every((p) => inPoland(p.lat, p.lon));
  // Trasy liczy zawsze własny silnik (wybór TomTom usunięty); TomTom tylko awaryjnie — poza Polską albo gdy Valhalla zawiedzie.
  if (ownPossible) {
    const own = await valhallaRoute(from, to, body.vehicle, routeType, via, avoid);
    if (own) return [200, await finish({ route: own, alternatives: withAlts ? distinct(own, (await valhallaAlternates(from, to, body.vehicle, routeType)).map((a) => ({ ...a, engine: "roadpilot" }))) : [] })];
  }
  if (ownPossible) console.warn("trasa: własny silnik nie dał trasy — TomTom awaryjnie");
  userDaily("route", user);
  try {
    await spend("route");
  } catch (e) {
    const own = ownPossible ? await valhallaRoute(from, to, body.vehicle, routeType, via) : null;
    if (own) return [200, await finish({ route: { ...own, fallback: true } })];
    throw e;
  }
  const r = await tomtom(url);
  const [route, ...alts] = r.ok ? parseRoutes(r.json) : [];
  if (route) return [200, tag({ route: { ...noTraffic(route), engine: "tomtom" }, alternatives: distinct(route, alts).map((a) => ({ ...noTraffic(a), engine: "tomtom" })) })];
  if (r.status >= 500 && ownPossible) {
    const own = await valhallaRoute(from, to, body.vehicle, routeType, via);
    if (own) return [200, await finish({ route: { ...own, fallback: true } })];
  }
  throw new HttpError(r.status === 400 || r.status === 404 ? 422 : 502, routeError(r.json));
};

// ── Reset hasła e-mailem ────────────────────────────────────────────────────

/** Adres aplikacji do linku w e-mailu: ten, z którego przyszła prośba — tylko z listy APP_ORIGINS. */
function appUrlFor(requested) {
  try {
    const u = new URL(String(requested));
    if (APP_ORIGINS.includes(u.origin)) return `${u.origin}${u.pathname}`;
  } catch {
    /* niżej domyślny */
  }
  return `${APP_ORIGINS[0] ?? ""}/roadpilot/`;
}

async function sendResetMail(to, name, link) {
  const hello = name ? `Cześć ${name},` : "Cześć,";
  const text = `${hello}\n\nktoś (prawdopodobnie Ty) poprosił o zmianę hasła do konta RoadPilot.\nUstaw nowe hasło tutaj (link ważny ${RESET_MINUTES} min):\n\n${link}\n\nJeśli to nie Ty — zignoruj tę wiadomość, hasło się nie zmieni.\n\nRoadPilot — asystent planowania jazdy`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = `<p>${esc(hello)}</p><p>ktoś (prawdopodobnie Ty) poprosił o zmianę hasła do konta <b>RoadPilot</b>.</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#42d392;color:#06120c;font-weight:bold;text-decoration:none">Ustaw nowe hasło</a></p>
<p style="color:#667">Link jest ważny ${RESET_MINUTES} min. Jeśli to nie Ty — zignoruj tę wiadomość, hasło się nie zmieni.</p>`;
  await mailer.sendMail({ from: MAIL_FROM, to, subject: "RoadPilot — zmiana hasła", text, html });
}

routes["POST /api/password/forgot"] = async (req) => {
  const body = await readJson(req);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Podaj prawidłowy adres e-mail.");
  if (!mailer) throw new HttpError(503, "Wysyłka e-maili nie jest skonfigurowana.");
  if (limited(`forgot:${clientIp(req)}`, `forgot:${email}`)) throw new HttpError(429, "Za dużo prób. Spróbuj za kilkanaście minut.");
  const [rows] = await db.query("SELECT id, name FROM users WHERE email = ?", [email]);
  // Ta sama odpowiedź, gdy konta nie ma — nie zdradzamy, które adresy są zarejestrowane.
  if (rows.length) {
    const token = randomBytes(32).toString("base64url");
    await db.query("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))", [sha256(token), rows[0].id, RESET_MINUTES]);
    const link = `${appUrlFor(body.appUrl)}?reset=${token}`;
    try {
      await sendResetMail(email, rows[0].name, link);
    } catch (e) {
      console.error("reset mail", e);
      throw new HttpError(502, "Nie udało się wysłać e-maila. Spróbuj ponownie za chwilę.");
    }
  }
  return [200, { ok: true }];
};

routes["POST /api/password/reset"] = async (req) => {
  const body = await readJson(req);
  const password = String(body.password ?? "");
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`);
  if (password.length > 200) throw new HttpError(400, "Hasło jest za długie.");
  if (limited(`reset:${clientIp(req)}`)) throw new HttpError(429, "Za dużo prób. Spróbuj za kilkanaście minut.");
  const [rows] = await db.query(
    "SELECT u.id, u.email, u.name, u.role, u.premium_until, u.data_consent_at FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > NOW()",
    [sha256(String(body.token ?? ""))],
  );
  if (!rows.length) throw new HttpError(400, "Link wygasł albo był już użyty — poproś o nowy.");
  const user = rows[0];
  await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), user.id]);
  // Nowe hasło wylogowuje wszystkie urządzenia i unieważnia pozostałe linki.
  await db.query("DELETE FROM sessions WHERE user_id = ?", [user.id]);
  await db.query("DELETE FROM password_resets WHERE user_id = ?", [user.id]);
  return [200, { token: await createSession(user.id), user: publicUser(user) }];
};

/**
 * Ostrzeżenia na trasie z naszych danych (OSM + zgłoszenia kierowców) — bez kosztów TomTom. Trasa: [lat, lon, km][].
 * Tylko Polska (tam mamy dane); poza nią zwracamy pustą listę.
 */
/**
 * Ograniczenia z naszej bazy na trasie [lat, lon, km][], których pojazd nie spełnia, oraz (gdy `alerts`) fotoradary,
 * odcinkowe pomiary i świeże zgłoszenia kontroli — posortowane po km.
 */
/**
 * `timing` — do ograniczeń warunkowych: { kmh } średnia prędkość trasy (czas przejazdu każdego miejsca = teraz + km / kmh),
 * { destKm } km celu (dojazd w strefie). Domyślnie 60 km/h i koniec wysłanego kawałka.
 */
async function findWarnings(pts, vehicle, alerts = true, timing = {}) {
  const warnings = [];
  for (const box of routeBoxes(pts)) {
    const area = [box.minLat, box.maxLat, box.minLon, box.maxLon];
    const [osm] = await db.query(
      `SELECT 'osm' AS source, osm_id AS id, kind, value, raw, lat, lon, geom, name, bridge, cond FROM osm_restrictions
       WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (
         (kind = 'height' AND value < ?) OR (kind = 'weight' AND (value < ? OR cond IS NOT NULL)) OR (kind = 'axle' AND value < ?) OR
         (kind = 'width' AND value < ?) OR (kind = 'length' AND value < ?) OR kind = 'hgv' OR kind = 'incline')
       AND NOT EXISTS (SELECT 1 FROM osm_overrides o WHERE o.osm_id = osm_restrictions.osm_id AND o.kind = osm_restrictions.kind)`,
      [...area, vehicle.heightM, vehicle.weightKg / 1000, vehicle.axleWeightKg / 1000, vehicle.widthM, vehicle.lengthM],
    );
    const [rep] = await db.query(
      `SELECT 'report' AS source, id, kind, value, note AS raw, lat, lon, NULL AS geom, '' AS name, created_at FROM road_reports
       WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (
         (kind = 'height' AND value < ?) OR (kind = 'weight' AND value < ?) OR kind = 'truck_ban' OR
         (kind = 'closed' AND created_at > NOW() - INTERVAL 14 DAY) OR (kind = 'roadworks' AND created_at > NOW() - INTERVAL 60 DAY))`,
      [...area, vehicle.heightM, vehicle.weightKg / 1000],
    );
    // Wysokość na moście przepisana z drogi pod nim (błąd w OSM) — nie ostrzega i nie zmienia trasy.
    const rows = dropCopiedBridgeHeights([...osm, ...rep].map((r) => ({ ...r, geom: typeof r.geom === "string" ? JSON.parse(r.geom) : r.geom })));
    // Roboty z długością → odcinek (km … km + długość); kilka zgłoszeń tych samych robót — liczy się najnowsze (poprawka kierowcy).
    const works = routeWarnings(pts, rows, vehicle, box).map((w) => (w.kind === "roadworks" && w.value ? { ...w, toKm: w.km + w.value } : w));
    const born = new Map(rep.map((r) => [String(r.id), +new Date(r.created_at)]));
    warnings.push(...works.filter((w) => w.kind !== "roadworks" || !works.some((o) => o !== w && o.kind === "roadworks" && Math.abs(o.km - w.km) < 1.5 && (born.get(String(o.id)) ?? 0) > (born.get(String(w.id)) ?? 0))));
    if (!alerts) continue;
    const [cams] = await db.query(
      `SELECT 'osm' AS source, osm_id AS id, kind, value, lat, lon, from_lat, from_lon, to_lat, to_lon, ref AS name FROM osm_enforcement
       WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
      area,
    );
    const [live] = await db.query(
      `SELECT 'report' AS source, id, kind, value, lat, lon, heading FROM road_reports
       WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (
         (kind IN ('police', 'itd') AND (created_at > NOW() - INTERVAL ? HOUR OR id IN (
           SELECT CAST(ref_id AS UNSIGNED) FROM alert_votes WHERE source = 'report' AND vote > 0 AND created_at > NOW() - INTERVAL ? HOUR))) OR
         (kind IN ('camera', 'section') AND created_at > NOW() - INTERVAL ? HOUR))`,
      [...area, ALERT_TTL_H.police, ALERT_TTL_H.police, ALERT_TTL_H.camera],
    );
    const found = routeAlerts(pts, [...cams, ...live], box);
    warnings.push(...(found.length ? applyVotes(found, await alertVotes(found)) : []));
  }
  warnings.sort((a, b) => a.km - b.km);
  const unique = warnings.filter((w, i) => !warnings.slice(0, i).some((p) => p.kind === w.kind && w.km - p.km < 0.15));
  // Zakazy w godzinach i „nie dotyczy dojazdu” — w chwili, w której tam będziemy.
  const startKm = pts[0][2];
  const kmh = timing.kmh > 5 ? timing.kmh : 60;
  const now = Date.now();
  return applyConditions(unique, { timeAt: (km) => now + ((km - startKm) / kmh) * 3_600_000, destKm: timing.destKm ?? pts[pts.length - 1][2], startKm: timing.startKm ?? startKm, weightT: vehicle.weightKg / 1000 });
}

/** Głosy „jest / nie ma” dla znalezionych ostrzeżeń (ostatnie 180 dni) → Map "source:id" → { up, down, lastUp, lastDown }. */
async function alertVotes(alerts) {
  const [rows] = await db.query(
    `SELECT source, ref_id, SUM(vote > 0) AS up, SUM(vote < 0) AS down,
       MAX(IF(vote > 0, created_at, NULL)) AS last_up, MAX(IF(vote < 0, created_at, NULL)) AS last_down
     FROM alert_votes WHERE created_at > NOW() - INTERVAL 180 DAY AND (source, ref_id) IN (?) GROUP BY source, ref_id`,
    [alerts.map((w) => [w.source, w.id])],
  );
  const t = (d) => (d ? new Date(d).getTime() : null);
  return new Map(rows.map((r) => [`${r.source}:${r.ref_id}`, { up: Number(r.up), down: Number(r.down), lastUp: t(r.last_up), lastDown: t(r.last_down) }]));
}

function parseVehicle(v = {}) {
  const vehicle = { heightM: Number(v.heightM), widthM: Number(v.widthM), lengthM: Number(v.lengthM), weightKg: Number(v.weightKg), axleWeightKg: Number(v.axleWeightKg) };
  if (!Object.values(vehicle).every((x) => Number.isFinite(x) && x > 0)) throw new HttpError(400, "Brak danych pojazdu.");
  return vehicle;
}

/**
 * Ostrzeżenia na trasie z naszych danych (OSM + zgłoszenia kierowców) — bez kosztów TomTom. Trasa: [lat, lon, km][].
 * Tylko Polska (tam mamy dane); poza nią zwracamy pustą listę.
 */
routes["POST /api/nav/warnings"] = async (req, user) => {
  requirePremium(user);
  const body = await readJson(req);
  const vehicle = parseVehicle(body.vehicle);
  const pts = Array.isArray(body.points) ? body.points.filter((p) => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)).slice(0, 20000) : [];
  if (pts.length < 2) throw new HttpError(400, "Brak trasy.");
  // Aplikacja podaje długość i czas całej trasy (kawałek przy odświeżaniu nie kończy się na celu).
  const lengthKm = Number(body.lengthKm), travelMin = Number(body.travelMin);
  const timing = lengthKm > 0 && travelMin > 0 ? { kmh: (lengthKm / travelMin) * 60, destKm: lengthKm, startKm: 0 } : {};
  return [200, { warnings: await findWarnings(pts, vehicle, true, timing), pois: body.pois === false ? undefined : await findPois(pts, body.tolls === true) }];
};

/** Najwięcej prostokątów TomTom na jedno odświeżenie (trasa przed nami ~150 km to zwykle 1–3). */
const TRAFFIC_MAX_BOXES = 6;
/** Te same prostokąty (np. dwóch kierowców na tej samej drodze) przez 2 min z pamięci. */
const TRAFFIC_CACHE = new Map();
const TRAFFIC_TTL = 2 * 60_000;
const TRAFFIC_FIELDS = "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,delay,length}}}";

async function trafficIncidents(box) {
  const bbox = bboxParam(box);
  const hit = TRAFFIC_CACHE.get(bbox);
  if (hit && Date.now() - hit.at < TRAFFIC_TTL) return hit.incidents;
  await spend("traffic");
  const q = new URLSearchParams({ key: TOMTOM_KEY, bbox, fields: TRAFFIC_FIELDS, language: "pl-PL", timeValidityFilter: "present", categoryFilter: TRAFFIC_CATEGORIES.join(",") });
  const r = await tomtom(`https://api.tomtom.com/traffic/services/5/incidentDetails?${q}`);
  if (!r.ok || !Array.isArray(r.json?.incidents)) throw new HttpError(502, "Nie udało się pobrać korków.");
  TRAFFIC_CACHE.set(bbox, { at: Date.now(), incidents: r.json.incidents });
  return r.json.incidents;
}

setInterval(() => {
  for (const [k, v] of TRAFFIC_CACHE) if (Date.now() - v.at >= TRAFFIC_TTL) TRAFFIC_CACHE.delete(k);
}, TRAFFIC_TTL).unref();

/**
 * Bieżące korki, roboty i zamknięcia na kawałku trasy (z dowolnego silnika) — aplikacja pyta co kilka minut o trasę
 * przed nami. Trasa: [lat, lon, km][]; km w odpowiedzi są km tej trasy.
 */
routes["POST /api/nav/traffic"] = async (req, user) => {
  requirePremium(user);
  if (!TRAFFIC_ENABLED) throw new HttpError(503, "Korki są chwilowo wyłączone.");
  navThrottle("traffic", req);
  const body = await readJson(req);
  const pts = Array.isArray(body.points) ? body.points.filter((p) => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)).slice(0, 20000) : [];
  if (pts.length < 2) throw new HttpError(400, "Brak trasy.");
  userDaily("traffic", user);
  const incidents = [];
  for (const box of trafficBoxes(pts).slice(0, TRAFFIC_MAX_BOXES)) incidents.push(...(await trafficIncidents(box)));
  return [200, { traffic: incidentSections(pts, incidents) }];
};

/**
 * Korki i spowolnienia z jazdy kierowców RoadPilot (gps_points z ostatnich LIVE.windowMin minut, za zgodą) na kawałku trasy przed nami.
 * Bez TomTom — działa też przy wyłączonych korkach. Body: points [lat, lon, km][], segments { type, km }[] (od startu trasy).
 */
routes["POST /api/nav/live"] = async (req, user) => {
  requirePremium(user);
  navThrottle("live", req);
  const body = await readJson(req);
  const pts = Array.isArray(body.points) ? body.points.filter((p) => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)).slice(0, 20000) : [];
  if (pts.length < 2) throw new HttpError(400, "Brak trasy.");
  const segments = Array.isArray(body.segments) ? body.segments.filter((x) => x && typeof x.type === "string" && Number.isFinite(x.km)).slice(0, 5000) : [];
  const rows = [];
  for (const box of routeBoxes(pts)) {
    const [r] = await db.query(
      "SELECT lat, lon, kmh, heading FROM gps_points WHERE t > NOW() - INTERVAL ? MINUTE AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
      [LIVE.windowMin, box.minLat, box.maxLat, box.minLon, box.maxLon],
    );
    rows.push(...r);
  }
  return [200, { traffic: liveSections(pts, segments, rows) }];
};

/** Stacje paliw, MOP-y, parkingi TIR i bramki przy trasie (pinezki na mapie) — z osm_pois, bez kosztów TomTom. */
/** Promień (km) miejsc wokół pozycji — lista „po drodze” bez wyznaczonej trasy (aplikacja podaje km: zasięg z ustawień + zapas). */
const NEARBY_KM = { default: 32, max: 100 };

/**
 * Stacje, MOP-y i parkingi TIR wokół pozycji (bez trasy). Które są przed nami, liczy aplikacja z kierunku jazdy —
 * pobiera raz na kilka km, a filtr kierunku zmienia się z każdym odczytem.
 */
routes["GET /api/nav/nearby"] = async (req, user) => {
  requirePremium(user);
  navThrottle("nearby", req);
  const u = new URL(req.url, "http://x");
  const at = validPoint({ lat: Number(u.searchParams.get("lat")), lon: Number(u.searchParams.get("lon")) });
  if (!at) throw new HttpError(400, "Brak pozycji.");
  const km = Math.min(NEARBY_KM.max, Math.max(5, Number(u.searchParams.get("km")) || NEARBY_KM.default));
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((at.lat * Math.PI) / 180));
  const area = [at.lat - dLat, at.lat + dLat, at.lon - dLon, at.lon + dLon];
  const [osm] = await db.query("SELECT osm_id, kind, lat, lon, name, truck FROM osm_pois WHERE kind <> 'toll' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", area);
  const [reported] = await db.query(REPORTED_POIS, area);
  const rows = [...osm, ...reported];
  return [200, { pois: rows.map((r) => ({ id: r.osm_id, kind: r.kind, name: r.name, truck: !!r.truck, lat: r.lat, lon: r.lon })) }];
};

/**
 * Luka w odczytach GPS (aplikacja zamknięta): droga ciężarówki z ostatniej znanej pozycji do obecnej — km i czas jazdy wg Valhalli.
 * Z kontem, bez Premium (to dokładność liczników jazdy, nie nawigacja). Poza Polską / bez trasy: { road: null } — aplikacja liczy wtedy
 * z linii prostej.
 */
routes["POST /api/gps/gap"] = async (req, user) => {
  navThrottle("gap", req);
  const body = await readJson(req);
  const from = validPoint({ lat: body.from?.[0], lon: body.from?.[1] });
  const to = validPoint({ lat: body.to?.[0], lon: body.to?.[1] });
  if (!from || !to) throw new HttpError(400, "Brak pozycji.");
  if (!VALHALLA_URL || !inPoland(from.lat, from.lon) || !inPoland(to.lat, to.lon)) return [200, { road: null }];
  try {
    const r = await fetch(`${VALHALLA_URL}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gapRequest(from, to)), signal: AbortSignal.timeout(8_000) });
    return [200, { road: r.ok ? gapRoute(await r.json()) : null }];
  } catch {
    return [200, { road: null }];
  }
};

/** Gdzie jest punkt: miejscowość, droga i MOP / stacja obok — do notatki o przekroczeniu w historii. Z kontem; POST, żeby pozycja nie trafiała do logów serwera WWW. */
routes["POST /api/geo/where"] = async (req, user) => {
  navThrottle("where", req);
  const body = await readJson(req);
  const at = validPoint({ lat: body.lat, lon: body.lon });
  if (!at) throw new HttpError(400, "Brak pozycji.");
  const box = (km) => [at.lat - km / 111, at.lat + km / 111, at.lon - km / (111 * Math.cos((at.lat * Math.PI) / 180)), at.lon + km / (111 * Math.cos((at.lat * Math.PI) / 180))];
  const [places] = await db.query("SELECT name, kind, lat, lon FROM osm_places WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", box(PLACE_MAX_KM));
  const [pois] = await db.query("SELECT name, kind, lat, lon FROM osm_pois WHERE kind <> 'toll' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", box(POI_AT_M / 1000));
  let road = null;
  if (VALHALLA_URL && inPoland(at.lat, at.lon)) {
    try {
      // /locate daje tylko najbliższą krawędź — bez dróg serwisowych (wjazd na MOP, parking), i pytamy też o punkty ~80 m obok:
      // nazwa z punktu, a gdy jej nie ma — najczęstsza z sąsiednich.
      const d = 0.0007;
      const locations = [[0, 0], [d, 0], [-d, 0], [0, d * 1.6], [0, -d * 1.6]].map(([a, b]) => ({ lat: at.lat + a, lon: at.lon + b, search_filter: { min_road_class: "residential" } }));
      const r = await fetch(`${VALHALLA_URL}/locate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations, costing: "truck", verbose: true }), signal: AbortSignal.timeout(5_000) });
      const labels = r.ok ? (await r.json()).map((l) => (l?.edges ?? []).filter((e) => e.distance <= 300).map((e) => roadLabel(e.edge_info?.names)).find(Boolean) ?? null) : [];
      const count = new Map();
      for (const l of labels.slice(1)) if (l) count.set(l, (count.get(l) ?? 0) + 1);
      road = labels[0] ?? [...count].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    } catch {
      road = null;
    }
  }
  return [200, { place: pickPlace(places, at), road, poi: pickPoi(pois, at) }];
};

/** Ile metrów od przytrzymanego miejsca szukamy drogi — palec na mapie nie trafia dokładnie. */
const SNAP_MAX_M = 60;

/**
 * Przytrzymanie na mapie → najbliższa droga (punkt na jej osi i nazwa) — zgłoszenie ograniczenia musi leżeć na drodze,
 * bo ostrzeżenia na trasie łapią punkty ≤ 20 m od niej. Profil „auto”, żeby droga z zakazem dla ciężarówek też się znalazła.
 */
routes["POST /api/geo/snap"] = async (req, user) => {
  navThrottle("where", req);
  const body = await readJson(req);
  const at = validPoint({ lat: body.lat, lon: body.lon });
  if (!at) throw new HttpError(400, "Brak pozycji.");
  if (!VALHALLA_URL || !inPoland(at.lat, at.lon)) return [200, { road: null }];
  try {
    const r = await fetch(`${VALHALLA_URL}/locate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations: [at], costing: "auto", verbose: true }), signal: AbortSignal.timeout(5_000) });
    const edges = r.ok ? ((await r.json())[0]?.edges ?? []).filter((e) => e.distance <= SNAP_MAX_M).sort((a, b) => a.distance - b.distance) : [];
    const e = edges[0];
    if (!e) return [200, { road: null }];
    return [200, { road: { lat: e.correlated_lat, lon: e.correlated_lon, name: roadLabel(e.edge_info?.names) ?? "", offM: Math.round(e.distance) } }];
  } catch {
    return [200, { road: null }];
  }
};

/** Miejsca zgłoszone przez kierowców (parking / MOP / stacja, których nie ma w OSM) jako wiersze jak osm_pois — id „r…”. */
const REPORTED_POIS = "SELECT CONCAT('r', id) AS osm_id, kind, lat, lon, 'Zgłoszenie kierowcy' AS name, kind = 'parking' AS truck FROM road_reports WHERE kind IN ('parking', 'mop', 'fuel') AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?";

/** `tolls` — także bramki (kind toll); prosi o nie tylko aplikacja, która je rysuje (starsza pokazałaby je jako parking). */
/** Stacja „w” MOP-ie: do tylu metrów od punktu MOP-u (MOP-y bywają długie, stacja na jednym końcu). */
const SERVICES_FUEL_M = 450;
const distM = (a, b) => Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

async function findPois(pts, tolls = false) {
  const out = [];
  for (const box of routeBoxes(pts, 25, 0.004)) {
    const area = [box.minLat, box.maxLat, box.minLon, box.maxLon];
    const [rows] = await db.query("SELECT osm_id, kind, lat, lon, name, truck FROM osm_pois WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", area);
    const [reported] = await db.query(REPORTED_POIS, area);
    // OSM przed zgłoszeniami: to samo miejsce z obu źródeł zostaje jako pinezka z OSM (routePois łączy bliskie miejsca tego rodzaju).
    // MOP ze stacją (services) ma w OSM nazwę MOP-u — markę bierzemy z najbliższej stacji z nazwą w promieniu SERVICES_FUEL_M.
    const brands = new Map();
    for (const sv of rows.filter((r) => r.kind === "services")) {
      const near = rows.filter((r) => r.kind === "fuel" && r.name && distM(sv, r) <= SERVICES_FUEL_M).sort((a, b) => distM(sv, a) - distM(sv, b))[0];
      if (near) brands.set(String(sv.osm_id), near.name);
    }
    out.push(...routePois(pts, [...(tolls ? rows : rows.filter((r) => r.kind !== "toll")), ...reported.map((r) => ({ ...r, truck: Number(r.truck) }))], box).map((p) => (brands.has(String(p.id)) ? { ...p, brand: brands.get(String(p.id)) } : p)));
  }
  // Sąsiednie prostokąty zachodzą na siebie — to samo miejsce tylko raz.
  const seen = new Set();
  return out.sort((a, b) => a.km - b.km).filter((p) => !seen.has(p.id) && seen.add(p.id));
}

// ── Dane do własnej mapy (za zgodą) ──────────────────────────────────────────

routes["POST /api/consent"] = async (req, user) => {
  const { on } = await readJson(req);
  await db.query("UPDATE users SET data_consent_at = ? WHERE id = ?", [on ? new Date() : null, user.id]);
  return [200, { dataConsent: !!on }];
};

function requireConsent(user) {
  if (user.data_consent_at == null) throw new HttpError(403, "Brak zgody na zbieranie danych.");
}

routes["POST /api/collect/points"] = async (req, user) => {
  requireConsent(user);
  let rows;
  try {
    rows = cleanPoints((await readJson(req)).points, Date.now());
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  if (rows.length) {
    await db.query("INSERT INTO gps_points (user_id, t, lat, lon, kmh, heading) VALUES ?", [rows.map(([t, lat, lon, kmh, heading]) => [user.id, new Date(t), lat, lon, kmh, heading])]);
  }
  return [200, { saved: rows.length }];
};

routes["POST /api/collect/report"] = async (req, user) => {
  requireConsent(user);
  let r;
  try {
    r = cleanReport(await readJson(req));
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const [res] = await db.query("INSERT INTO road_reports (user_id, kind, lat, lon, heading, value, note) VALUES (?, ?, ?, ?, ?, ?, ?)", [user.id, r.kind, r.lat, r.lon, r.heading, r.value, r.note]);
  return [201, { id: res.insertId }];
};

/** Koniec robót drogowych zgłoszonych „zaznaczę koniec”: długość = odległość od początku × 1,1 (droga nie jest prosta), 0,1–50 km. */
routes["POST /api/collect/report/end"] = async (req, user) => {
  requireConsent(user);
  const b = await readJson(req);
  const at = validPoint({ lat: Number(b.lat), lon: Number(b.lon) });
  const id = Number(b.id);
  if (!at || !Number.isInteger(id)) throw new HttpError(400, "Brak pozycji.");
  const [[row]] = await db.query("SELECT lat, lon FROM road_reports WHERE id = ? AND user_id = ? AND kind = 'roadworks'", [id, user.id]);
  if (!row) throw new HttpError(404, "Nie ma takiego zgłoszenia.");
  const km = Math.round(Math.min(50, Math.max(0.1, (distM(row, at) / 1000) * 1.1)) * 10) / 10;
  await db.query("UPDATE road_reports SET value = ? WHERE id = ?", [km, id]);
  return [200, { km }];
};

/** Po minięciu fotoradaru / kontroli: „nadal jest” (+1) albo „nie ma” (-1) — jeden głos na miejsce (zmiana nadpisuje). */
routes["POST /api/alerts/vote"] = async (req, user) => {
  requireConsent(user);
  const b = await readJson(req);
  const source = String(b.source ?? "");
  const id = String(b.id ?? "");
  const kind = String(b.kind ?? "");
  const vote = Number(b.vote);
  if (!["osm", "report"].includes(source) || !/^[a-z]?\d{1,18}$/.test(id) || !ALERT_KINDS.has(kind) || (vote !== 1 && vote !== -1)) throw new HttpError(400, "Nieprawidłowy głos.");
  await db.query(
    "INSERT INTO alert_votes (user_id, source, ref_id, kind, vote) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vote = VALUES(vote), created_at = NOW()",
    [user.id, source, id, kind, vote],
  );
  return [200, {}];
};

/** Kierowca usuwa wszystko, co przekazał do mapy (ślady i zgłoszenia), i wycofuje zgodę. */
routes["DELETE /api/collect"] = async (req, user) => {
  await db.query("DELETE FROM gps_points WHERE user_id = ?", [user.id]);
  await db.query("DELETE FROM road_reports WHERE user_id = ?", [user.id]);
  await db.query("DELETE FROM alert_votes WHERE user_id = ?", [user.id]);
  await db.query("UPDATE users SET data_consent_at = NULL WHERE id = ?", [user.id]);
  return [200, {}];
};

// ── Parking przy celu: opinie kierowców i potwierdzenia (bez Premium — liczy się każdy głos) ──

/** Opinie w promieniu celu z sumami głosów i moim głosem. */
async function parkingAt(at, user) {
  const b = boxAround(at.lat, at.lon, PARKING_RADIUS_M);
  const [rows] = await db.query(
    `SELECT o.id, o.user_id, o.lat, o.lon, o.label, o.status, o.note, o.updated_at,
       COALESCE(SUM(v.vote = 1), 0) AS up, COALESCE(SUM(v.vote = -1), 0) AS down, MAX(IF(v.user_id = ?, v.vote, NULL)) AS my_vote
     FROM parking_opinions o LEFT JOIN parking_votes v ON v.opinion_id = o.id
     WHERE o.lat BETWEEN ? AND ? AND o.lon BETWEEN ? AND ?
     GROUP BY o.id ORDER BY o.updated_at DESC LIMIT 200`,
    [user.id, b.minLat, b.maxLat, b.minLon, b.maxLon],
  );
  return parkingView(rows, at, user.id);
}

routes["GET /api/parking"] = async (req, user) => {
  const u = new URL(req.url, "http://x");
  const at = validPoint({ lat: Number(u.searchParams.get("lat")), lon: Number(u.searchParams.get("lon")) });
  if (!at) throw new HttpError(400, "Brak położenia celu.");
  return [200, await parkingAt(at, user)];
};

/** Dodaj albo zmień swoją opinię — jedna na kierowcę w promieniu celu. */
routes["POST /api/parking"] = async (req, user) => {
  let o;
  try {
    o = cleanParking(await readJson(req));
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM parking_opinions WHERE user_id = ? AND updated_at > NOW() - INTERVAL 1 DAY", [user.id]);
  if (n >= PARKING_DAILY_MAX) throw new HttpError(429, "Za dużo opinii jak na jeden dzień — spróbuj jutro.");
  const b = boxAround(o.lat, o.lon, PARKING_RADIUS_M);
  const [own] = await db.query("SELECT id, lat, lon FROM parking_opinions WHERE user_id = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", [user.id, b.minLat, b.maxLat, b.minLon, b.maxLon]);
  const mine = own.find((r) => distanceM(o, { lat: r.lat, lon: r.lon }) <= PARKING_RADIUS_M);
  if (mine) {
    await db.query("UPDATE parking_opinions SET status = ?, note = ?, label = IF(? = '', label, ?), updated_at = NOW() WHERE id = ?", [o.status, o.note, o.label, o.label, mine.id]);
    // Zmieniona opinia to nowa informacja — stare potwierdzenia dotyczyły czegoś innego.
    await db.query("DELETE FROM parking_votes WHERE opinion_id = ?", [mine.id]);
  } else {
    await db.query("INSERT INTO parking_opinions (user_id, lat, lon, label, status, note) VALUES (?, ?, ?, ?, ?, ?)", [user.id, o.lat, o.lon, o.label, o.status, o.note]);
  }
  return [200, await parkingAt(o, user)];
};

/** 👍 (1) / 👎 (-1) / wycofanie (0) pod cudzą opinią. */
routes["POST /api/parking/vote"] = async (req, user) => {
  const b = await readJson(req);
  const id = Number(b.id);
  const vote = Number(b.vote);
  if (!Number.isInteger(id) || id <= 0 || ![1, 0, -1].includes(vote)) throw new HttpError(400, "Nieprawidłowy głos.");
  const [[o]] = await db.query("SELECT user_id FROM parking_opinions WHERE id = ?", [id]);
  if (!o) throw new HttpError(404, "Opinia została usunięta.");
  if (o.user_id === user.id) throw new HttpError(400, "Nie można głosować na własną opinię.");
  if (vote === 0) await db.query("DELETE FROM parking_votes WHERE user_id = ? AND opinion_id = ?", [user.id, id]);
  else await db.query("INSERT INTO parking_votes (user_id, opinion_id, vote) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE vote = VALUES(vote), created_at = NOW()", [user.id, id, vote]);
  return [200, {}];
};

/** Usuń opinię — swoją; administrator każdą (moderacja). */
routes["DELETE /api/parking"] = async (req, user) => {
  const id = Number((await readJson(req)).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Nieprawidłowa opinia.");
  const [r] = isAdmin(user)
    ? await db.query("DELETE FROM parking_opinions WHERE id = ?", [id])
    : await db.query("DELETE FROM parking_opinions WHERE id = ? AND user_id = ?", [id, user.id]);
  if (!r.affectedRows) throw new HttpError(404, "Nie znaleziono opinii.");
  return [200, {}];
};

// ── Znajomi: zaproszenia po e-mailu i obecność (pozycja, postój, cel, tachograf) ──
// Widzimy się dopiero po akceptacji drugiej strony. Obecność wysyła aplikacja co ~20 s przy włączonym GPS
// i udostępnianiu; wyłączenie udostępniania kasuje wiersz z bazy.

const FRIENDS_SQL = `
  SELECT f.user_id, f.friend_id, f.accepted_at, u.email, u.name, p.data AS presence, p.updated_at AS presence_at
  FROM friends f
  JOIN users u ON u.id = IF(f.user_id = ?, f.friend_id, f.user_id)
  LEFT JOIN presence p ON p.user_id = u.id
  WHERE f.user_id = ? OR f.friend_id = ?
  ORDER BY f.accepted_at IS NULL, u.name, u.email`;

routes["GET /api/friends"] = async (req, user) => {
  const [rows] = await db.query(FRIENDS_SQL, [user.id, user.id, user.id]);
  const now = Date.now();
  return [200, { friends: rows.map((r) => friendView(r, user.id, now)) }];
};

routes["POST /api/friends/invite"] = async (req, user) => {
  const email = String((await readJson(req)).email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Podaj prawidłowy adres e-mail.");
  if (email === user.email) throw new HttpError(400, "To Twój własny adres.");
  // Zaproszenia zdradzają, czy konto istnieje — dlatego limit prób jak przy logowaniu.
  if (limited(`inv:${user.id}`)) throw new HttpError(429, "Za dużo zaproszeń. Spróbuj za kilkanaście minut.");
  const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
  if (!rows.length) throw new HttpError(404, "Nie ma konta RoadPilot z tym adresem. Znajomy musi najpierw założyć konto.");
  const other = rows[0].id;
  // Druga strona już nas zaprosiła → to jest akceptacja.
  const [back] = await db.query("SELECT accepted_at FROM friends WHERE user_id = ? AND friend_id = ?", [other, user.id]);
  if (back.length) {
    if (!back[0].accepted_at) await db.query("UPDATE friends SET accepted_at = NOW() WHERE user_id = ? AND friend_id = ?", [other, user.id]);
    return [200, { relation: "accepted" }];
  }
  await db.query("INSERT IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", [user.id, other]);
  return [201, { relation: "invited" }];
};

routes["POST /api/friends/accept"] = async (req, user) => {
  const id = Number((await readJson(req)).id);
  const [r] = await db.query("UPDATE friends SET accepted_at = NOW() WHERE user_id = ? AND friend_id = ? AND accepted_at IS NULL", [id, user.id]);
  if (!r.affectedRows) throw new HttpError(404, "Nie ma takiego zaproszenia.");
  return [200, {}];
};

/** Usunięcie znajomego, odrzucenie albo wycofanie zaproszenia — w obie strony. */
routes["DELETE /api/friends"] = async (req, user) => {
  const id = Number((await readJson(req)).id);
  await db.query("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [user.id, id, id, user.id]);
  return [200, {}];
};

routes["POST /api/presence"] = async (req, user) => {
  const body = await readJson(req);
  if (body.off) {
    await db.query("DELETE FROM presence WHERE user_id = ?", [user.id]);
    return [200, {}];
  }
  let p;
  try {
    p = cleanPresence(body, Date.now());
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const [prev] = await db.query("SELECT data FROM presence WHERE user_id = ?", [user.id]);
  try {
    if (prev.length) p = keepReplayedPosAt(JSON.parse(prev[0].data), p);
  } catch {
    /* uszkodzony wiersz — zapisujemy nowy */
  }
  await db.query("INSERT INTO presence (user_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW(3)", [user.id, JSON.stringify(p)]);
  return [200, {}];
};

// ── Administracja: nadawanie Premium ────────────────────────────────────────

/** Podgląd mapy danych: ograniczenia z OSM, zgłoszenia kierowców i ślady w widocznym obszarze. */
routes["GET /api/admin/map"] = async (req, user) => {
  requireAdmin(user);
  const q = new URL(req.url, "http://x").searchParams;
  const [minLat, maxLat, minLon, maxLon] = ["minLat", "maxLat", "minLon", "maxLon"].map((k) => Number(q.get(k)));
  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite) || maxLat - minLat > 3 || maxLon - minLon > 5) throw new HttpError(400, "Za duży obszar — przybliż mapę.");
  const kinds = (q.get("kinds") ?? "").split(",").filter((k) => /^[a-z_]{2,12}$/.test(k));
  const box = [minLat, maxLat, minLon, maxLon];
  let osm = [];
  if (kinds.length) {
    const [rows] = await db.query(
      `SELECT osm_id, kind, value, raw, lat, lon, geom, name, bridge FROM osm_restrictions
       WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND kind IN (?)
       ORDER BY FIELD(kind, 'height', 'hgv', 'weight', 'width', 'length', 'speed_hgv', 'axle') LIMIT 3000`,
      [...box, kinds],
    );
    osm = rows.map((r) => ({ id: r.osm_id, kind: r.kind, value: r.value === null ? null : Number(r.value), raw: r.raw, lat: r.lat, lon: r.lon, geom: r.geom ? JSON.parse(r.geom) : null, name: r.name, bridge: !!r.bridge }));
  }
  const [reports] = q.get("reports") === "1"
    ? await db.query("SELECT r.id, r.kind, r.value, r.note, r.lat, r.lon, r.created_at, u.email FROM road_reports r JOIN users u ON u.id = r.user_id WHERE r.lat BETWEEN ? AND ? AND r.lon BETWEEN ? AND ? ORDER BY r.id DESC LIMIT 1000", box)
    : [[]];
  const [traces] = q.get("traces") === "1"
    ? await db.query("SELECT lat, lon FROM gps_points WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY id DESC LIMIT 5000", box)
    : [[]];
  return [200, {
    osm,
    reports: reports.map((r) => ({ id: r.id, kind: r.kind, value: r.value === null ? null : Number(r.value), note: r.note, lat: r.lat, lon: r.lon, at: new Date(r.created_at).getTime(), email: r.email })),
    traces: traces.map((t) => [t.lat, t.lon]),
  }];
};

/** Zgłoszenia kierowców porównane z OSM (ostatnie 500) — co dodać albo poprawić w mapie. */
routes["GET /api/admin/compare"] = async (req, user) => {
  requireAdmin(user);
  const [rows] = await db.query("SELECT id, user_id, kind, value, lat, lon, created_at FROM road_reports ORDER BY id DESC LIMIT 500");
  const reports = rows.map((r) => ({ id: r.id, userId: r.user_id, kind: r.kind, value: r.value === null ? null : Number(r.value), lat: r.lat, lon: r.lon, at: new Date(r.created_at).getTime() }));
  const osm = [];
  const seen = new Set();
  for (const r of reports) {
    const kind = REPORT_TO_OSM[r.kind];
    if (!kind) continue;
    const [near] = await db.query(
      "SELECT osm_id AS id, kind, value, raw, lat, lon, geom FROM osm_restrictions WHERE kind = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 50",
      [kind, r.lat - 0.004, r.lat + 0.004, r.lon - 0.006, r.lon + 0.006],
    );
    for (const f of near) {
      if (seen.has(f.id + f.kind)) continue;
      seen.add(f.id + f.kind);
      osm.push({ ...f, value: f.value === null ? null : Number(f.value), geom: f.geom ? JSON.parse(f.geom) : null });
    }
  }
  return [200, { items: compareReports(reports, osm) }];
};

routes["GET /api/admin/stats"] = async (req, user) => {
  requireAdmin(user);
  const period = periodKey();
  const [usage] = await db.query("SELECT api, count FROM api_usage WHERE period = ?", [period]);
  const used = Object.fromEntries(usage.map((u) => [u.api, u.count]));
  const [[pts]] = await db.query("SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM gps_points");
  const [[consents]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE data_consent_at IS NOT NULL");
  const [reports] = await db.query("SELECT kind, COUNT(*) AS n FROM road_reports GROUP BY kind");
  const [osmKinds] = await db.query("SELECT kind, COUNT(*) AS n FROM osm_restrictions GROUP BY kind");
  const [recent] = await db.query("SELECT r.kind, r.lat, r.lon, r.value, r.note, r.created_at, u.email FROM road_reports r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 20");
  return [200, {
    period,
    periodKind: TOMTOM_PERIOD,
    share: BUDGET_SHARE,
    apis: Object.keys(TOMTOM_LIMITS).map((api) => ({ api, used: used[api] ?? 0, limit: TOMTOM_LIMITS[api], cap: Math.floor(TOMTOM_LIMITS[api] * BUDGET_SHARE) })),
    points: pts.n,
    pointUsers: pts.users,
    consents: consents.n,
    reports: Object.fromEntries(reports.map((r) => [r.kind, r.n])),
    osm: Object.fromEntries(osmKinds.map((r) => [r.kind, r.n])),
    recent: recent.map((r) => ({ kind: r.kind, lat: r.lat, lon: r.lon, value: r.value === null ? null : Number(r.value), note: r.note, at: new Date(r.created_at).getTime(), email: r.email })),
  }];
};

/** Administracja → Błędy mapy: podejrzane ograniczenia (z jazdy kierowców) i zgłoszenia „zły manewr”. */
routes["GET /api/admin/mapcheck"] = async (req, user) => {
  requireAdmin(user);
  const [suspects] = await db.query("SELECT s.osm_id, s.kind, s.value, s.users, s.lat, s.lon, s.name, s.updated_at, o.osm_id IS NOT NULL AS hidden FROM map_suspects s LEFT JOIN osm_overrides o ON o.osm_id = s.osm_id AND o.kind = s.kind ORDER BY s.users DESC LIMIT 200");
  const [hidden] = await db.query("SELECT o.osm_id, o.kind, r.value, r.name, r.lat, r.lon FROM osm_overrides o LEFT JOIN osm_restrictions r ON r.osm_id = o.osm_id AND r.kind = o.kind ORDER BY o.created_at DESC LIMIT 200");
  const [turns] = await db.query("SELECT user_id AS user, lat, lon, heading, note FROM road_reports WHERE kind = 'bad_turn' ORDER BY id DESC LIMIT 2000");
  return [200, { suspects: suspects.map((r) => ({ ...r, hidden: !!r.hidden })), hidden, badTurns: badTurnClusters(turns) }];
};

/** Ukrycie (hide: true) / przywrócenie ograniczenia z OSM — działa od razu dla tras i ostrzeżeń. */
routes["POST /api/admin/override"] = async (req, user) => {
  requireAdmin(user);
  const b = await readJson(req);
  const osmId = String(b.osmId ?? ""), kind = String(b.kind ?? "");
  if (!/^[nwr]\d{1,18}$/.test(osmId) || !/^[a-z_]{2,12}$/.test(kind)) throw new HttpError(400, "Nieprawidłowe ograniczenie.");
  if (b.hide) await db.query("INSERT IGNORE INTO osm_overrides (osm_id, kind, hidden_by) VALUES (?, ?, ?)", [osmId, kind, user.id]);
  else await db.query("DELETE FROM osm_overrides WHERE osm_id = ? AND kind = ?", [osmId, kind]);
  return [200, {}];
};

// ── Ustawienia aplikacji (admin) ─────────────────────────────────────────────

/** Klucze app_config widoczne w aplikacji (także bez konta) i ich walidacja. */
const CONFIG_KEYS = {
  // Link do wpłat (Revolut) na stronie „Wsparcie” — tylko https.
  supportUrl: (v) => (v === "" || /^https:\/\/[^\s<>"']{4,300}$/.test(v) ? v : null),
};

async function readConfig() {
  const [rows] = await db.query("SELECT k, v FROM app_config");
  const out = Object.fromEntries(Object.keys(CONFIG_KEYS).map((k) => [k, ""]));
  for (const r of rows) if (r.k in CONFIG_KEYS) out[r.k] = r.v;
  return out;
}

routes["GET /api/config"] = async () => [200, await readConfig()];

routes["PUT /api/admin/config"] = async (req, user) => {
  requireAdmin(user);
  const b = await readJson(req);
  for (const [k, check] of Object.entries(CONFIG_KEYS)) {
    if (!(k in b)) continue;
    const v = check(String(b[k] ?? "").trim());
    if (v === null) throw new HttpError(400, "Link musi zaczynać się od https://");
    await db.query("INSERT INTO app_config (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [k, v]);
  }
  return [200, await readConfig()];
};

function requireAdmin(user) {
  if (!isAdmin(user)) throw new HttpError(403, "Tylko dla administratora.");
}

const adminUser = (u) => ({ ...publicUser(u), createdAt: new Date(u.created_at).getTime() });

routes["GET /api/admin/users"] = async (req, user) => {
  requireAdmin(user);
  const q = (new URL(req.url, "http://x").searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  const [rows] = await db.query(
    "SELECT id, email, name, role, premium_until, data_consent_at, created_at FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 50",
    [`%${q}%`, `%${q}%`],
  );
  return [200, { users: rows.map(adminUser) }];
};

/** Premium dla konta: days = liczba dni od teraz, null = bez terminu, 0 = odebranie. */
routes["POST /api/admin/premium"] = async (req, user) => {
  requireAdmin(user);
  const body = await readJson(req);
  const id = Number(body.userId);
  const days = body.days === null ? null : Number(body.days);
  if (!Number.isInteger(id) || (days !== null && !(Number.isInteger(days) && days >= 0 && days <= 3650))) throw new HttpError(400, "Nieprawidłowe dane.");
  if (days === 0) await db.query("UPDATE users SET premium_until = NULL WHERE id = ?", [id]);
  else if (days === null) await db.query("UPDATE users SET premium_until = '9999-12-31 00:00:00' WHERE id = ?", [id]);
  else await db.query("UPDATE users SET premium_until = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?", [days, id]);
  const [rows] = await db.query("SELECT id, email, name, role, premium_until, data_consent_at, created_at FROM users WHERE id = ?", [id]);
  if (!rows.length) throw new HttpError(404, "Nie ma takiego konta.");
  return [200, { user: adminUser(rows[0]) }];
};

// ── Klucze Premium ──

const KEYS_SQL = `SELECT k.code, k.label, k.days, k.note, k.max_uses, k.created_at, f.email AS for_email,
  (SELECT COUNT(*) FROM premium_redemptions r WHERE r.code = k.code) AS uses,
  (SELECT MAX(r.used_at) FROM premium_redemptions r WHERE r.code = k.code) AS last_used,
  (SELECT GROUP_CONCAT(u.email ORDER BY r.used_at DESC) FROM premium_redemptions r JOIN users u ON u.id = r.user_id WHERE r.code = k.code) AS used_emails
  FROM premium_keys k LEFT JOIN users f ON f.id = k.for_user`;

/**
 * Nowa licencja: code — własny klucz (pusty = losowy RP-XXXX-XXXX), days — 1–3650 albo null (bez terminu),
 * forEmail — tylko dla tego konta, maxUses — ile osób (null = bez limitu, „dla wszystkich”), note — dla kogo (tylko w Administracji).
 */
routes["POST /api/admin/keys"] = async (req, user) => {
  requireAdmin(user);
  const body = await readJson(req);
  const days = body.days === null ? null : Number(body.days);
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= MAX_KEY_DAYS)) throw new HttpError(400, "Liczba dni: od 1 do 3650.");
  const note = String(body.note ?? "").trim().slice(0, 120);
  const maxUses = body.maxUses === null ? null : Number(body.maxUses ?? 1);
  if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 100000)) throw new HttpError(400, "Liczba osób: od 1 do 100 000 albo bez limitu.");
  let forUser = null;
  const forEmail = String(body.forEmail ?? "").trim().toLowerCase();
  if (forEmail) {
    const [[u]] = await db.query("SELECT id FROM users WHERE LOWER(email) = ?", [forEmail]);
    if (!u) throw new HttpError(404, `Nie ma konta ${forEmail}.`);
    forUser = u.id;
  }
  const own = String(body.code ?? "").trim();
  const candidates = own ? [own] : Array.from({ length: 5 }, () => makeKey(randomInt));
  for (const label of candidates) {
    const code = canonKey(label);
    if (!code) throw new HttpError(400, "Klucz: 4–40 liter lub cyfr (spacje i myślniki można).");
    const [r] = await db.query("INSERT IGNORE INTO premium_keys (code, label, days, note, created_by, for_user, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)", [code, label.slice(0, 40), days, note, user.id, forUser, maxUses]);
    if (r.affectedRows) {
      const [rows] = await db.query(`${KEYS_SQL} WHERE k.code = ?`, [code]);
      return [201, { key: keyView(rows[0]) }];
    }
    if (own) throw new HttpError(409, "Taki klucz już istnieje — wymyśl inny.");
  }
  throw new HttpError(500, "Nie udało się wygenerować klucza.");
};

routes["GET /api/admin/keys"] = async (req, user) => {
  requireAdmin(user);
  const [rows] = await db.query(`${KEYS_SQL} ORDER BY k.created_at DESC LIMIT 100`);
  return [200, { keys: rows.map(keyView) }];
};

/** Wyłączenie klucza (nikt więcej go nie użyje); Premium nadane wcześniej zostaje. */
routes["DELETE /api/admin/keys"] = async (req, user) => {
  requireAdmin(user);
  const code = canonKey((await readJson(req)).key);
  if (!code) throw new HttpError(400, "Nieprawidłowy klucz.");
  const [r] = await db.query("DELETE FROM premium_keys WHERE code = ?", [code]);
  if (!r.affectedRows) throw new HttpError(404, "Nie ma takiego klucza.");
  return [200, { ok: true }];
};

/** Kierowca wpisuje klucz: jednorazowy, dni dokładane do trwającego Premium. */
routes["POST /api/premium/redeem"] = async (req, user) => {
  navThrottle("redeem", req);
  const typed = canonKey((await readJson(req)).key);
  if (!typed) throw new HttpError(400, "Wpisz klucz licencyjny (litery i cyfry).");
  // Stare klucze wpisywane bez „RP”.
  const [[key]] = await db.query("SELECT code, days, for_user, max_uses FROM premium_keys WHERE code = ? OR code = ?", [typed, `RP${typed}`]);
  const [[cnt]] = key ? await db.query("SELECT COUNT(*) AS n, SUM(user_id = ?) AS mine FROM premium_redemptions WHERE code = ?", [user.id, key.code]) : [[{ n: 0, mine: 0 }]];
  const problem = redeemProblem(key, user.id, Number(cnt.n), Number(cnt.mine) > 0, user.premium_until, Date.now());
  if (problem) throw new HttpError(key ? 409 : 404, problem);
  // Limit użyć pilnuje warunkowy INSERT … SELECT — dwa konta naraz nie przekroczą max_uses.
  const [r] = await db.query(
    `INSERT IGNORE INTO premium_redemptions (code, user_id) SELECT ?, ? FROM DUAL
     WHERE ? IS NULL OR (SELECT COUNT(*) FROM premium_redemptions WHERE code = ?) < ?`,
    [key.code, user.id, key.max_uses, key.code, key.max_uses],
  );
  if (!r.affectedRows) throw new HttpError(409, "Limit użyć tego klucza się wyczerpał.");
  const until = extendPremium(user.premium_until, key.days, Date.now());
  await db.query("UPDATE users SET premium_until = ? WHERE id = ?", [until, user.id]);
  const [rows] = await db.query("SELECT id, email, name, role, premium_until, data_consent_at FROM users WHERE id = ?", [user.id]);
  return [200, { user: publicUser(rows[0]), days: key.days }];
};

// ── Kafelki mapy (TomTom, styl nocny) — przez serwer: klucz nie trafia do telefonu, każdy kafelek w budżecie ──

const TILE_RE = /^\/api\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/;
const VTILE_RE = /^\/api\/vtiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;

/** Czy własne kafelki są skonfigurowane i zbudowane. */
const vtilesReady = async () => !!VTILES_DIR && (await stat(`${VTILES_DIR}/metadata.json`).then(() => true, () => false));

routes["GET /api/vtiles/meta"] = async () => [200, { available: await vtilesReady(), bounds: VTILES_BOUNDS }];

/** Kafelek wektorowy z dysku (gzip z tilemakera). Brak pliku = pusty kafelek (204), nie błąd. Dane OSM (ODbL) — dla każdego konta. */
async function vtile(req, res, m) {
  const user = await authUser(req);
  if (!user) throw new HttpError(401, "Sesja wygasła — zaloguj się ponownie.");
  if (!VTILES_DIR) throw new HttpError(404, "Własna mapa nie jest skonfigurowana.");
  const [z, x, y] = m.slice(1).map(Number);
  if (z < 0 || z > 20 || x >= 2 ** z || y >= 2 ** z) throw new HttpError(400, "Nieprawidłowy kafelek.");
  let body;
  try {
    body = await readFile(`${VTILES_DIR}/${z}/${x}/${y}.pbf`);
  } catch {
    res.writeHead(204, { "Cache-Control": "private, max-age=3600" });
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "application/x-protobuf", "Content-Encoding": "gzip", "Cache-Control": "private, max-age=86400", "Content-Length": body.length });
  res.end(body);
}
/** Pamięć kafelków na serwerze (zgodnie z Cache-Control TomTom, 24 h) — ten sam kafelek dla wielu kierowców liczy się raz. */
const TILE_CACHE = new Map();
const TILE_CACHE_MAX = 3000;
const TILE_TTL = 86_400_000;

async function tile(req, res, m) {
  const user = await authUser(req);
  if (!user) throw new HttpError(401, "Sesja wygasła — zaloguj się ponownie.");
  requirePremium(user);
  const [z, x, y] = m.slice(1).map(Number);
  if (z < 3 || z > 18 || x >= 2 ** z || y >= 2 ** z) throw new HttpError(400, "Nieprawidłowy kafelek.");
  const key = `${z}/${x}/${y}`;
  let hit = TILE_CACHE.get(key);
  if (!hit || Date.now() - hit.at > TILE_TTL) {
    userDaily("tiles", user);
    await spend("tiles");
    if (!TOMTOM_KEY) throw new HttpError(503, "Mapa nie jest skonfigurowana na serwerze.");
    let r;
    try {
      r = await fetch(`https://api.tomtom.com/map/1/tile/basic/night/${key}.png?key=${TOMTOM_KEY}&tileSize=512&view=Unified&language=pl-PL`, { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new HttpError(502, "Brak połączenia z mapą.");
    }
    if (!r.ok) throw new HttpError(502, "Mapa chwilowo niedostępna.");
    hit = { at: Date.now(), body: Buffer.from(await r.arrayBuffer()) };
    TILE_CACHE.delete(key);
    TILE_CACHE.set(key, hit);
    if (TILE_CACHE.size > TILE_CACHE_MAX) TILE_CACHE.delete(TILE_CACHE.keys().next().value);
  }
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400", "Content-Length": hit.body.length });
  res.end(hit.body);
}

/** CORS dla aplikacji z innej domeny (np. tuike.pl) — tylko adresy z APP_ORIGINS. */
function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !APP_ORIGINS.includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname.replace(/\/+$/, "");
  const key = `${req.method} ${path}`;
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (key === "GET /api/health") {
      await db.query("SELECT 1");
      return send(res, 200, { ok: true });
    }
    const tm = req.method === "GET" && TILE_RE.exec(path + (path.endsWith(".png") ? "" : ""));
    if (tm) return await tile(req, res, tm);
    const vm = req.method === "GET" && VTILE_RE.exec(path);
    if (vm) return await vtile(req, res, vm);
    const handler = routes[key];
    if (!handler) throw new HttpError(404, "Nie znaleziono.");
    let user = null;
    if (!PUBLIC.has(key)) {
      user = await authUser(req);
      if (!user) throw new HttpError(401, "Sesja wygasła — zaloguj się ponownie.");
    }
    const [status, body] = await handler(req, user);
    send(res, status, body);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(key, e);
    send(res, 500, { error: "Błąd serwera. Spróbuj ponownie za chwilę." });
  }
});

await db.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
// Sprzątanie wygasłych sesji raz na dobę.
setInterval(() => db.query("DELETE FROM sessions WHERE expires_at < NOW()").catch(() => {}), 86_400_000).unref();
server.listen(PORT, "127.0.0.1", () => console.log(`RoadPilot API na 127.0.0.1:${PORT}`));
