// Propozycja miejsca na przerwę: MOP / parking TIR na trasie, do którego dojedziemy z zapasem przed obowiązkową przerwą z planu.
// Czyste funkcje (czas i pozycja parametrem); testy: breakstop.test.ts.

/** Ustawienia: włączone i zapas (min) — dojazd tyle minut przed końcem dozwolonej jazdy. */
export interface BreakStopSettings {
  on: boolean;
  marginMin: number;
}

export const DEFAULT_BREAK_STOP: BreakStopSettings = { on: true, marginMin: 20 };
export const BREAK_STOP = {
  /** Zapas do wyboru w ustawieniach (min). */
  margins: [10, 15, 20, 30, 45],
  /** Miejsce bliżej niż tyle km przed nami nie ma sensu proponować (zaraz je miniemy). */
  minAheadKm: 3,
} as const;

export interface BreakStopPlace {
  /** km trasy nawigacji (od jej startu). */
  km: number;
  kind: string;
  truck?: boolean;
}

/**
 * Najdalsze miejsce na przerwę przed limitem: `driveLeftMin` — ile minut jazdy zostało do przerwy z planu,
 * `kmAfter(min)` — ile km przejedziemy w tyle minut (z prędkości trasy), `posKm` — nasz km na trasie nawigacji.
 * Bierzemy MOP-y (mop / services) i parkingi TIR. undefined = brak miejsca w zasięgu (albo przerwa już teraz).
 */
export function breakStopFor<T extends BreakStopPlace>(places: T[], posKm: number, driveLeftMin: number, marginMin: number, kmAfter: (min: number) => number): { place: T; spareMin: number } | undefined {
  const budget = driveLeftMin - marginMin;
  if (budget <= 0) return undefined;
  const reachKm = posKm + kmAfter(budget);
  const ok = places
    .filter((p) => (p.kind === "mop" || p.kind === "services" || (p.kind === "parking" && p.truck !== false)) && p.km >= posKm + BREAK_STOP.minAheadKm && p.km <= reachKm)
    .sort((a, b) => b.km - a.km);
  const place = ok[0];
  if (!place) return undefined;
  // Zapas faktyczny: ile minut jazdy zostanie po dojeździe do miejsca (km → minuty liniowo w obrębie budżetu).
  const usedMin = (budget * (place.km - posKm)) / Math.max(0.001, reachKm - posKm);
  return { place, spareMin: Math.round(driveLeftMin - usedMin) };
}
