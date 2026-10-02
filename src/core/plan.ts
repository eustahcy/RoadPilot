// RoadPilot Core — deterministyczna symulacja dnia kierowcy.
// Brak zależności od Reacta, zegara systemowego i losowości: te same dane → ten sam plan.

import { Route } from "./route";
import { RULES, dutyWindow } from "./rules";

const MIN = 60_000;
const EPS = 0.01; // min

/** Stan kierowcy w chwili planowania — przepisany z tachografu. */
export interface DriverState {
  /** Koniec ostatniego odpoczynku dziennego/tygodniowego = początek dnia pracy (ms). */
  shiftStart: number;
  /** Jazda od początku dnia pracy (min). */
  drivenTodayMin: number;
  /** Jazda od ostatniej pełnej przerwy (min). */
  sinceBreakMin: number;
  /** Odbyta już pierwsza część przerwy dzielonej (15 min) — wystarczy 30 min. */
  splitBreakTaken: boolean;
  /** Pozostałe wydłużenia jazdy do 10 h w tym tygodniu (0–2). */
  extensionsLeft: number;
  /** Pozostałe skrócone odpoczynki 9 h do odpoczynku tygodniowego (0–3). */
  reducedRestsLeft: number;
  /** Jazda w bieżącym tygodniu (pn 00:00 – nd 24:00) i w poprzednim (min). */
  weekDrivenMin: number;
  prevWeekDrivenMin: number;
}

export interface PlanOptions {
  /** Czy silnik może użyć wydłużenia jazdy do 10 h. */
  allowExtension: boolean;
  /** Czy silnik może użyć skróconego odpoczynku 9 h po drodze. */
  allowReducedRest: boolean;
}

export type StartPolicy = { kind: "now" } | { kind: "rest"; minutes: number };

export type EventKind = "drive" | "break" | "rest" | "weeklyRest" | "arrive";

export interface PlanEvent {
  kind: EventKind;
  start: number;
  end: number;
  fromKm: number;
  toKm: number;
  /** Dlaczego to zdarzenie jest w planie. */
  reason: string;
}

export interface Plan {
  feasible: boolean;
  problem?: string;
  events: PlanEvent[];
  departure: number;
  arrival: number;
  drivingMin: number;
  breakMin: number;
  restMin: number;
  extensionsUsed: number;
  reducedRestsUsed: number;
  warnings: string[];
}

/** Poniedziałek 00:00 czasu lokalnego po chwili t. */
export function nextWeekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // pn = 0
  d.setDate(d.getDate() + (7 - dow));
  return d.getTime();
}

