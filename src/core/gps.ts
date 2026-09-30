// GPS — licznik przejechanych km, czas jazdy/postoju i średnia prędkość z ostatnich minut.
// Czyste funkcje bez API przeglądarki: kolejne odczyty (fix) → te same wyniki.
// GPS pomaga aktualizować plan, ale nie jest prawnym zapisem aktywności — tym jest tachograf.

import { DriverState } from "./plan";
import { RULES } from "./rules";
import { RoadType, ROAD_TYPES, Speeds } from "./route";

const MIN = 60_000;

/** Jeden odczyt pozycji. */
export interface Fix {
  t: number;
  lat: number;
  lon: number;
  /** Dokładność (m). */
  accuracy: number;
  /** Prędkość z odbiornika (m/s), jeśli ją podaje. */
  speed: number | null;
}

export interface GpsTrack {
  /** Ostatnia pozycja, od której liczymy przesunięcie (zmienia się dopiero po realnym ruchu). */
  anchor: { lat: number; lon: number; accuracy: number };
  /** Czas ostatniego przetworzonego odczytu. */
  lastT: number;
  /** Licznik km od początku śledzenia. */
  odoKm: number;
  /** Próbki licznika (co najmniej co SAMPLE_EVERY) z ostatnich minut — do średniej prędkości. */
  samples: { t: number; km: number }[];
  /** Początek bieżącego postoju — null, gdy jedziemy. */
  stopSince: number | null;
}

export const GPS = {
  /** Odczyty mniej dokładne niż tyle metrów są pomijane. */
  maxAccuracyM: 60,
  /** Minimalne przesunięcie, żeby uznać ruch (m) — tłumi „pływanie” pozycji na postoju. */
  minMoveM: 25,
  /** Od tej prędkości (km/h) uznajemy, że samochód jedzie. */
  movingKmh: 5,
  /** Odczyty szybsze niż tyle km/h to skok pozycji, nie jazda. */
  maxKmh: 150,
  /** Przerwa w odczytach (aplikacja zamknięta / ekran wyłączony), od której odcinek jest „luką”. */
  gapMin: 2,
  /** Luka: droga ≈ linia prosta × ten współczynnik. */
  gapRoadFactor: 1.2,
  /** Luka: czas jazdy szacowany z tej średniej (km/h) — resztę luki traktujemy jako postój. */
  gapAvgKmh: 70,
  /** Okno średniej prędkości (min) i minimalna długość danych w oknie, żeby jej użyć. */
  windowMin: 10,
  minWindowMin: 5,
  /** Poniżej tej średniej (km/h) nie liczymy przyjazdu z prędkości — to postój lub korek. */
  minLiveKmh: 10,
  sampleEveryMs: 15_000,
} as const;

export function startTrack(fix: Fix): GpsTrack {
  return {
    anchor: { lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy },
    lastT: fix.t,
    odoKm: 0,
    samples: [{ t: fix.t, km: 0 }],
    stopSince: null,
  };
}

export interface FixResult {
  track: GpsTrack;
  /** Km przejechane od poprzedniego odczytu. */
  km: number;
  /** Minuty jazdy od poprzedniego odczytu. */
  driveMin: number;
  /** Postój, który właśnie się skończył (ruszyliśmy) — do zaliczenia przerwy/odpoczynku. */
  stopEnded?: { start: number; end: number };
}

/** Przetwarza kolejny odczyt. Odczyty niedokładne lub starsze niż poprzedni nic nie zmieniają. */
export function addFix(track: GpsTrack, fix: Fix): FixResult {
  const dt = (fix.t - track.lastT) / MIN;
  if (dt <= 0 || fix.accuracy > GPS.maxAccuracyM) return { track, km: 0, driveMin: 0 };

  const straight = distanceM(track.anchor, fix);
  const moved = straight >= Math.max(GPS.minMoveM, fix.accuracy, track.anchor.accuracy);
  const gap = dt >= GPS.gapMin;
  let km = moved ? (straight / 1000) * (gap ? GPS.gapRoadFactor : 1) : 0;
  if (km / (dt / 60) > GPS.maxKmh) km = 0; // skok pozycji

  let driveMin: number;
  if (gap) {
    // Nie wiemy, co działo się między odczytami: jazdę szacujemy z dystansu, resztę uznajemy za postój.
    driveMin = Math.min(dt, (km / GPS.gapAvgKmh) * 60);
  } else {
    const kmh = Math.max(km / (dt / 60), (fix.speed ?? 0) * 3.6);
    driveMin = kmh >= GPS.movingKmh ? dt : 0;
  }

  let stopSince = track.stopSince;
  let stopEnded: FixResult["stopEnded"];
  if (driveMin > 0) {
    // Postój kończy się tam, gdzie zaczyna się jazda (przy luce — na jej końcu minus czas jazdy).
    const driveStart = fix.t - driveMin * MIN;
    if (stopSince !== null && driveStart > stopSince) stopEnded = { start: stopSince, end: driveStart };
    stopSince = null;
    // Luka to ruch „bez szczegółów” — nie zaliczamy w niej przerwy, ale postój po niej liczymy od nowa.
    if (gap && driveMin < dt) stopEnded = undefined;
  } else if (stopSince === null) {
    stopSince = track.lastT;
  }

  const odoKm = track.odoKm + km;
  const last = track.samples[track.samples.length - 1];
  const samples = fix.t - last.t >= GPS.sampleEveryMs ? [...track.samples, { t: fix.t, km: odoKm }] : track.samples;
  // Zostawiamy jedną próbkę sprzed okna — średnia obejmuje wtedy pełne okno.
  const from = fix.t - GPS.windowMin * MIN;
  const firstIn = samples.findIndex((s) => s.t >= from);
  const kept = firstIn > 1 ? samples.slice(firstIn - 1) : samples;

  return {
    track: {
      anchor: moved ? { lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy } : track.anchor,
      lastT: fix.t,
      odoKm,
      samples: kept,
      stopSince,
    },
    km,
    driveMin,
    stopEnded,
  };
}

