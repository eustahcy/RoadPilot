// Czas pracy (okres dnia pracy): liczony od początku dnia (koniec ostatniego odpoczynku) i nie zatrzymuje się w przerwach.
// Domyślnie 13 h = 24 h − 11 h odpoczynku; wydłużenie do 15 h = 24 h − skrócony odpoczynek 9 h.

import { dutyWindow, RULES } from "./rules";

const MIN = 60_000;

export interface WorkSettings {
  /** Własny limit czasu pracy (min) — domyślnie 13 h. */
  limitMin: number;
  /** Czy przypominać o wydłużeniu do 15 h (skrócony odpoczynek 9 h). */
  extension: boolean;
  /** Przypomnienia przed końcem czasu pracy. */
  remind: boolean;
  /** Ile minut przed końcem przypominać. */
  leadMin: number;
}

export const DEFAULT_WORK: WorkSettings = { limitMin: dutyWindow(RULES.regularDailyRest), extension: true, remind: true, leadMin: 30 };

/** Najdłuższy okres dnia pracy — przy skróconym odpoczynku 9 h. */
export const EXTENDED_WORK_MIN = dutyWindow(RULES.reducedDailyRest);

export interface WorkStatus {
  elapsedMin: number;
  end: number;
  leftMin: number;
  /** Koniec wydłużonego czasu pracy — gdy wydłużenie jest włączone i są jeszcze skrócone odpoczynki. */
  extendedEnd?: number;
  phase: "ok" | "soon" | "over" | "extended" | "extendedOver";
}

export function canExtend(w: WorkSettings, reducedRestsLeft: number) {
  return w.extension && reducedRestsLeft > 0 && w.limitMin < EXTENDED_WORK_MIN;
}

export function workStatus(shiftStart: number, now: number, w: WorkSettings, reducedRestsLeft: number): WorkStatus {
  const elapsedMin = Math.max(0, (now - shiftStart) / MIN);
  const end = shiftStart + w.limitMin * MIN;
  const extendedEnd = canExtend(w, reducedRestsLeft) ? shiftStart + EXTENDED_WORK_MIN * MIN : undefined;
  const leftMin = w.limitMin - elapsedMin;
  let phase: WorkStatus["phase"] = leftMin > w.leadMin ? "ok" : leftMin > 0 ? "soon" : "over";
  if (phase === "over" && extendedEnd !== undefined) phase = now < extendedEnd ? "extended" : "extendedOver";
  return { elapsedMin, end, leftMin, extendedEnd, phase };
}

export type WorkReminderKind = "soon" | "end" | "extSoon" | "extEnd";

/** Chwile przypomnień: X min przed końcem i na koniec — dla limitu i (gdy włączone) wydłużenia do 15 h. */
export function workReminders(shiftStart: number, w: WorkSettings, reducedRestsLeft: number): { at: number; kind: WorkReminderKind }[] {
  if (!w.remind) return [];
  const end = shiftStart + w.limitMin * MIN;
  const out: { at: number; kind: WorkReminderKind }[] = [
    { at: end - w.leadMin * MIN, kind: "soon" },
    { at: end, kind: "end" },
  ];
  if (canExtend(w, reducedRestsLeft)) {
    const ext = shiftStart + EXTENDED_WORK_MIN * MIN;
    out.push({ at: ext - w.leadMin * MIN, kind: "extSoon" }, { at: ext, kind: "extEnd" });
  }
  return out.filter((r) => r.at >= shiftStart);
}
