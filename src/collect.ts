// Mapa RoadPilot: za zgodą kierowcy zbieramy ślad przejazdu (tylko Polska) i zgłoszenia z drogi — podkładka pod
// własną nawigację dla ciężarówek (drogi, wiadukty, tonaż, ograniczenia). Ślad czeka w telefonie i idzie paczkami.

import { useEffect, useRef } from "react";
import { api } from "./api";
import { Live } from "./core/gps";

const KEY = "roadpilot:trace";
/** Polska z małym zapasem — ta sama granica co na serwerze (server/collect.mjs). */
const POLAND = { minLat: 48.95, maxLat: 54.95, minLon: 14.05, maxLon: 24.2 };

export const TRACE = {
  /** Punkt co tyle ms albo metrów (co nastąpi później) — wystarczy do odtworzenia drogi, mało danych. */
  everyMs: 5_000,
  everyM: 60,
  /** Poniżej tej prędkości nie zbieramy (postój — nic nie mówi o drodze). */
  minKmh: 8,
  /** Wysyłka: co tyle ms albo po tylu punktach; bufor w telefonie maks. tyle punktów. */
  uploadMs: 5 * 60_000,
  uploadPoints: 400,
  maxBuffer: 20_000,
} as const;

type Point = [number, number, number, number | null, number | null];

function read(): Point[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Point[];
  } catch {
    return [];
  }
}

function write(points: Point[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(points.slice(-TRACE.maxBuffer)));
  } catch {
    /* brak miejsca — gubimy najstarsze punkty */
  }
}

export function clearTrace() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nic */
  }
}

const inPoland = (lat: number, lon: number) => lat >= POLAND.minLat && lat <= POLAND.maxLat && lon >= POLAND.minLon && lon <= POLAND.maxLon;

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * 111_320);
}

/** Zbiera punkty śladu z odczytów GPS i wysyła je paczkami — tylko gdy `token` i zgoda. */
export function useTraceCollector(token: string | null, enabled: boolean, live: Live | null) {
  const last = useRef<Point | null>(null);
  const sending = useRef(false);

  const upload = async (keepalive = false) => {
    if (!token || sending.current) return;
    const points = read();
    if (!points.length) return;
    const batch = points.slice(0, 1000);
    sending.current = true;
    try {
      await api("POST", "/collect/points", { points: batch }, token, keepalive);
      write(read().slice(batch.length));
    } catch {
      /* brak sieci — spróbujemy później; punkty zostają w telefonie */
    } finally {
      sending.current = false;
    }
  };

  useEffect(() => {
    if (!enabled || !live || live.kmh === null || live.kmh < TRACE.minKmh || !inPoland(live.lat, live.lon)) return;
    const prev = last.current;
    if (prev && (live.t - prev[0] < TRACE.everyMs || metres({ lat: prev[1], lon: prev[2] }, live) < TRACE.everyM)) return;
    const p: Point = [live.t, Math.round(live.lat * 1e6) / 1e6, Math.round(live.lon * 1e6) / 1e6, Math.round(live.kmh), live.heading === null ? null : Math.round(live.heading)];
    last.current = p;
    const points = [...read(), p];
    write(points);
    if (points.length >= TRACE.uploadPoints) upload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, live?.t]);

  useEffect(() => {
    if (!enabled || !token) return;
    upload();
    const id = setInterval(() => upload(), TRACE.uploadMs);
    const onHide = () => document.visibilityState === "hidden" && upload(true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]);
}

export type ReportKind = "camera" | "section" | "police" | "itd" | "height" | "weight" | "speed" | "truck_ban" | "closed" | "parking" | "mop" | "fuel" | "gate" | "bad_turn" | "other";

/** `quick` — jedno dotknięcie wysyła od razu (w czasie jazdy), bez wyboru i przycisku „Wyślij”. */
/** `quick` — wysyłane jednym dotknięciem (alerty w jeździe); `place` — miejsce, którego nie ma na mapie (też jednym dotknięciem). */
export const REPORT_KINDS: { id: ReportKind; label: string; unit?: string; min?: number; max?: number; step?: number; def?: number; quick?: boolean; place?: boolean }[] = [
  { id: "camera", label: "Fotoradar", quick: true },
  { id: "section", label: "Odcinkowy pomiar", quick: true },
  { id: "police", label: "Kontrola policji", quick: true },
  { id: "itd", label: "Kontrola ITD", quick: true },
  { id: "height", label: "Niski wiadukt / most", unit: "m", min: 1.5, max: 6, step: 0.1, def: 4 },
  { id: "weight", label: "Ograniczenie tonażu", unit: "t", min: 1, max: 60, step: 0.5, def: 12 },
  { id: "speed", label: "Ograniczenie prędkości", unit: "km/h", min: 5, max: 140, step: 10, def: 50 },
  { id: "truck_ban", label: "Zakaz dla ciężarówek" },
  { id: "closed", label: "Droga zamknięta" },
  { id: "parking", label: "Parking dla ciężarówek", place: true },
  { id: "mop", label: "MOP", place: true },
  { id: "fuel", label: "Stacja paliw", place: true },
  { id: "gate", label: "Wjazd TIR", place: true },
  { id: "other", label: "Inne" },
];

export function sendReport(token: string, r: { kind: ReportKind; lat: number; lon: number; heading: number | null; value: number | null; note: string }) {
  return api("POST", "/collect/report", r, token);
}

/** Najbliższa droga przy przytrzymanym miejscu (punkt na osi drogi i nazwa) — null = brak drogi w pobliżu. */
export interface SnappedRoad {
  lat: number;
  lon: number;
  name: string;
  offM: number;
}

export async function snapRoad(token: string, at: { lat: number; lon: number }): Promise<SnappedRoad | null> {
  const r = await api<{ road: SnappedRoad | null }>("POST", "/geo/snap", { lat: at.lat, lon: at.lon }, token);
  return r.road;
}

export function setConsent(token: string, on: boolean) {
  return api<{ dataConsent: boolean }>("POST", "/consent", { on }, token);
}

/** Usuwa z serwera wszystko, co kierowca przekazał do mapy, i cofa zgodę. */
export async function deleteMyMapData(token: string) {
  await api("DELETE", "/collect", undefined, token);
  clearTrace();
}
