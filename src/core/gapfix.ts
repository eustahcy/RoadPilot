// Luka w odczytach (aplikacja zamknięta) — kierowca mówi, co robił: jechał, stał (pauza) albo jedno i drugie.
// Tachograf przeliczamy od stanu sprzed luki: odpowiedź → to, co działo się po luce (postoje z historii, jazda między nimi).
// Czyste funkcje (czas parametrem); testy: gapfix.test.ts.

import type { GapEstimate } from "./gps";
import { creditDriving, creditStop } from "./gps";
import type { DayLog } from "./history";
import type { DriverState } from "./plan";

const MIN = 60_000;

/** Pytamy o luki dłuższe niż tyle minut i z przesunięciem od tylu km (bez przesunięcia to na pewno postój). */
export const GAP_ASK = { minMin: 15, minKm: 1 };

export type GapAnswer =
  | { kind: "drive" }
  | { kind: "stop" }
  | { kind: "both"; pauseMin: number; pauseAt: "start" | "end" };

/** Luka do wyjaśnienia: oszacowanie, stan tachografu tuż przed nią i suma jazdy w historii tuż po niej. */
export interface GapReview {
  gap: GapEstimate;
  before: DriverState;
  driveTotal: number;
  answer?: GapAnswer;
}

export const needsReview = (gap: GapEstimate) => (gap.end - gap.start) / MIN >= GAP_ASK.minMin && gap.km >= GAP_ASK.minKm;

export const totalDrive = (h: DayLog[]) => h.reduce((s, d) => s + d.driveMin, 0);

/** Jazda i postój w luce według odpowiedzi — kolejne odcinki [start, end]. */
export function gapSegments(gap: GapEstimate, a: GapAnswer): { kind: "drive" | "stop"; start: number; end: number }[] {
  const { start, end } = gap;
  if (a.kind === "drive") return [{ kind: "drive", start, end }];
  if (a.kind === "stop") return [{ kind: "stop", start, end }];
  const p = Math.min(end - start, Math.max(0, a.pauseMin) * MIN);
  return a.pauseAt === "start"
    ? [{ kind: "stop" as const, start, end: start + p }, { kind: "drive" as const, start: start + p, end }].filter((x) => x.end > x.start)
    : [{ kind: "drive" as const, start, end: end - p }, { kind: "stop" as const, start: end - p, end }].filter((x) => x.end > x.start);
}

/**
 * Przeliczenie po odpowiedzi: stan sprzed luki → jazda / postój z odpowiedzi → po luce: postoje z historii (nie szacowane)
 * i jazda z historii rozłożona na czas między nimi (do `activeStop` — trwający postój zaliczy się przy jego końcu).
 * Historia: jazda dnia luki poprawiona o różnicę, szacowane postoje z luki zastąpione postojem z odpowiedzi, luka z odpowiedzią.
 */
export function applyGapAnswer(r: GapReview, a: GapAnswer, history: DayLog[], now: number, activeStop: number | null): { driver: DriverState; history: DayLog[] } {
  const segs = gapSegments(r.gap, a);
  const driveMin = segs.filter((s) => s.kind === "drive").reduce((x, s) => x + (s.end - s.start) / MIN, 0);
  let driver = r.before;
  for (const s of segs) driver = s.kind === "drive" ? creditDriving(driver, (s.end - s.start) / MIN) : creditStop(driver, s.start, s.end);

  // Po luce: postoje z historii i jazda rozłożona na przerwy między nimi.
  const upTo = activeStop ?? now;
  const after = history.flatMap((d) => d.stops).filter((s) => !s.est && s.start >= r.gap.end && s.end <= upTo).sort((x, y) => x.start - y.start);
  const postDrive = Math.max(0, totalDrive(history) - r.driveTotal);
  const free: { start: number; end: number }[] = [];
  let t = r.gap.end;
  for (const s of after) {
    if (s.start > t) free.push({ start: t, end: s.start });
    t = Math.max(t, s.end);
  }
  if (upTo > t) free.push({ start: t, end: upTo });
  const freeMin = free.reduce((x, f) => x + (f.end - f.start) / MIN, 0);
  const events = [...free.map((f) => ({ kind: "drive" as const, ...f })), ...after.map((s) => ({ kind: "stop" as const, start: s.start, end: s.end }))].sort((x, y) => x.start - y.start);
  for (const e of events) {
    if (e.kind === "stop") driver = creditStop(driver, e.start, e.end);
    else if (freeMin > 0) driver = creditDriving(driver, Math.min((e.end - e.start) / MIN, (postDrive * (e.end - e.start)) / MIN / freeMin));
  }

  const nextHistory = history.map((d) => {
    const inGap = d.gaps?.some((g) => g.start === r.gap.start);
    if (!inGap) return d;
    const stops = d.stops.filter((s) => !(s.est && s.start >= r.gap.start - MIN && s.end <= r.gap.end + MIN));
    for (const s of segs) if (s.kind === "stop") stops.push({ start: s.start, end: s.end });
    return {
      ...d,
      driveMin: Math.max(0, d.driveMin + driveMin - r.gap.driveMin),
      stops: stops.sort((x, y) => x.start - y.start),
      gaps: d.gaps!.map((g) => (g.start === r.gap.start ? { ...g, driveMin, answered: true } : g)),
    };
  });
  return { driver, history: nextHistory };
}
