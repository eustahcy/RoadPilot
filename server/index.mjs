// RoadPilot API — konta (rejestracja, logowanie) i synchronizacja stanu aplikacji w MariaDB.
// Bez frameworka: node:http + mysql2. Słucha tylko na 127.0.0.1 — z zewnątrz przez Nginx (/roadpilot/api/ → /api/).
// Konfiguracja ze zmiennych środowiska (plik /etc/roadpilot-api.env): DB_SOCKET albo DB_HOST + DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, PORT;
// poczta: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM_EMAIL, MAIL_FROM_NAME;
// APP_ORIGINS — adresy, z których działa aplikacja (CORS i linki w e-mailach), np. "https://tuike.pl,https://www.tuike.pl".

import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { cleanPoints, cleanReport, inPoland } from "./collect.mjs";
import { HERE_MAX_POINTS, limitHere, parseValhalla, parseValhallaAlternates, roadInfo, traceChunks, tracePoints, traceRequest, valhallaRequest } from "./valhalla.mjs";
import { ALERT_KINDS, ALERT_TTL_H, applyVotes, blockingPoints, routeAlerts, routeBoxes, routeWarnings } from "./warnings.mjs";
import { compareReports, REPORT_TO_OSM } from "./compare.mjs";
import { parseRoutes, parseSearch, ROUTE_TYPES, routeError, routeUrl, searchUrl, validPoint } from "./nav.mjs";
import { cleanPresence, friendView, keepReplayedPosAt } from "./friends.mjs";
import { routePois } from "./pois.mjs";
import { extendPremium, keyView, makeKey, MAX_KEY_DAYS, normalizeKey } from "./premium.mjs";
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

const PUBLIC = new Set(["POST /api/register", "POST /api/login", "POST /api/password/forgot", "POST /api/password/reset"]);

// ── Nawigacja (TomTom) ──────────────────────────────────────────────────────
// Tylko dla kont Premium (i adminów); limit zapytań na adres IP dodatkowo chroni limit klucza.

function requirePremium(user) {
  if (!hasPremium(user)) throw new HttpError(403, "Nawigacja jest dostępna w RoadPilot Premium.");
}

const NAV_LIMITS = { search: { max: 120, windowMs: 10 * 60_000 }, route: { max: 30, windowMs: 10 * 60_000 }, here: { max: 600, windowMs: 10 * 60_000 }, nearby: { max: 60, windowMs: 10 * 60_000 }, gap: { max: 20, windowMs: 10 * 60_000 }, where: { max: 60, windowMs: 10 * 60_000 }, redeem: { max: 10, windowMs: 60 * 60_000 } };

// Limity darmowego planu TomTom (z panelu my.tomtom.com) — nie przekraczamy BUDGET_SHARE z nich.
// Okres: miesiąc (bezpieczniej) albo dzień — TOMTOM_PERIOD=day, jeśli limity w panelu są dzienne.
const TOMTOM_LIMITS = { search: Number(process.env.TOMTOM_LIMIT_SEARCH ?? 2500), route: Number(process.env.TOMTOM_LIMIT_ROUTING ?? 20000), tiles: Number(process.env.TOMTOM_LIMIT_TILES ?? 200000) };
const TOMTOM_PERIOD = process.env.TOMTOM_PERIOD === "day" ? "day" : "month";
const BUDGET_SHARE = 0.8;
/** Na jedno konto dziennie — żeby jeden kierowca nie zużył limitu wszystkich (admin bez limitu). */
const PER_USER_DAY = { search: 150, route: 40, tiles: 1500 };
const USER_HITS = new Map();

const API_NAMES = { search: "wyszukiwań", route: "tras", tiles: "mapy" };

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

