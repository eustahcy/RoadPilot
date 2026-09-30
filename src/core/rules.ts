// Limity czasu jazdy i odpoczynku wg rozporządzenia (WE) nr 561/2006.
// Wszystkie wartości w minutach. Jedyne miejsce, w którym są zapisane.

export const RULES = {
  /** Maks. jazda bez przerwy (art. 7). */
  maxContinuousDrive: 270,
  /** Pełna przerwa po 4,5 h jazdy. */
  fullBreak: 45,
  /** Przerwa dzielona: najpierw min. 15 min, potem min. 30 min. */
  splitBreakFirst: 15,
  splitBreakSecond: 30,
  /** Dzienny czas jazdy (art. 6 ust. 1). */
  dailyDrive: 540,
  /** Wydłużony dzienny czas jazdy — maks. 2 razy w tygodniu. */
  dailyDriveExtended: 600,
  maxExtensionsPerWeek: 2,
  /** Regularny i skrócony odpoczynek dzienny (art. 8). */
  regularDailyRest: 660,
  reducedDailyRest: 540,
  maxReducedRestsBetweenWeeklyRests: 3,
  /** Odpoczynek dzienny musi się zakończyć w ciągu 24 h od końca poprzedniego. */
  restCycle: 1440,
  /** Tygodniowy i dwutygodniowy limit jazdy. */
  weeklyDrive: 3360,
  fortnightDrive: 5400,
  /** Regularny odpoczynek tygodniowy. */
  weeklyRest: 2700,
} as const;

/** Najpóźniejszy moment (od początku dnia pracy), w którym trzeba zacząć odpoczynek o danej długości. */
export function dutyWindow(restMinutes: number): number {
  return RULES.restCycle - restMinutes;
}
