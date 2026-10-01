// Odcinkowy pomiar prędkości: średnia od wjazdu na odcinek (jak liczy go system), ile zostało i jak jechać do końca.
// Czyste funkcje — czas i pozycja przychodzą parametrem (km po trasie z nawigacji, znacznik czasu odczytu GPS).

import { RoadSection, roadKindAt, SpeedLimit, speedLimitAt, speedTone, SpeedTone } from "./navmatch";
import { TRUCK_SPEED } from "./rules";

export const SECTION = {
  /** Od tylu km przed początkiem odcinka pokazujemy zapowiedź. */
  aheadKm: 3,
  /** Średnią pokazujemy po tylu km od wjazdu — wcześniej to szum jednego odczytu. */
  minKm: 0.05,
  /** Podsumowanie po wyjeździe z odcinka widać przez tyle ms. */
  summaryMs: 20_000,
  /** Szybciej niż tyle km/h między odczytami = skok pozycji (nowa trasa, błąd GPS), nie jazda. */
  maxKmh: 160,
} as const;

/** Odcinek z trasy (ostrzeżenie „section” z km początku i końca). */
export interface SectionSpan {
  id: string;
  km: number;
  toKm: number;
}

export interface SectionRun {
  id: string;
  lengthKm: number;
  /** Chwila wjazdu na odcinek (ms) — interpolowana między odczytami, jak bramka pomiaru. */
  startT: number;
  /** Przejechane km od wjazdu (suma przyrostów po trasie — odporna na przeliczenie trasy w trakcie). */
  distKm: number;
  /** Wyjazd z odcinka: czas i średnia. */
  endT?: number;
  avgKmh?: number;
  /** Wjazd nie był widziany (aplikacja włączona w trakcie odcinka) — średnia tylko z dalszej części. */
  partial?: boolean;
  /** Limit odcinka zapamiętany przy wjeździe (po przeliczeniu trasy odcinka może już nie być w ostrzeżeniach). */
  limit?: number;
}

export interface SectionState {
  last?: { km: number; t: number };
  run?: SectionRun;
}

/**
 * Kolejny odczyt pozycji na trasie. `span` — odcinek, na którym jesteśmy albo który właśnie mijamy (ten sam id co trwający
 * pomiar); undefined, gdy trasa już go nie zawiera (przeliczona w trakcie) — wtedy kończymy po przejechaniu jego długości.
 */
export function stepSection(s: SectionState, span: SectionSpan | undefined, km: number, t: number): SectionState {
  const last = s.last;
  const dt = last ? t - last.t : 0;
  // Przyrost po trasie od poprzedniego odczytu; ujemny albo nierealnie duży = nowa trasa / skok GPS → pomijamy.
  const d = last && dt > 0 && km >= last.km && ((km - last.km) / dt) * 3_600_000 <= SECTION.maxKmh ? km - last.km : 0;
  let run = s.run;

  if (run && run.endT === undefined) {
    const left = run.lengthKm - run.distKm;
    const passedEnd = span?.id === run.id ? km >= span.toKm : d >= left;
    if (passedEnd) {
      // Wyjazd: część przyrostu do końca odcinka i czas proporcjonalnie (bramka na końcu).
      const part = d > 0 ? Math.min(1, left / d) : 1;
      const endT = last ? last.t + dt * part : t;
      const h = (endT - run.startT) / 3_600_000;
      run = { ...run, distKm: run.lengthKm, endT, avgKmh: h > 0 ? run.lengthKm / h : undefined };
    } else {
      run = { ...run, distKm: run.distKm + d };
    }
  } else if (span && km >= span.km && km < span.toKm && run?.id !== span.id) {
    // Wjazd: czas przejazdu przez początek odcinka interpolowany między odczytami.
    // Bez odczytu sprzed początku nie znamy chwili wjazdu — mierzymy od tego miejsca do końca.
    const before = last && last.km < span.km && km > last.km && dt > 0 && d > 0;
    run = before
      ? { id: span.id, lengthKm: span.toKm - span.km, startT: last!.t + (dt * (span.km - last!.km)) / (km - last!.km), distKm: km - span.km }
      : { id: span.id, lengthKm: span.toKm - km, startT: t, distKm: 0, partial: true };
  }
  return { last: { km, t }, run };
}

export interface SectionStats {
  /** Średnia od wjazdu (km/h); undefined tuż po wjeździe. */
  avgKmh?: number;
  tone?: SpeedTone;
  leftKm: number;
  /** 0–1, ile odcinka za nami. */
  progress: number;
  /**
   * Średnia za wysoka: z jaką prędkością jechać do końca, żeby średnia z całego odcinka zeszła do limitu;
   * 0 = już się nie da.
   */
  adviseKmh?: number;
}

export function sectionStats(run: SectionRun, t: number, limit: number | undefined): SectionStats {
  const end = run.endT ?? t;
  const h = (end - run.startT) / 3_600_000;
  const avgKmh = run.avgKmh ?? (run.distKm >= SECTION.minKm && h > 0 ? run.distKm / h : undefined);
  const leftKm = Math.max(0, run.lengthKm - run.distKm);
  const tone = speedTone(avgKmh === undefined ? null : Math.round(avgKmh), limit);
  let adviseKmh: number | undefined;
  if (limit !== undefined && avgKmh !== undefined && avgKmh > limit && run.endT === undefined) {
    // Cały odcinek z limitem trwa co najmniej lengthKm / limit h — zostaje tyle czasu na resztę.
    const hLeft = run.lengthKm / limit - h;
    adviseKmh = hLeft > 0 && leftKm > 0 ? Math.floor(leftKm / hLeft) : 0;
  }
  return { avgKmh, tone, leftKm, progress: run.lengthKm > 0 ? Math.min(1, run.distKm / run.lengthKm) : 1, adviseKmh };
}

/**
 * Limit, z którym porównujemy średnią: znak odcinka (z OSM; bez niego — znak w połowie odcinka) i dla ciężarówki
 * najniższy limit z przepisów na całym odcinku (np. odcinek w mieście = 50, choć znak 70).
 */
export function sectionLimit(route: { speedLimits: SpeedLimit[]; roads?: RoadSection[] }, span: SectionSpan & { value: number | null }, truck: boolean): number | undefined {
  let lim = span.value ?? speedLimitAt(route.speedLimits, (span.km + span.toKm) / 2) ?? Infinity;
  if (truck) {
    for (let k = span.km; k <= span.toKm; k += 0.1) {
      const kind = roadKindAt(route.roads, k);
      if (kind) lim = Math.min(lim, TRUCK_SPEED[kind]);
    }
  }
  return Number.isFinite(lim) ? lim : undefined;
}
