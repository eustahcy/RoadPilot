// Plan pod godzinę rozładunku (awizację): czy zdążę, co wybrać, do kiedy mogę odpoczywać.

import { DriverState, Plan, PlanOptions, simulate } from "./plan";
import { Route } from "./route";
import { RULES } from "./rules";
import { compareScenarios, Scenario } from "./scenarios";

const MIN = 60_000;

export interface DeadlineFix {
  options: PlanOptions;
  label: string;
  arrival: number;
}

export interface DeadlinePlan {
  /** Godzina rozładunku i moment, na który celujemy (rozładunek minus zapas). */
  deadline: number;
  target: number;
  onTime: boolean;
  /** Wybrany plan: przy zdążeniu — z najdłuższym odpoczynkiem / najpóźniejszym wyjazdem. */
  plan?: Plan;
  kind?: "rest" | "now";
  /** Długość odpoczynku przed wyjazdem (min), gdy kind === "rest". */
  restMinutes?: number;
  /** Zapas względem godziny rozładunku (min). */
  slackMin?: number;
  /** Najwcześniejszy możliwy przyjazd (bez względu na awizację). */
  earliest?: number;
  lateByMin?: number;
  /** Co pozwoliłoby zdążyć, gdy się nie da. */
  fixes: DeadlineFix[];
}

/**
 * Dobiera plan pod awizację. Kolejność preferencji, gdy da się zdążyć:
 *  1. odpoczynek od razu — jak najdłuższy (≥ 11 h, a jeśli się nie da — skrócony ≥ 9 h), potem jazda,
 *  2. jazda od razu — z najpóźniejszą godziną wyjazdu, przy której wciąż się zdąży.
 * Kierowca dostaje maksimum odpoczynku, a nie jak najwcześniejszy przyjazd pod bramę.
 */
export function planForDeadline(
  route: Route,
  driver: DriverState,
  now: number,
  options: PlanOptions,
  deadline: number,
  bufferMin: number,
): DeadlinePlan {
  const target = deadline - Math.max(0, bufferMin) * MIN;
  const base: DeadlinePlan = { deadline, target, onTime: false, fixes: [] };
  if (route.totalKm <= 0) return base;

  const found = choose(route, driver, now, options, target);
  if (found) {
    return { ...base, onTime: true, ...found, slackMin: (deadline - found.plan.arrival) / MIN, earliest: earliestArrival(route, driver, now, options) };
  }

  const earliest = earliestArrival(route, driver, now, options);
  const fixes: DeadlineFix[] = [];
  const variants: [Partial<PlanOptions>, string, boolean][] = [
    [{ allowExtension: true }, "wydłużenie jazdy do 10 h", driver.extensionsLeft > 0],
    [{ allowReducedRest: true }, "skrócony odpoczynek 9 h po drodze", driver.reducedRestsLeft > 0],
    [{ allowExtension: true, allowReducedRest: true }, "wydłużenie jazdy i skrócony odpoczynek", driver.extensionsLeft > 0 && driver.reducedRestsLeft > 0],
  ];
  for (const [patch, label, available] of variants) {
    const opts = { ...options, ...patch };
    if (!available || (opts.allowExtension === options.allowExtension && opts.allowReducedRest === options.allowReducedRest)) continue;
    const alt = earliestArrival(route, driver, now, opts);
    if (alt !== undefined && alt <= target) {
      fixes.push({ options: opts, label, arrival: alt });
      break; // najprostsza zmiana, która wystarcza
    }
  }
  return {
    ...base,
    earliest,
    lateByMin: earliest !== undefined ? Math.max(0, (earliest - deadline) / MIN) : undefined,
    fixes,
  };
}

function choose(route: Route, driver: DriverState, now: number, options: PlanOptions, target: number) {
  const arrivalAfterRest = (m: number) => {
    const p = simulate(route, driver, now, options, { kind: "rest", minutes: m });
    return p.feasible ? p : undefined;
  };

  // 1. Odpoczynek od razu: szukamy najdłuższego, przy którym zdążymy.
  const minRest = driver.reducedRestsLeft > 0 ? RULES.reducedDailyRest : RULES.regularDailyRest;
  const maxRest = Math.floor((target - now) / MIN);
  const first = arrivalAfterRest(minRest);
  if (first && first.arrival <= target && maxRest >= minRest) {
    const m = maxWhere(minRest, maxRest, (x) => (arrivalAfterRest(x)?.arrival ?? Infinity) <= target);
    return { plan: arrivalAfterRest(m)!, kind: "rest" as const, restMinutes: m };
  }

  // 2. Jazda od razu: najpóźniejszy wyjazd (czekanie liczy się do okna dnia pracy, nie jako odpoczynek).
  const driveAt = (delay: number) => {
    const p = simulate(route, driver, now + delay * MIN, options, { kind: "now" });
    return p.feasible ? p : undefined;
  };
  const start = driveAt(0);
  if (start && start.arrival <= target) {
    const d = maxWhere(0, Math.floor((target - now) / MIN), (x) => (driveAt(x)?.arrival ?? Infinity) <= target);
    return { plan: driveAt(d)!, kind: "now" as const };
  }
  return undefined;
}

/** Największe x z [lo, hi], dla którego ok(x) — przy założeniu, że ok jest monotoniczne i ok(lo). */
function maxWhere(lo: number, hi: number, ok: (x: number) => boolean) {
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function earliestArrival(route: Route, driver: DriverState, now: number, options: PlanOptions) {
  const c = compareScenarios(route, driver, now, options);
  return c.scenarios.find((s: Scenario) => s.id === c.bestId)?.plan.arrival;
}
