// Historia dzienna z GPS: początek i koniec jazdy, czas jazdy, postoje, km i średnia prędkość; luki (aplikacja zamknięta)
// z oszacowaną jazdą i przekroczenia (core/violations.ts).
// Dzień = data kalendarzowa w strefie lokalnej (jak nextWeekStart). Zapis jest pomocniczy — prawnym jest tachograf.

import type { GapEstimate } from "./gps";
import type { Violation } from "./violations";

const MIN = 60_000;

export const HISTORY = {
  /** Tyle dni trzymamy w pamięci urządzenia. */
  keepDays: 31,
  /** Krótsze postoje (światła, korek) nie trafiają do listy — ich czas i tak nie jest jazdą. */
  minStopMin: 2,
};

export interface DayLog {
  /** „2026-09-30” — data lokalna. */
  date: string;
  /** Początek pierwszej i koniec ostatniej jazdy tego dnia (ms) — null, gdy tego dnia nie było jazdy. */
  start: number | null;
  end: number | null;
  driveMin: number;
  km: number;
  /** est = postój oszacowany w luce (aplikacja była zamknięta). */
  stops: { start: number; end: number; est?: boolean }[];
  /** Luki w odczytach: aplikacja zamknięta — jazda i km oszacowane (z drogi na mapie albo linii prostej). */
  gaps?: GapEstimate[];
  violations?: Violation[];
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function withDay(log: DayLog[], t: number, f: (d: DayLog) => DayLog): DayLog[] {
  const date = dayKey(t);
  const i = log.findIndex((d) => d.date === date);
  const day = i >= 0 ? log[i] : { date, start: null, end: null, driveMin: 0, km: 0, stops: [] };
  const next = i >= 0 ? log.map((d, j) => (j === i ? f(day) : d)) : [...log, f(day)];
  return next.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, HISTORY.keepDays);
}

/** Dolicza jazdę zakończoną o `end` (minuty) i przejechane km. */
export function recordDrive(log: DayLog[], end: number, driveMin: number, km: number): DayLog[] {
  if (driveMin <= 0 && km <= 0) return log;
  const start = end - driveMin * MIN;
  return withDay(log, end, (d) => ({
    ...d,
    start: driveMin > 0 ? Math.min(d.start ?? start, start) : d.start,
    end: driveMin > 0 ? Math.max(d.end ?? end, end) : d.end,
    driveMin: d.driveMin + driveMin,
    km: d.km + km,
  }));
}

/** Zapisuje zakończony postój (w dniu, w którym się zaczął). `est` — postój oszacowany w luce. */
export function recordStop(log: DayLog[], start: number, end: number, est = false): DayLog[] {
  if ((end - start) / MIN < HISTORY.minStopMin) return log;
  return withDay(log, start, (d) => ({ ...d, stops: [...d.stops, est ? { start, end, est } : { start, end }].sort((a, b) => a.start - b.start) }));
}

/** Zapisuje lukę z oszacowaniem (w dniu, w którym się zaczęła). */
export function recordGap(log: DayLog[], gap: GapEstimate): DayLog[] {
  return withDay(log, gap.start, (d) => ({ ...d, gaps: [...(d.gaps ?? []), gap] }));
}

/** Podsumowanie dnia do widoku. */
export function daySummary(d: DayLog) {
  const stopMin = d.stops.reduce((a, s) => a + (s.end - s.start) / MIN, 0);
  return { stopMin, avgKmh: d.driveMin >= 1 ? (d.km / d.driveMin) * 60 : undefined };
}
