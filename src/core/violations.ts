// Przekroczenia czasu jazdy i odpoczynku z zapisu GPS: kiedy i gdzie przekroczono limit, o ile — do historii dziennej
// i notatki na wydruku z tachografu. Zapis jest pomocniczy: prawnym jest tachograf, a liczniki z GPS mogą się różnić.

import { DayLog, withDay } from "./history";
import { DriverState } from "./plan";
import { dutyWindow, RULES } from "./rules";
import { fmtDuration } from "./scenarios";

const MIN = 60_000;

export type ViolationKind = "continuous" | "daily" | "duty" | "shortRest" | "week" | "fortnight";

/** Gdzie to było — z serwera (miejscowości OSM, droga z mapy, MOP / stacja obok). */
export interface Where {
  place: { name: string; km: number; inside: boolean } | null;
  road: string | null;
  poi: { kind: "fuel" | "services" | "mop" | "parking"; name: string; m: number } | null;
}

export interface Violation {
  /** Rodzaj + chwila przekroczenia — stały klucz. */
  id: string;
  kind: ViolationKind;
  /** Chwila przekroczenia (ms). */
  t: number;
  /** Limit (min) i o ile przekroczono (min) — rośnie, dopóki przekroczenie trwa (open). */
  limitMin: number;
  overMin: number;
  open?: boolean;
  /** Pozycja w chwili zapisu (przy przekroczeniu w trakcie jazdy — tam, gdzie przekroczono). */
  lat?: number;
  lon?: number;
  /** Przekroczenie wypadło w luce (aplikacja zamknięta) — czas i miejsce szacunkowe. */
  est?: boolean;
  /** Początek dnia pracy, w którym przekroczono (duty: nowy dzień zamyka przekroczenie). */
  shift?: number;
  /** Miejsce z serwera; null = nie udało się ustalić. */
  where?: Where | null;
}

export const VIOLATION_INFO: Record<ViolationKind, { title: string; short: string; law: string }> = {
  continuous: { title: "Przekroczenie nieprzerwanego czasu jazdy", short: "Jazda bez przerwy", law: "art. 7 rozp. 561/2006" },
  daily: { title: "Przekroczenie dziennego czasu jazdy", short: "Dzienny czas jazdy", law: "art. 6 ust. 1 rozp. 561/2006" },
  duty: { title: "Odpoczynek dzienny rozpoczęty za późno", short: "Okres pracy (24 h)", law: "art. 8 ust. 2 rozp. 561/2006" },
  shortRest: { title: "Za krótki odpoczynek dzienny", short: "Odpoczynek dzienny", law: "art. 8 rozp. 561/2006" },
  week: { title: "Przekroczenie tygodniowego czasu jazdy", short: "Tygodniowy czas jazdy", law: "art. 6 ust. 2 rozp. 561/2006" },
  fortnight: { title: "Przekroczenie dwutygodniowego czasu jazdy", short: "Jazda w 2 tygodniach", law: "art. 6 ust. 3 rozp. 561/2006" },
};

/** Krok jazdy z GPS: `driveMin` minut zakończonych o `driveEnd`, odczyt o `t` w pozycji lat/lon. */
export interface DriveStep {
  t: number;
  driveMin: number;
  driveEnd: number;
  lat: number;
  lon: number;
  /** Jazda szacowana w luce (aplikacja była zamknięta). */
  est?: boolean;
}

export function allViolations(log: DayLog[]): Violation[] {
  return log.flatMap((d) => d.violations ?? []).sort((a, b) => a.t - b.t);
}

function findOpen(log: DayLog[], kind: ViolationKind): Violation | undefined {
  return allViolations(log).find((v) => v.open && v.kind === kind);
}

/** Zmienia przekroczenie `id` (w dniu, w którym jest zapisane). */
export function updateViolation(log: DayLog[], id: string, f: (v: Violation) => Violation): DayLog[] {
  return log.map((d) => (d.violations?.some((v) => v.id === id) ? { ...d, violations: d.violations.map((v) => (v.id === id ? f(v) : v)) } : d));
}

function addViolation(log: DayLog[], v: Omit<Violation, "id">): DayLog[] {
  const id = `${v.kind}:${Math.round(v.t)}`;
  return withDay(log, v.t, (d) => ({ ...d, violations: [...(d.violations ?? []).filter((x) => x.id !== id), { ...v, id }] }));
}