/**
 * Średnia prędkość (km/h) z ostatnich `GPS.windowMin` minut do chwili `now`.
 * undefined, gdy danych jest za mało (krócej niż `GPS.minWindowMin` lub dawno brak odczytów).
 */
export function recentSpeed(track: GpsTrack | null, now: number): number | undefined {
  if (!track || now - track.lastT > GPS.gapMin * MIN) return undefined;
  const from = now - GPS.windowMin * MIN;
  const end = { t: track.lastT, km: track.odoKm };
  const start = track.samples.find((s) => s.t >= from) ?? end;
  const span = (end.t - start.t) / MIN;
  if (span < GPS.minWindowMin) return undefined;
  return ((end.km - start.km) / span) * 60;
}

/** Ta sama prędkość dla każdego typu drogi — przyjazd liczony z aktualnej średniej. */
export function uniformSpeeds(kmh: number): Speeds {
  return Object.fromEntries(ROAD_TYPES.map((t) => [t, kmh])) as Record<RoadType, number>;
}

/** Dolicza jazdę do liczników kierowcy. */
export function creditDriving(driver: DriverState, minutes: number): DriverState {
  if (minutes <= 0) return driver;
  return {
    ...driver,
    drivenTodayMin: driver.drivenTodayMin + minutes,
    sinceBreakMin: Math.min(driver.sinceBreakMin + minutes, RULES.maxContinuousDrive),
    weekDrivenMin: driver.weekDrivenMin + minutes,
  };
}

/** Zalicza zakończony postój: przerwę (45 min / 15 + 30 min) lub odpoczynek dzienny (≥ 9 h). */
export function creditStop(driver: DriverState, start: number, end: number): DriverState {
  const min = (end - start) / MIN;
  if (min >= RULES.reducedDailyRest) {
    return {
      ...driver,
      shiftStart: end,
      drivenTodayMin: 0,
      sinceBreakMin: 0,
      splitBreakTaken: false,
      reducedRestsLeft: min < RULES.regularDailyRest ? Math.max(0, driver.reducedRestsLeft - 1) : driver.reducedRestsLeft,
    };
  }
  if (min >= (driver.splitBreakTaken ? RULES.splitBreakSecond : RULES.fullBreak)) {
    return { ...driver, sinceBreakMin: 0, splitBreakTaken: false };
  }
  if (min >= RULES.splitBreakFirst && !driver.splitBreakTaken) {
    return { ...driver, splitBreakTaken: true };
  }
  return driver;
}

/** Odległość po powierzchni Ziemi (m). */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kierunek z punktu a do b (stopnie, 0 = północ, zgodnie z ruchem wskazówek zegara). */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Bieżąca pozycja, prędkość i kierunek — do trybu HUD (nie zapisywane). */
export interface Live {
  t: number;
  lat: number;
  lon: number;
  /** km/h — null, gdy jeszcze nie wiadomo. */
  kmh: number | null;
  /** Stopnie od północy — null, gdy nie wiadomo (np. stoimy od początku). */
  heading: number | null;
  /** Punkt, od którego liczymy prędkość i kierunek, gdy odbiornik ich nie podaje. */
  base: { t: number; lat: number; lon: number };
}

/** Tyle danych (ms) potrzeba, żeby liczyć prędkość z przesunięcia — przy odczytach co 1 s szum byłby za duży. */
const DERIVE_MS = 4_000;

/**
 * Prędkość i kierunek z kolejnego odczytu. Najpierw to, co podaje odbiornik;
 * gdy nie podaje — z przesunięcia od punktu sprzed co najmniej kilku sekund.
 */
export function nextLive(prev: Live | null, fix: Fix, receiverHeading: number | null): Live {
  const here = { t: fix.t, lat: fix.lat, lon: fix.lon };
  let kmh = fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed * 3.6 : null;
  let heading = receiverHeading !== null && Number.isFinite(receiverHeading) && (kmh ?? 0) >= GPS.movingKmh ? receiverHeading : null;
  if (!prev) return { ...here, kmh, heading, base: here };

  let base = prev.base;
  if (fix.t - base.t >= DERIVE_MS) {
    const d = distanceM(base, fix);
    const moved = d >= Math.max(GPS.minMoveM, fix.accuracy);
    if (kmh === null && fix.accuracy <= GPS.maxAccuracyM) kmh = moved ? Math.min(d / 1000 / ((fix.t - base.t) / 3_600_000), GPS.maxKmh) : 0;
    if (heading === null && moved) heading = bearingDeg(base, fix);
    base = here;
  } else if (kmh === null) {
    kmh = prev.kmh;
  }
  return { ...here, kmh, heading: heading ?? prev.heading, base };
}
