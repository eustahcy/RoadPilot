// Spóźniony start: odtworzenie stanu dnia z listy aktywności wpisanych przez kierowcę.

import { RULES } from "./rules";

export type ActivityKind = "drive" | "break" | "work";

export interface Activity {
  kind: ActivityKind;
  minutes: number;
}

export interface Reconstructed {
  drivenTodayMin: number;
  sinceBreakMin: number;
  splitBreakTaken: boolean;
  /** Koniec ostatniej aktywności (ms) — powinien zgadzać się z aktualną godziną. */
  end: number;
}

/**
 * Liczy jazdę od początku dnia i od ostatniej przerwy.
 * Przerwa ≥ 45 min zeruje licznik; 15 min + później 30 min (przerwa dzielona) też.
 * Inna praca nie jest przerwą.
 */
export function reconstruct(shiftStart: number, activities: Activity[]): Reconstructed {
  let driven = 0;
  let cont = 0;
  let split = false;
  let t = shiftStart;
  for (const a of activities) {
    const m = Math.max(0, a.minutes || 0);
    t += m * 60_000;
    if (a.kind === "drive") {
      driven += m;
      cont += m;
    } else if (a.kind === "break") {
      if (m >= RULES.fullBreak || (split && m >= RULES.splitBreakSecond)) {
        cont = 0;
        split = false;
      } else if (m >= RULES.splitBreakFirst && !split) {
        split = true;
      }
    }
  }
  return { drivenTodayMin: driven, sinceBreakMin: cont, splitBreakTaken: split, end: t };
}
