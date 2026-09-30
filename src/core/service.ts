// Serwis pojazdu: termin (data) i kilometry do przeglądu, odliczane licznikiem GPS.

const DAY = 86_400_000;

export interface ServiceInfo {
  /** Dzień serwisu (ms, północ czasu lokalnego) — null, gdy nie ustawiono. */
  date: number | null;
  /** Kilometry do serwisu wpisane przez kierowcę — null, gdy nie ustawiono. */
  km: number | null;
  /** Stan licznika GPS (AppState.odoKm) w chwili wpisania km. */
  odoAtSet: number;
}

export type ServiceLevel = "none" | "ok" | "soon" | "overdue";

export interface ServiceStatus {
  kmLeft?: number;
  daysLeft?: number;
  level: ServiceLevel;
}

export const SERVICE = {
  /** Od tylu km / dni przed serwisem pokazujemy ostrzeżenie. */
  soonKm: 1000,
  soonDays: 14,
} as const;

export function serviceStatus(s: ServiceInfo, odoKm: number, now: number): ServiceStatus {
  const kmLeft = s.km === null ? undefined : s.km - Math.max(0, odoKm - s.odoAtSet);
  const daysLeft = s.date === null ? undefined : Math.round((s.date - startOfDay(now)) / DAY);
  if (kmLeft === undefined && daysLeft === undefined) return { level: "none" };
  const level: ServiceLevel =
    (kmLeft !== undefined && kmLeft <= 0) || (daysLeft !== undefined && daysLeft < 0)
      ? "overdue"
      : (kmLeft !== undefined && kmLeft <= SERVICE.soonKm) || (daysLeft !== undefined && daysLeft <= SERVICE.soonDays)
        ? "soon"
        : "ok";
  return { kmLeft, daysLeft, level };
}

/** Północ czasu lokalnego dnia, w którym jest t. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
