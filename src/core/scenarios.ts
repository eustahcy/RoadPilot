// Scenario Engine — porównanie wariantów „jedź teraz / odpocznij 9 h / odpocznij 11 h”.

import { DriverState, Plan, PlanOptions, simulate, nextWeekStart } from "./plan";
import { Route } from "./route";
import { RULES, dutyWindow } from "./rules";

const MIN = 60_000;

export type ScenarioId = "now" | "rest9" | "rest11";

export interface Scenario {
  id: ScenarioId;
  label: string;
  plan: Plan;
}

export interface Comparison {
  scenarios: Scenario[];
  /** Najwcześniejszy przyjazd spośród wykonalnych; przy remisie — ten z dłuższym odpoczynkiem. */
  bestId?: ScenarioId;
}

export function compareScenarios(route: Route, driver: DriverState, now: number, options: PlanOptions): Comparison {
  const scenarios: Scenario[] = [
    { id: "now", label: "Jedź teraz", plan: simulate(route, driver, now, options, { kind: "now" }) },
    { id: "rest9", label: "Odpocznij 9 h", plan: simulate(route, driver, now, options, { kind: "rest", minutes: RULES.reducedDailyRest }) },
    { id: "rest11", label: "Odpocznij 11 h", plan: simulate(route, driver, now, options, { kind: "rest", minutes: RULES.regularDailyRest }) },
  ];
  const restRank: Record<ScenarioId, number> = { now: 0, rest9: 1, rest11: 2 };
  const best = scenarios
    .filter((s) => s.plan.feasible)
    .sort((a, b) => {
      const d = a.plan.arrival - b.plan.arrival;
      return Math.abs(d) >= MIN ? d : restRank[b.id] - restRank[a.id];
    })[0];
  return { scenarios, bestId: best?.id };
}

export interface WhatIf {
  option: keyof PlanOptions;
  label: string;
  savedMin: number;
  arrival: number;
}

/** „Co jeśli?” — ile dałoby dopuszczenie wydłużenia jazdy lub skróconego odpoczynku. */
export function whatIfs(route: Route, driver: DriverState, now: number, options: PlanOptions): WhatIf[] {
  const base = bestArrival(compareScenarios(route, driver, now, options));
  if (base === undefined) return [];
  const out: WhatIf[] = [];
  const tryOption = (option: keyof PlanOptions, label: string, available: boolean) => {
    if (options[option] || !available) return;
    const alt = bestArrival(compareScenarios(route, driver, now, { ...options, [option]: true }));
    if (alt !== undefined && base - alt >= 5 * MIN) out.push({ option, label, savedMin: (base - alt) / MIN, arrival: alt });
  };
  tryOption("allowExtension", "wydłużenie jazdy do 10 h", driver.extensionsLeft > 0);
  tryOption("allowReducedRest", "skrócony odpoczynek 9 h po drodze", driver.reducedRestsLeft > 0);
  return out;
}

function bestArrival(c: Comparison) {
  return c.scenarios.find((s) => s.id === c.bestId)?.plan.arrival;
}

/** Czym jest scenariusz — krótkie powody wyniku, bez tabel. */
export function explain(s: Scenario): string[] {
  const p = s.plan;
  if (!p.feasible) return [p.problem ?? "Scenariusz niewykonalny."];
  const out: string[] = [];
  const breaks = p.events.filter((e) => e.kind === "break").length;
  const rests = p.events.filter((e) => e.kind === "rest").length - (s.id === "now" ? 0 : 1);
  const weekly = p.events.filter((e) => e.kind === "weeklyRest").length;
  if (s.id === "now" && p.events[0]?.kind === "rest") out.push("Nie możesz teraz jechać: " + lower(p.events[0].reason) + ".");
  if (s.id !== "now") out.push("Start po odpoczynku — nowy dzień pracy, liczniki jazdy od zera.");
  out.push(`Jazda ${fmtDuration(p.drivingMin)}` + (breaks ? `, ${breaks} × przerwa (${fmtDuration(p.breakMin)})` : ", bez przerw") + ".");
  if (rests > 0) out.push(`${rests === 1 ? "Odpoczynek dzienny" : `${rests} odpoczynki dzienne`} po drodze — trasa nie mieści się w jednym dniu pracy.`);
  if (weekly) out.push("Po drodze wypada odpoczynek tygodniowy.");
  if (p.extensionsUsed) out.push(`Używa wydłużenia jazdy do 10 h (${p.extensionsUsed}×).`);
  if (p.reducedRestsUsed) out.push(`Używa skróconego odpoczynku 9 h (${p.reducedRestsUsed}×).`);
  return out.concat(p.warnings);
}

/** Stan kierowcy „tu i teraz” — do dashboardu. */
export interface DriverStatus {
  driveLeftToday: number;
  driveLeftTodayExtended: number;
  untilBreak: number;
  breakNeeded: number;
  /** Do kiedy trzeba zacząć odpoczynek dzienny (regularny 11 h / skrócony 9 h). */
  restDeadline: number;
  restDeadlineReduced: number;
  weekLeft: number;
}

export function driverStatus(driver: DriverState, now: number): DriverStatus {
  const extendedToday = driver.drivenTodayMin > RULES.dailyDrive;
  const weekLeft = Math.min(RULES.weeklyDrive - driver.weekDrivenMin, RULES.fortnightDrive - driver.weekDrivenMin - driver.prevWeekDrivenMin);
  const cap = (n: number) => Math.max(0, Math.min(n, weekLeft));
  return {
    driveLeftToday: cap((extendedToday ? RULES.dailyDriveExtended : RULES.dailyDrive) - driver.drivenTodayMin),
    driveLeftTodayExtended: cap((extendedToday || driver.extensionsLeft > 0 ? RULES.dailyDriveExtended : RULES.dailyDrive) - driver.drivenTodayMin),
    untilBreak: Math.max(0, RULES.maxContinuousDrive - driver.sinceBreakMin),
    breakNeeded: driver.splitBreakTaken ? RULES.splitBreakSecond : RULES.fullBreak,
    restDeadline: driver.shiftStart + dutyWindow(RULES.regularDailyRest) * MIN,
    restDeadlineReduced: driver.shiftStart + dutyWindow(RULES.reducedDailyRest) * MIN,
    weekLeft: Math.max(0, weekLeft),
  };
}

export { nextWeekStart };

export function fmtDuration(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`;
}

function lower(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
