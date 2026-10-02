// Ograniczenia warunkowe z OSM (`maxweight:conditional`, `hgv:conditional` …): „wartość @ warunek”, np.
// „no @ (22:00-06:00)”, „25 @ (12:00-18:00;21:00-8:00)”, „none @ destination”, „yes @ delivery AND 05:00-10:00 AND weight<10”.
// Parser podzbioru składni (godziny, dni tygodnia, święta PL, waga, rodzaj użytkownika) i ocena „czy obowiązuje tego
// kierowcę w chwili przejazdu”. Czyste funkcje (czas przychodzi parametrem); testy w conditional.test.mjs.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Podział po separatorze poza nawiasami. */
function splitTop(s, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const stripParens = (s) => {
  let t = s.trim();
  while (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
  return t;
};

const minutes = (h, m) => Number(h) * 60 + Number(m);

/** „Mo-Fr”, „Sa,Su”, „PH” → numery dni (0 = niedziela) i święta. */
function parseDays(s) {
  const days = new Set();
  let ph = false;
  for (const part of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (part === "PH") { ph = true; continue; }
    const m = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part);
    if (!m) return null;
    const a = DAYS.indexOf(m[1]);
    const b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let d = a; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === b) break;
    }
  }
  return { days, ph };
}

/**
 * Warunek czasu („Mo-Fr 06:00-22:00; Sa 08:00-14:00”, „22:00-06:00”, „Su,PH”) → reguły { days?, ph, ranges? };
 * null, gdy to nie jest czas.
 */
export function parseTime(s) {
  const rules = [];
  for (const rule of s.split(/;/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?|PH)(?:\s*,\s*(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?|PH))*)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const d = m[1] ? parseDays(m[1].replace(/\s/g, "")) : null;
    if (m[1] && !d) return null;
    const times = m[2].trim();
    let ranges = null;
    if (times) {
      ranges = [];
      for (const r of times.split(",").map((x) => x.trim()).filter(Boolean)) {
        const t = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(r);
        if (!t) return null;
        ranges.push([minutes(t[1], t[2]), minutes(t[3], t[4])]);
      }
    }
    if (!d && !ranges) return null;
    rules.push({ days: d ? [...d.days] : null, ph: d?.ph ?? false, ranges });
  }
  return rules.length ? rules : null;
}

/** Wpis „wartość @ warunek; …” → [{ value, users?, time?, weight? }]; warunki nierozpoznane = wpis pominięty. */
export function parseConditional(raw) {
  const out = [];
  for (const item of splitTop(String(raw ?? ""), ";")) {
    const at = item.indexOf("@");
    if (at < 0) continue;
    const value = item.slice(0, at).trim().toLowerCase();
    const cond = stripParens(item.slice(at + 1));
    const entry = { value };
    let ok = true;
    for (const term of cond.split(/\s+AND\s+/i).map(stripParens)) {
      const w = /^weight\s*([<>]=?)\s*(\d+(?:[.,]\d+)?)$/i.exec(term);
      if (w) { entry.weight = { op: w[1], t: Number(w[2].replace(",", ".")) }; continue; }
      if (/\d{1,2}:\d{2}|^(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/.test(term)) {
        const time = parseTime(term);
        if (!time) { ok = false; break; }
        entry.time = time;
        continue;
      }
      const users = term.split(/[;,]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (!users.length || users.some((u) => !/^[a-z_]+$/.test(u))) { ok = false; break; }
      entry.users = users;
    }
    if (ok) out.push(entry);
  }
  return out;
}

// ── Święta w Polsce (dni wolne od pracy) ──────────────────────────────────────────────────────────────────
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}

/** Czy dzień (rok, miesiąc 1–12, dzień) to święto ustawowe w Polsce. */
export function isPolishHoliday(y, mo, d) {
  const fixed = ["1-1", "1-6", "5-1", "5-3", "8-15", "11-1", "11-11", "12-24", "12-25", "12-26"];
  if (fixed.includes(`${mo}-${d}`)) return true;
  const e = easter(y);
  const day = Date.UTC(y, mo - 1, d);
  return [0, 1, 49, 60].some((off) => e + off * 86_400_000 === day); // Wielkanoc, Poniedziałek Wielkanocny, Zielone Świątki, Boże Ciało
}

/** Czas lokalny w Polsce: dzień tygodnia (0 = niedziela), minuty od północy, święto. */
export function warsawTime(t) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const dow = DAYS.indexOf(parts.weekday.slice(0, 2));
  return { dow, min: Number(parts.hour) * 60 + Number(parts.minute), ph: isPolishHoliday(Number(parts.year), Number(parts.month), Number(parts.day)) };
}