/** Limit dziennej jazdy: 10 h, póki są wydłużenia w tym tygodniu, inaczej 9 h. */
const dailyLimit = (d: DriverState) => (d.extensionsLeft > 0 ? RULES.dailyDriveExtended : RULES.dailyDrive);
/** Najpóźniej od początku dnia pracy trzeba zacząć odpoczynek: 15 h (gdy zostały skrócone 9 h), inaczej 13 h. */
const dutyLimit = (d: DriverState) => dutyWindow(d.reducedRestsLeft > 0 ? RULES.reducedDailyRest : RULES.regularDailyRest);

/**
 * Po doliczeniu jazdy: nowe i trwające przekroczenia liczników. `before` = liczniki przed tą jazdą (już po zaliczeniu
 * ewentualnego postoju). Przekroczenie trwa, dopóki licznik nie spadnie poniżej limitu (przerwa, odpoczynek, nowy tydzień) —
 * do tego czasu rośnie „o ile”.
 */
export function trackViolations(log: DayLog[], before: DriverState, step: DriveStep): DayLog[] {
  const d = step.driveMin;
  const start = step.driveEnd - d * MIN;
  const counters: { kind: ViolationKind; b: number; limit: number }[] = [
    // Licznik od przerwy jest ucięty na limicie (silnik planu), więc „równy limitowi” = już przekroczony.
    { kind: "continuous", b: before.sinceBreakMin, limit: RULES.maxContinuousDrive },
    { kind: "daily", b: before.drivenTodayMin, limit: dailyLimit(before) },
    { kind: "week", b: before.weekDrivenMin, limit: RULES.weeklyDrive },
    { kind: "fortnight", b: before.weekDrivenMin + before.prevWeekDrivenMin, limit: RULES.fortnightDrive },
  ];
  let out = log;
  for (const c of counters) {
    const open = findOpen(out, c.kind);
    const over = c.kind === "continuous" ? c.b >= c.limit : c.b > c.limit;
    if (open && !over) out = updateViolation(out, open.id, (v) => ({ ...v, open: false }));
    if (d <= 0 || c.b + d <= c.limit) continue;
    const inc = over ? d : c.b + d - c.limit;
    if (open && over) out = updateViolation(out, open.id, (v) => ({ ...v, overMin: v.overMin + inc }));
    else out = addViolation(out, { kind: c.kind, t: start + Math.max(0, c.limit - c.b) * MIN, limitMin: c.limit, overMin: inc, open: true, lat: step.lat, lon: step.lon, est: step.est || undefined, shift: before.shiftStart });
  }

  // Okres pracy: odpoczynek dzienny trzeba zacząć do 13 h / 15 h od początku dnia — jazda po tej chwili to przekroczenie.
  const dutyOpen = findOpen(out, "duty");
  if (dutyOpen && dutyOpen.shift !== before.shiftStart) out = updateViolation(out, dutyOpen.id, (v) => ({ ...v, open: false }));
  const deadline = before.shiftStart + dutyLimit(before) * MIN;
  if (d > 0 && step.driveEnd > deadline) {
    const overMin = (step.driveEnd - deadline) / MIN;
    const cur = findOpen(out, "duty");
    if (cur) out = updateViolation(out, cur.id, (v) => ({ ...v, overMin: Math.max(v.overMin, overMin) }));
    else out = addViolation(out, { kind: "duty", t: deadline, limitMin: dutyLimit(before), overMin, open: true, lat: step.lat, lon: step.lon, est: step.est || undefined, shift: before.shiftStart });
  }
  return out;
}

/**
 * Zakończony odpoczynek dzienny krótszy niż wymagany: < 9 h, kiedy kierowca i tak zaczyna nowy dzień („Rozpocznij dzień”), albo
 * 9–11 h, gdy w tym tygodniu nie zostało już skróconych odpoczynków. `forced` = nowy dzień zaczęty ręcznie (każdy postój to odpoczynek).
 */
export function restViolation(log: DayLog[], before: DriverState, start: number, end: number, pos: { lat: number; lon: number } | null, forced: boolean): DayLog[] {
  const min = (end - start) / MIN;
  const required = before.reducedRestsLeft > 0 ? RULES.reducedDailyRest : RULES.regularDailyRest;
  if (min >= required || (!forced && min < RULES.reducedDailyRest)) return log;
  return addViolation(log, { kind: "shortRest", t: end, limitMin: required, overMin: required - min, lat: pos?.lat, lon: pos?.lon, shift: before.shiftStart });
}