/** Trasa Valhalla + ograniczenia ze znaków i rodzaj drogi (trace_attributes po kawałkach); błąd = trasa bez nich. */
async function withRoadInfo(route) {
  if (!route) return route;
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

async function valhallaOnce(from, to, vehicle, exclude, routeType = "fastest", via = []) {
  let r;
  try {
    r = await fetch(`${VALHALLA_URL}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valhallaRequest(from, to, vehicle, exclude, 0, routeType, via)), signal: AbortSignal.timeout(30_000) });
  } catch {
    return null;
  }
  return r.ok ? parseValhalla(await r.json().catch(() => null)) : null;
}

/**
 * Trasa z własnego silnika (Valhalla, OSM Polska). Valhalla nie zawsze uwzględnia tagi ograniczeń z OSM, więc
 * sprawdzamy trasę naszą bazą i przy twardym konflikcie (oś, masa, wysokość, szerokość, długość, zakaz) liczymy
 * od nowa z tym miejscem wykluczonym. Gdy objazdu nie ma — zostaje ostatnia wykonalna trasa z ostrzeżeniami.
 */
async function valhallaRoute(from, to, vehicle, routeType = "fastest", via = []) {
  if (!VALHALLA_URL) return null;
  let veh;
  try {
    veh = parseVehicle(vehicle);
  } catch {
    return withRoadInfo(await valhallaOnce(from, to, vehicle, [], routeType, via));
  }
  const exclude = [];
  const seen = new Set();
  let best = await valhallaOnce(from, to, vehicle, exclude, routeType, via);
  if (!best) return null;
  for (let i = 0; i < MAX_DETOURS; i++) {
    const blocking = blockingPoints(await findWarnings(best.points, veh, false), best.lengthKm).filter((p) => !seen.has(p.key));
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
    const r = await fetch(`${VALHALLA_URL}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valhallaRequest(from, to, vehicle, [], 2, routeType)), signal: AbortSignal.timeout(30_000) });
    return r.ok ? Promise.all(parseValhallaAlternates(await r.json().catch(() => null)).map(withRoadInfo)) : [];
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

routes["POST /api/nav/route"] = async (req, user) => {
  requirePremium(user);
  navThrottle("route", req);
  const body = await readJson(req);
  const from = validPoint(body.from);
  const to = validPoint(body.to);
  if (!from || !to) throw new HttpError(400, "Brak punktu startu lub celu.");
  // Punkty pośrednie (przytrzymanie na mapie → „dodaj do trasy”); z nimi bez tras alternatywnych.
  const via = Array.isArray(body.via) ? body.via.map(validPoint) : [];
  if (via.length > MAX_VIA || via.some((p) => !p)) throw new HttpError(400, `Najwyżej ${MAX_VIA} punktów pośrednich.`);
  const withAlts = body.alternatives === true && !via.length;
  const routeType = ROUTE_TYPES.has(body.routeType) ? body.routeType : "fastest";
  let url;
  try {
    url = routeUrl(from, to, body.vehicle, TOMTOM_KEY, withAlts ? 2 : 0, routeType, via);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const ownPossible = !!VALHALLA_URL && [from, ...via, to].every((p) => inPoland(p.lat, p.lon));
  if (body.engine === "roadpilot" && ownPossible) {
    const own = await valhallaRoute(from, to, body.vehicle, routeType, via);
    if (own) return [200, { route: own, alternatives: withAlts ? distinct(own, (await valhallaAlternates(from, to, body.vehicle, routeType)).map((a) => ({ ...a, engine: "roadpilot" }))) : [] }];
  }
  userDaily("route", user);
  try {
    await spend("route");
  } catch (e) {
    const own = ownPossible ? await valhallaRoute(from, to, body.vehicle, routeType, via) : null;
    if (own) return [200, { route: { ...own, fallback: true } }];
    throw e;
  }
  const r = await tomtom(url);
  const [route, ...alts] = r.ok ? parseRoutes(r.json) : [];
  if (route) return [200, { route: { ...route, engine: "tomtom" }, alternatives: distinct(route, alts).map((a) => ({ ...a, engine: "tomtom" })) }];
  if (r.status >= 500 && ownPossible) {
    const own = await valhallaRoute(from, to, body.vehicle, routeType, via);
    if (own) return [200, { route: { ...own, fallback: true } }];
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
async function findWarnings(pts, vehicle, alerts = true) {
  const warnings = [];
  for (const box of routeBoxes(pts)) {
    const area = [box.minLat, box.maxLat, box.minLon, box.maxLon];
    const [osm] = await db.query(
      `SELECT 'osm' AS source, osm_id AS id, kind, value, raw, lat, lon, geom, name FROM osm_restrictions
       WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (
         (kind = 'height' AND value < ?) OR (kind = 'weight' AND value < ?) OR (kind = 'axle' AND value < ?) OR
         (kind = 'width' AND value < ?) OR (kind = 'length' AND value < ?) OR kind = 'hgv')`,
      [...area, vehicle.heightM, vehicle.weightKg / 1000, vehicle.axleWeightKg / 1000, vehicle.widthM, vehicle.lengthM],
    );
    const [rep] = await db.query(
      `SELECT 'report' AS source, id, kind, value, note AS raw, lat, lon, NULL AS geom, '' AS name FROM road_reports
       WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (
         (kind = 'height' AND value < ?) OR (kind = 'weight' AND value < ?) OR kind = 'truck_ban' OR
         (kind = 'closed' AND created_at > NOW() - INTERVAL 14 DAY))`,
      [...area, vehicle.heightM, vehicle.weightKg / 1000],
    );
    const rows = [...osm, ...rep].map((r) => ({ ...r, geom: typeof r.geom === "string" ? JSON.parse(r.geom) : r.geom }));
    warnings.push(...routeWarnings(pts, rows, vehicle, box));
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
  return warnings.filter((w, i) => !warnings.slice(0, i).some((p) => p.kind === w.kind && w.km - p.km < 0.15));
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
  return [200, { warnings: await findWarnings(pts, vehicle), pois: body.pois === false ? undefined : await findPois(pts) }];
};

/** Stacje paliw, MOP-y i parkingi TIR przy trasie (pinezki na mapie) — z osm_pois, bez kosztów TomTom. */
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
  const [rows] = await db.query("SELECT osm_id, kind, lat, lon, name, truck FROM osm_pois WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", [at.lat - dLat, at.lat + dLat, at.lon - dLon, at.lon + dLon]);
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
  const [pois] = await db.query("SELECT name, kind, lat, lon FROM osm_pois WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", box(POI_AT_M / 1000));
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

async function findPois(pts) {
  const out = [];
  for (const box of routeBoxes(pts, 25, 0.004)) {
    const [rows] = await db.query("SELECT osm_id, kind, lat, lon, name, truck FROM osm_pois WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", [box.minLat, box.maxLat, box.minLon, box.maxLon]);
    out.push(...routePois(pts, rows, box));
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
  await db.query("INSERT INTO road_reports (user_id, kind, lat, lon, heading, value, note) VALUES (?, ?, ?, ?, ?, ?, ?)", [user.id, r.kind, r.lat, r.lon, r.heading, r.value, r.note]);
  return [201, {}];
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

const KEYS_SQL = "SELECT k.code, k.days, k.note, k.created_at, k.used_at, u.email AS used_email FROM premium_keys k LEFT JOIN users u ON u.id = k.used_by";

/** Nowy klucz: days = liczba dni (1–3650), null = bez terminu; note = dla kogo (tylko w Administracji). */
routes["POST /api/admin/keys"] = async (req, user) => {
  requireAdmin(user);
  const body = await readJson(req);
  const days = body.days === null ? null : Number(body.days);
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= MAX_KEY_DAYS)) throw new HttpError(400, "Liczba dni: od 1 do 3650.");
  const note = String(body.note ?? "").trim().slice(0, 120);
  for (let i = 0; i < 5; i++) {
    const code = makeKey(randomInt);
    const [r] = await db.query("INSERT IGNORE INTO premium_keys (code, days, note, created_by) VALUES (?, ?, ?, ?)", [code, days, note, user.id]);
    if (r.affectedRows) {
      const [rows] = await db.query(`${KEYS_SQL} WHERE k.code = ?`, [code]);
      return [201, { key: keyView(rows[0]) }];
    }
  }
  throw new HttpError(500, "Nie udało się wygenerować klucza.");
};

routes["GET /api/admin/keys"] = async (req, user) => {
  requireAdmin(user);
  const [rows] = await db.query(`${KEYS_SQL} ORDER BY k.created_at DESC LIMIT 100`);
  return [200, { keys: rows.map(keyView) }];
};

/** Usunięcie niewykorzystanego klucza (np. wysłanego nie temu, komu trzeba). */
routes["DELETE /api/admin/keys"] = async (req, user) => {
  requireAdmin(user);
  const code = normalizeKey((await readJson(req)).key);
  if (!code) throw new HttpError(400, "Nieprawidłowy klucz.");
  const [r] = await db.query("DELETE FROM premium_keys WHERE code = ? AND used_by IS NULL", [code]);
  if (!r.affectedRows) throw new HttpError(409, "Klucz został już użyty albo nie istnieje.");
  return [200, { ok: true }];
};

/** Kierowca wpisuje klucz: jednorazowy, dni dokładane do trwającego Premium. */
routes["POST /api/premium/redeem"] = async (req, user) => {
  navThrottle("redeem", req);
  const code = normalizeKey((await readJson(req)).key);
  if (!code) throw new HttpError(400, "To nie wygląda na klucz RoadPilot (np. RP-7KQM-X2HD).");
  // Warunkowy UPDATE jest atomowy — ten sam klucz wpisany naraz na dwóch kontach zadziała tylko raz.
  const [r] = await db.query("UPDATE premium_keys SET used_by = ?, used_at = NOW() WHERE code = ? AND used_by IS NULL", [user.id, code]);
  if (!r.affectedRows) {
    const [k] = await db.query("SELECT used_by FROM premium_keys WHERE code = ?", [code]);
    throw new HttpError(k.length ? 409 : 404, k.length ? "Ten klucz został już użyty." : "Nie ma takiego klucza — sprawdź, czy dobrze przepisany.");
  }
  const [[key]] = await db.query("SELECT days FROM premium_keys WHERE code = ?", [code]);
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