/** Czy reguły czasu obejmują chwilę `t` (przedziały przez północ, np. 22:00-06:00, liczą się do dnia, w którym się zaczęły). */
export function timeMatches(rules, t) {
  const now = warsawTime(t);
  const prev = warsawTime(t - 86_400_000);
  const dayOk = (r, w) => (!r.days && !r.ph) || (r.days ?? []).includes(w.dow) || (r.ph && w.ph);
  for (const r of rules) {
    if (!r.ranges) { if (dayOk(r, now)) return true; continue; }
    for (const [a, b] of r.ranges) {
      if (a <= b ? dayOk(r, now) && now.min >= a && now.min < b : (dayOk(r, now) && now.min >= a) || (dayOk(r, prev) && now.min < b)) return true;
    }
  }
  return false;
}

/** Kto jest „nami”: dojazd do celu / dostawa w strefie (przy celu albo starcie); bus, marked, permit … — nie my. */
const usersMatch = (users, nearDest) => !users || users.some((u) => (u === "destination" || u === "delivery" || u === "hgv" || u === "goods") ? (u === "hgv" || u === "goods" || nearDest) : false);

const weightMatches = (w, tons) => !w || (w.op === ">" ? tons > w.t : w.op === ">=" ? tons >= w.t : w.op === "<" ? tons < w.t : tons <= w.t);

/**
 * Ograniczenie w chwili przejazdu. `kind` "weight" (wartość = t albo brak limitu) albo "hgv" (no / destination / delivery / yes).
 * `base` — wartość bez warunku (null = brak), `items` — z parseConditional. Ostatni pasujący wpis wygrywa.
 * Zwraca { active, value } — dla hgv `active` = zakaz obowiązuje (destination/delivery przy celu = nie).
 */
export function effectiveRestriction(kind, base, items, ctx) {
  let v = base;
  for (const it of items ?? []) {
    if (!usersMatch(it.users, ctx.nearDest)) continue;
    if (it.time && !timeMatches(it.time, ctx.t)) continue;
    if (!weightMatches(it.weight, ctx.weightT)) continue;
    v = it.value;
  }
  if (kind === "weight") {
    const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? { active: ctx.weightT > n, value: n } : { active: false, value: null };
  }
  const s = String(v ?? "").toLowerCase();
  if (s === "no") return { active: true, value: s };
  if (s === "destination" || s === "delivery") return { active: !ctx.nearDest, value: s };
  return { active: false, value: s || null };
}

/** Krótki opis warunków do ostrzeżenia: „22:00–06:00”, „Sa 08:00–14:00”, „dojazd dozwolony”. */
export function conditionNote(items) {
  const parts = [];
  for (const it of items ?? []) {
    if (it.users?.some((u) => u === "destination" || u === "delivery")) parts.push(it.value === "none" || it.value === "yes" ? "dojazd / dostawy dozwolone" : "");
    if (it.time) {
      parts.push(it.time.map((r) => [r.days?.length ? r.days.map((d) => DAYS[d]).join(",") : "", r.ph ? "święta" : "", (r.ranges ?? []).map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(", ")].filter(Boolean).join(" ")).join("; "));
    }
  }
  return [...new Set(parts.filter(Boolean))].join(" · ");
}

const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
