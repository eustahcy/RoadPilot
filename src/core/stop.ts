// Postój oznaczony ręcznie przez kierowcę („zaczynam przerwę”): co da się zaliczyć i jak liczyć plan w trakcie.
// Zaliczamy faktyczny czas postoju (od startu do końca) — cel służy tylko do odliczania i planu.

import { creditStop } from "./gps";
import { DriverState } from "./plan";
import { RULES } from "./rules";

const MIN = 60_000;

export interface ActiveStop {
  /** Początek postoju (ms). */
  start: number;
  /** Planowana długość (min) — do odliczania; zaliczany jest czas faktyczny. */
  targetMin: number;
}

export type StopCredit = "none" | "splitFirst" | "break" | "reducedRest" | "dailyRest";

/** Gotowe długości postoju do wyboru. */
export const STOP_PRESETS = [RULES.splitBreakFirst, RULES.splitBreakSecond, RULES.fullBreak, RULES.reducedDailyRest, RULES.regularDailyRest];

/** Proponowana długość: tyle, ile potrzeba do zaliczenia przerwy (30 min po 15-minutowej części, inaczej 45). */
export function suggestedStop(driver: DriverState): number {
  return driver.splitBreakTaken ? RULES.splitBreakSecond : RULES.fullBreak;
}

/** Jak zostanie zaliczony postój o tej długości — ta sama logika co creditStop. */
export function stopCredit(driver: DriverState, minutes: number): StopCredit {
  if (minutes >= RULES.regularDailyRest) return "dailyRest";
  if (minutes >= RULES.reducedDailyRest) return "reducedRest";
  if (minutes >= (driver.splitBreakTaken ? RULES.splitBreakSecond : RULES.fullBreak)) return "break";
  if (minutes >= RULES.splitBreakFirst && !driver.splitBreakTaken) return "splitFirst";
  return "none";
}

/** Kolejny próg (min), który postój może jeszcze osiągnąć — undefined po pełnym odpoczynku dziennym. */
export function nextStopThreshold(driver: DriverState, minutes: number): { at: number; credit: StopCredit } | undefined {
  const steps: number[] = [
    ...(driver.splitBreakTaken ? [RULES.splitBreakSecond] : [RULES.splitBreakFirst, RULES.fullBreak]),
    RULES.reducedDailyRest,
    RULES.regularDailyRest,
  ];
  const at = steps.find((m) => m > minutes);
  return at === undefined ? undefined : { at, credit: stopCredit(driver, at) };
}

/** Kończy postój o `end`: zalicza faktyczny czas. Koniec przed startem = nic nie zaliczamy. */
export function endStop(driver: DriverState, stop: ActiveStop, end: number): DriverState {
  return end > stop.start ? creditStop(driver, stop.start, end) : driver;
}

/**
 * Plan w trakcie postoju: zakładamy, że kierowca postoi do planowanej długości (albo do teraz, jeśli już dłużej),
 * i liczymy od tej chwili ze stanem po zaliczeniu postoju.
 */
export function planAfterStop(driver: DriverState, stop: ActiveStop, now: number): { driver: DriverState; from: number } {
  const from = Math.max(now, stop.start + stop.targetMin * MIN);
  return { driver: endStop(driver, stop, from), from };
}