export function simulate(route: Route, driver: DriverState, now: number, options: PlanOptions, start: StartPolicy): Plan {
  const events: PlanEvent[] = [];
  const warnings: string[] = [];

  let t = now;
  let km = 0;
  let driven = driver.drivenTodayMin;
  let cont = driver.sinceBreakMin;
  let split = driver.splitBreakTaken;
  let ext = clampInt(driver.extensionsLeft, 0, RULES.maxExtensionsPerWeek);
  let red = clampInt(driver.reducedRestsLeft, 0, RULES.maxReducedRestsBetweenWeeklyRests);
  let week = driver.weekDrivenMin;
  let prev = driver.prevWeekDrivenMin;
  let shiftStart = driver.shiftStart;
  let weekBoundary = nextWeekStart(t);
  let extensionsUsed = 0;
  let reducedRestsUsed = 0;

  // Dzisiejszy limit jazdy. Jeśli kierowca już przekroczył 9 h, wydłużenie jest w użyciu
  // (i uwzględnione w liczniku, który podał) — silnik go nie odlicza drugi raz.
  let todayLimit: number = RULES.dailyDrive;
  let todayExtByEngine = false;
  if (driven > RULES.dailyDrive) {
    todayLimit = RULES.dailyDriveExtended;
  } else if (options.allowExtension && ext > 0) {
    todayLimit = RULES.dailyDriveExtended;
    todayExtByEngine = true;
  }

  const nextRestLength = () => (options.allowReducedRest && red > 0 ? RULES.reducedDailyRest : RULES.regularDailyRest);
  const windowEnd = () => shiftStart + dutyWindow(nextRestLength()) * MIN;

  const push = (kind: EventKind, minutes: number, reason: string, toKm = km) => {
    const last = events[events.length - 1];
    const end = t + minutes * MIN;
    if (kind === "drive" && last?.kind === "drive" && last.end === t) {
      last.end = end;
      last.toKm = toKm;
    } else {
      events.push({ kind, start: t, end, fromKm: km, toKm, reason });
    }
    t = end;
    km = toKm;
  };

  const newDay = () => {
    shiftStart = t;
    driven = 0;
    cont = 0;
    split = false;
    todayExtByEngine = options.allowExtension && ext > 0;
    todayLimit = todayExtByEngine ? RULES.dailyDriveExtended : RULES.dailyDrive;
  };

  const rollWeek = () => {
    while (t >= weekBoundary) {
      prev = week;
      week = 0;
      ext = RULES.maxExtensionsPerWeek;
      weekBoundary = nextWeekStart(weekBoundary);
    }
  };

  const dailyRest = (minutes: number, reason: string) => {
    if (minutes < RULES.regularDailyRest) {
      red--;
      reducedRestsUsed++;
    }
    if (todayExtByEngine && driven > RULES.dailyDrive + EPS) {
      ext--;
      extensionsUsed++;
    }
    push("rest", minutes, reason);
    newDay();
  };

  const planned = (overrides: Partial<Plan>): Plan => {
    const drives = events.filter((e) => e.kind === "drive");
    const sum = (k: EventKind[]) => events.filter((e) => k.includes(e.kind)).reduce((a, e) => a + (e.end - e.start) / MIN, 0);
    return {
      feasible: true,
      events,
      departure: drives[0]?.start ?? t,
      arrival: t,
      drivingMin: sum(["drive"]),
      breakMin: sum(["break"]),
      restMin: sum(["rest", "weeklyRest"]),
      extensionsUsed,
      reducedRestsUsed,
      warnings,
      ...overrides,
    };
  };

  if (route.totalKm <= 0) {
    return planned({ feasible: false, problem: "Podaj dystans do celu." });
  }
  if (now < driver.shiftStart) {
    return planned({ feasible: false, problem: "Początek dnia pracy jest w przyszłości — popraw dane z tachografu." });
  }
  if ((now - driver.shiftStart) / MIN > RULES.restCycle) {
    warnings.push("Od początku dnia pracy minęło ponad 24 h — sprawdź, czy wpisany koniec ostatniego odpoczynku jest aktualny.");
  }

  if (start.kind === "rest") {
    const reduced = start.minutes < RULES.regularDailyRest;
    if (reduced && red <= 0) {
      return planned({
        feasible: false,
        problem: "Wykorzystano już 3 skrócone odpoczynki dzienne — do odpoczynku tygodniowego zostaje tylko pełne 11 h.",
      });
    }
    dailyRest(start.minutes, reduced ? "Skrócony odpoczynek dzienny od razu (9 h)" : "Regularny odpoczynek dzienny od razu (11 h)");
  }

  for (let guard = 0; guard < 1000; guard++) {
    rollWeek();
    const remaining = route.driveMinutes(km);
    if (remaining <= EPS) break;

    const weekLeft = Math.min(RULES.weeklyDrive - week, RULES.fortnightDrive - week - prev);
    const dailyLeft = todayLimit - driven;
    const windowLeft = (windowEnd() - t) / MIN;
    const contLeft = RULES.maxContinuousDrive - cont;

    if (weekLeft <= EPS) {
      const byLimit = week >= RULES.weeklyDrive - EPS ? "56 h jazdy w tygodniu" : "90 h jazdy w dwóch tygodniach";
      const until = Math.max(t + RULES.weeklyRest * MIN, weekBoundary);
      push("weeklyRest", (until - t) / MIN, `Wyczerpany limit ${byLimit} — odpoczynek tygodniowy do nowego tygodnia`);
      red = RULES.maxReducedRestsBetweenWeeklyRests;
      rollWeek();
      newDay();
      warnings.push("Plan wymaga odpoczynku tygodniowego — sprawdź jego zasady (45 h / skrócony 24 h) z tachografem.");
      continue;
    }
    if (dailyLeft <= EPS) {
      dailyRest(nextRestLength(), `Wyczerpany dzienny czas jazdy (${todayLimit / 60} h)`);
      continue;
    }
    if (windowLeft <= EPS) {
      dailyRest(nextRestLength(), `Koniec okna dnia pracy (${dutyWindow(nextRestLength()) / 60} h od rozpoczęcia) — odpoczynek musi się zacząć teraz`);
      continue;
    }
    if (contLeft <= EPS) {
      const need = split ? RULES.splitBreakSecond : RULES.fullBreak;
      if (windowLeft <= need) {
        dailyRest(nextRestLength(), "Przerwa nie zmieściłaby się w oknie dnia pracy — od razu odpoczynek dzienny");
        continue;
      }
      push("break", need, split ? "4 h 30 min jazdy — druga część przerwy dzielonej (30 min)" : "4 h 30 min jazdy bez przerwy — obowiązkowa przerwa 45 min");
      cont = 0;
      split = false;
      continue;
    }

    const toBoundary = (weekBoundary - t) / MIN;
    const chunk = Math.min(remaining, dailyLeft, windowLeft, contLeft, weekLeft, toBoundary);
    const toKm = chunk >= remaining - EPS ? route.totalKm : route.advance(km, chunk);
    push("drive", chunk, "Jazda", toKm);
    driven += chunk;
    cont += chunk;
    week += chunk;
  }

  if (todayExtByEngine && driven > RULES.dailyDrive + EPS) extensionsUsed++;
  push("arrive", 0, "Przyjazd do celu");
  return planned({});
}