export function setWhere(log: DayLog[], id: string, where: Where | null): DayLog[] {
  return updateViolation(log, id, (v) => ({ ...v, where }));
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const localTime = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const utcTime = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
/** Jak na wydruku tachografu: „4h30”, „0h25”. */
const hmm = (min: number) => {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}h${pad(m % 60)}`;
};

const POI_NAME: Record<NonNullable<Where["poi"]>["kind"], string> = { mop: "MOP", services: "MOP", parking: "parking TIR", fuel: "stacja paliw" };

/** „Stryków, A2, przy MOP Niesułków” / „okolice: Nowostawy Dolne (2,1 km), DK 14”. */
export function whereText(w: Where | null | undefined): string | null {
  if (!w) return null;
  const p = w.poi;
  // Nazwa z OSM bywa samą marką („Orlen”) albo już z rodzajem („MOP Niesułków”, „Parking TIR …”).
  const poi = !p ? null : !p.name ? POI_NAME[p.kind] : p.kind === "fuel" ? `stacja ${p.name}` : new RegExp(`^${p.kind === "parking" ? "parking" : "mop"}`, "i").test(p.name) ? p.name : `${POI_NAME[p.kind]} ${p.name}`;
  const parts = [
    w.place ? (w.place.inside ? w.place.name : `okolice: ${w.place.name} (${String(w.place.km).replace(".", ",")} km)`) : null,
    w.road,
    poi ? `przy: ${poi}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Powody przekroczenia do notatki (art. 12 — dotarcie do odpowiedniego miejsca postoju). */
export const VIOLATION_REASONS = [
  { id: "parking", text: "brak wolnych miejsc parkingowych dla ciężarówek" },
  { id: "traffic", text: "korek / utrudnienia w ruchu" },
  { id: "accident", text: "wypadek lub zamknięta droga" },
  { id: "safe", text: "dojazd do bezpiecznego miejsca postoju" },
  { id: "base", text: "dojazd do bazy / miejsca odpoczynku tygodniowego" },
] as const;

/** Co pokazać przy przekroczeniu: opis, wiersze jak na wydruku i propozycja odręcznej notatki na wydruku z tachografu. */
export function violationReport(v: Violation, reason?: string): { title: string; summary: string; printout: string[]; note: string } {
  const info = VIOLATION_INFO[v.kind];
  const where = whereText(v.where);
  const pos = v.lat !== undefined && v.lon !== undefined ? `${v.lat.toFixed(4)} N, ${v.lon.toFixed(4)} E` : null;
  const summary =
    v.kind === "shortRest"
      ? `Odpoczynek ${fmtDuration(v.limitMin - v.overMin)} zamiast min. ${fmtDuration(v.limitMin)} — krótszy o ${fmtDuration(v.overMin)}.`
      : v.kind === "duty"
        ? `Odpoczynek dzienny należało zacząć do ${localTime(v.t)} (${fmtDuration(v.limitMin)} od początku dnia pracy) — jazda o ${fmtDuration(v.overMin)} dłużej.`
        : `Limit ${fmtDuration(v.limitMin)} przekroczony o ${fmtDuration(v.overMin)}${v.open ? " (trwa)" : ""}.`;
  const printout = [
    "------------------------------------",
    `${localDate(v.t)}  ${localTime(v.t)} (UTC ${utcTime(v.t)})`,
    `! ${info.title}`,
    `  limit ${hmm(v.limitMin)}   przekr. ${hmm(v.overMin)}`,
    `  ${info.law}`,
    ...(where ? [`Miejsce: ${where}`] : []),
    ...(pos ? [`Poz.: ${pos}${v.est ? " (szac.)" : ""}`] : []),
    `Powód: ${reason ?? "______________________"}`,
    "Podpis kierowcy: ______________",
    "------------------------------------",
  ];
  const over = fmtDuration(v.overMin);
  const what =
    v.kind === "shortRest" ? `skrócenie odpoczynku dziennego o ${over}` : v.kind === "duty" ? `rozpoczęcie odpoczynku dziennego o ${over} później` : `${info.title.charAt(0).toLowerCase()}${info.title.slice(1)} o ${over}`;
  // Jak formułki w PrintoutTips: art. 12, przyczyna, miejsce, dane kierowcy i podpis.
  const note =
    `Art. 12 rozp. (WE) 561/2006 — ${what} (${localDate(v.t)}, ${localTime(v.t)}, UTC ${utcTime(v.t)}) w celu dotarcia do odpowiedniego miejsca postoju. ` +
    `Przyczyna: ${reason ?? "[...]"}.${where ? ` Miejsce: ${where}.` : ""}\n[imię i nazwisko], nr karty kierowcy [...], ${localDate(v.t)}, podpis`;
  return { title: info.title, summary, printout, note };
}

/** Przekroczenia z dnia `date` (do listy w historii). */
export function dayViolations(log: DayLog[], date: string): Violation[] {
  return (log.find((d) => d.date === date)?.violations ?? []).slice().sort((a, b) => a.t - b.t);
}