/** Pozycja na trasie (km) w chwili `at` według planu. */
export function positionAt(plan: Plan, route: Route, at: number): number {
  for (const e of plan.events) {
    if (at < e.start) return e.fromKm;
    if (at <= e.end) {
      if (e.kind !== "drive") return e.fromKm;
      return route.advance(e.fromKm, (at - e.start) / MIN);
    }
  }
  return route.totalKm;
}

/** Kiedy plan (z przerwami po drodze) dojeżdża do km `km` trasy — np. do punktu pośredniego. Poza planem: koniec planu. */
export function timeAtKm(plan: Plan, route: Route, km: number): number {
  for (const e of plan.events) {
    if (km <= e.fromKm) return e.start;
    if (e.kind === "drive" && km <= e.toKm) return e.start + route.driveMinutes(e.fromKm, km) * MIN;
  }
  return plan.arrival;
}

export interface ParkingHint {
  stop: PlanEvent;
  /** Od kiedy szukać parkingu. */
  searchFrom: number;
  searchFromKm: number;
}

/** Pierwszy postój w planie i moment, od którego warto zacząć szukać parkingu. */
export function parkingHint(plan: Plan, route: Route, bufferMin: number): ParkingHint | undefined {
  const firstDrive = plan.events.find((e) => e.kind === "drive");
  const stop = plan.events.find((e) => e.kind !== "drive" && e.kind !== "arrive" && firstDrive && e.start >= firstDrive.end);
  if (!stop || !firstDrive) return undefined;
  const searchFrom = Math.max(firstDrive.start, stop.start - bufferMin * MIN);
  return { stop, searchFrom, searchFromKm: positionAt(plan, route, searchFrom) };
}

function clampInt(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : 0)));
}
