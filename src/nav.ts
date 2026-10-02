// Nawigacja dla ciężarówek (beta): wyszukiwanie celu i trasa przez RoadPilot API → TomTom.
// Klucz TomTom jest tylko na serwerze; tu wysyłamy cel, punkt startu i dane pojazdu. Tylko konta Premium.

/** Dostęp do nawigacji: konto z Premium (admin ma zawsze). */
export type NavAccess = "guest" | "noPremium" | "premium";

import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Segment } from "./core/route";
import { HERE, locate, pointAtKm, pushTrail, RoadSection, TrailPoint, trailM } from "./core/navmatch";
import { distanceM } from "./core/gps";

export interface Vehicle {
  heightM: number;
  widthM: number;
  lengthM: number;
  weightKg: number;
  axleWeightKg: number;
  axles: number;
  /** Kategoria tunelowa ADR — "none" = bez towarów niebezpiecznych. */
  adr: "none" | "B" | "C" | "D" | "E";
  /** Prędkość maksymalna pojazdu (ogranicznik) — TomTom liczy z nią czas przejazdu. */
  maxKmh: number;
  /** Jakich dróg unikać (Nawigacja → ⋯ → Ustawienia) — silnik omija, o ile da się dojechać inaczej. */
  avoid?: RouteAvoid;
}

export interface RouteAvoid { tolls: boolean; motorways: boolean; ferries: boolean }
export const NO_AVOID: RouteAvoid = { tolls: false, motorways: false, ferries: false };

/** Typowy ciągnik siodłowy z naczepą (UE). */
export const DEFAULT_VEHICLE: Vehicle = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, adr: "none", maxKmh: 90 };

export interface NavPlace {
  label: string;
  sub: string;
  lat: number;
  lon: number;
}

/** Trasa z TomTom w formacie aplikacji (server/nav.mjs → parseRoute). Kilometry liczone od startu trasy. */
/** Silnik, który policzył trasę: zawsze własny RoadPilot (OSM Polska); TomTom tylko awaryjnie po stronie serwera (poza Polską / awaria). */
export type NavEngine = "tomtom" | "roadpilot";
/** Rodzaj trasy: najszybsza / najkrótsza / ekonomiczna (TomTom eco; własny silnik liczy ją jak najszybszą). */
export type RouteType = "fastest" | "shortest" | "eco";
export const ROUTE_TYPES: { id: RouteType; label: string; hint: string }[] = [
  { id: "fastest", label: "Najszybsza", hint: "Najkrótszy czas jazdy — autostrady i ekspresówki, z korkami." },
  { id: "shortest", label: "Najkrótsza", hint: "Najmniej kilometrów, nawet kosztem czasu — dłuższe odcinki przez miasta." },
  { id: "eco", label: "Ekonomiczna", hint: "Kompromis czasu i paliwa (TomTom); własny silnik liczy ją jak najszybszą." },
];

export interface NavRoute {
  /** Kiedy wyznaczona (ms) i skąd — do „wyznacz ponownie”. */
  at: number;
  from: { lat: number; lon: number };
  to: NavPlace;
  ferry: boolean;
  /** Którym silnikiem wyznaczona; fallback = TomTom niedostępny / limit, więc użyto własnego. */
  engine?: NavEngine;
  fallback?: boolean;
  lengthKm: number;
  /** Czas jazdy według TomTom (z korkami) i samo opóźnienie z korków (min). */
  travelMin: number;
  trafficMin: number;
  segments: Segment[];
  /** [lat, lon, km od startu]. */
  points: [number, number, number][];
  instructions: { km: number; maneuver: string; text: string; street?: string; signpost?: string; exit?: string; roundaboutExit?: string; angle?: number }[];
  lanes: { km: number; toKm: number; lanes: { dirs: string[]; follow?: string }[] }[];
  speedLimits: { km: number; toKm: number; kmh: number }[];
  /** Rodzaj drogi wg przepisów (obszar zabudowany / poza / autostrada i ekspresowa) — limity ciężarówki; brak w starszych trasach. */
  roads?: RoadSection[];
  /** Korki, roboty i zamknięcia na trasie (TomTom, w chwili wyznaczenia); level 1 = małe … 3 = duże, 4 = zamknięte. */
  traffic?: TrafficSection[];
  /** Kiedy korki odświeżono w trakcie jazdy (TRAFFIC_REFRESH) — brak = tylko z chwili wyznaczenia (własny silnik: żadnych). */
  trafficAt?: number;
  /** Ograniczenia na trasie, których pojazd nie spełnia (nasze dane: OSM + zgłoszenia) — brak = nie sprawdzono. */
  warnings?: RouteWarning[];
  /** Stacje, MOP-y i parkingi przy trasie (pinezki) — dociągane razem z ostrzeżeniami. */
  pois?: RoutePoi[];
  /** Część trasy (0–1) z czasem z jazdy kierowców RoadPilot (zmierzone prędkości ciężarówek). */
  realSpeedShare?: number;
  /** Trasa prowadzi do wjazdu TIR zgłoszonego przez kierowcę (zamiast do punktu celu z wyszukiwarki). */
  gate?: { lat: number; lon: number };
  /** Ciasne łuki drogi z geometrii trasy (własny silnik) — ostrzeżenie dla długich zestawów. */
  curves?: { km: number; radiusM: number }[];
  /** Punkty pośrednie (dodane przytrzymaniem na mapie), w kolejności przejazdu. */
  via?: NavPlace[];
}

export interface TrafficSection {
  km: number;
  toKm: number;
  delayMin: number;
  level: number;
  cause: "jam" | "roadwork" | "closed";
  kmh?: number;
}

export type JamTone = "slow" | "jam" | "closed";

/**
 * Kolor utrudnienia na mapie: żółty = wolniej, czerwony = korek (duże opóźnienie TomTom albo < 25 km/h),
 * ciemnoczerwony = droga zamknięta.
 */
export function jamTone(t: TrafficSection): JamTone {
  if (t.cause === "closed" || t.level >= 4) return "closed";
  if (t.level >= 3 || (t.cause === "jam" && t.kmh !== undefined && t.kmh < 25)) return "jam";
  return "slow";
}

/** Utrudnienia warte pokazania kierowcy: każdy korek i zamknięcie, spowolnienie od minuty opóźnienia. */
export const jamMatters = (t: TrafficSection) => jamTone(t) !== "slow" || t.delayMin >= 1;

export interface RouteWarning {
  km: number;
  /** Koniec odcinka (odcinkowy pomiar prędkości). */
  toKm?: number;
  source: "osm" | "report";
  id: string;
  kind: string;
  value: number | null;
  raw: string;
  name: string;
  lat: number;
  lon: number;
  /** Warunek z OSM („22:00–06:00”, „tylko dojazd — cel w strefie”). */
  note?: string;
  /** W chwili przejazdu nie obowiązuje (zakaz w innych godzinach, dojazd do celu) — informacja, bez objazdu i alarmu. */
  soft?: boolean;
}

/** Miejsce przy trasie (pinezka na mapie): stacja paliw, MOP z obsługą, MOP, parking TIR — z OSM (server/pois.mjs). */
export interface RoutePoi {
  km: number;
  id: string;
  /** toll = bramki (punkt poboru opłat). */
  kind: "fuel" | "services" | "mop" | "parking" | "toll";
  name: string;
  /** Oznaczone dla ciężarówek (hgv / olej HGV). */
  truck: boolean;
  lat: number;
  lon: number;
  /** Po której stronie drogi względem kierunku jazdy. */
  side: "left" | "right";
  offM: number;
}

/** Fotoradary, odcinkowe pomiary i kontrole — tylko ostrzegamy (nie są ograniczeniem dla pojazdu). */
export const ALERT_KINDS = new Set(["camera", "red_light", "section", "police", "itd"]);
export const isAlert = (w: RouteWarning) => ALERT_KINDS.has(w.kind);

/** Ostrzeżenie „przed nami albo trwa” (odcinkowy pomiar — do jego końca). */
export const isAhead = (w: RouteWarning, km: number) => w.km >= km - 0.05 || (w.toKm !== undefined && km <= w.toKm);

/** Opis ostrzeżenia dla kierowcy: „Wiadukt 3,5 m”, „Nacisk osi 10 t”, „Zakaz dla ciężarówek”, „Fotoradar 70 km/h”. */
export function warningText(w: RouteWarning): string {
  return w.note ? `${baseWarningText(w)} · ${w.note}` : baseWarningText(w);
}

function baseWarningText(w: RouteWarning): string {
  const n = w.value === null ? "" : ` ${String(w.value).replace(".", ",")}`;
  const rep = w.source === "report" ? " (zgłoszenie)" : "";
  switch (w.kind) {
    case "camera": return `Fotoradar${n && `${n} km/h`}${rep}`;
    case "red_light": return "Kamera na czerwonym świetle";
    case "section": return `Odcinkowy pomiar prędkości${n && `${n} km/h`}${w.toKm !== undefined ? ` · ${fmtLen(w.toKm - w.km)}` : ""}${rep}`;
    case "police": return "Kontrola policji (zgłoszenie)";
    case "itd": return "Kontrola ITD (zgłoszenie)";
    case "height": return `Wiadukt / wysokość${n} m`;
    case "weight": return `Ograniczenie masy${n} t`;
    case "axle": return `Nacisk osi${n} t`;
    case "width": return `Szerokość${n} m`;
    case "length": return `Długość${n} m`;
    case "hgv": return w.raw === "destination" || w.raw === "delivery" ? "Zakaz tranzytu ciężarówek" : "Zakaz dla ciężarówek";
    case "truck_ban": return "Zakaz dla ciężarówek (zgłoszenie)";
    case "incline": return `Stromy odcinek${n}%`;
    case "curve": return `Ciasny zakręt${w.value !== null ? ` (promień ${w.value} m)` : ""}`;
    case "closed": return "Droga zamknięta (zgłoszenie)";
    default: return w.kind;
  }
}

const fmtLen = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${String(Math.round(km * 10) / 10).replace(".", ",")} km`);

/** Od tej długości zestawu (m) ostrzegamy o ciasnych zakrętach. */
const CURVE_FROM_LENGTH_M = 12;

/** Ciasne zakręty z trasy jako ostrzeżenia (tylko długie zestawy) — dokładane do ostrzeżeń z serwera. */
function curveWarnings(route: NavRoute, vehicle: Vehicle, from = -Infinity, to = Infinity): RouteWarning[] {
  if (vehicle.lengthM < CURVE_FROM_LENGTH_M) return [];
  return (route.curves ?? []).filter((c) => c.km >= from && c.km <= to).map((c) => {
    const p = pointAtKm(route.points, c.km) ?? { lat: 0, lon: 0 };
    return { km: c.km, source: "osm" as const, id: `c${Math.round(c.km * 1000)}`, kind: "curve", value: c.radiusM, raw: "", name: "", lat: p.lat, lon: p.lon };
  });
}

/** Ostrzeżenia dla trasy z naszej bazy — błąd nie blokuje nawigacji (trasa zostaje bez ostrzeżeń). */
export async function withWarnings(token: string, route: NavRoute, vehicle: Vehicle): Promise<NavRoute> {
  try {
    const r = await api<{ warnings: RouteWarning[]; pois?: RoutePoi[] }>("POST", "/nav/warnings", { points: route.points, vehicle, tolls: true, lengthKm: route.lengthKm, travelMin: route.travelMin }, token);
    return { ...route, warnings: [...r.warnings, ...curveWarnings(route, vehicle)].sort((a, b) => a.km - b.km), pois: r.pois ?? [] };
  } catch {
    return route;
  }
}

/** Po minięciu fotoradaru / kontroli: „nadal jest” (+1) / „nie ma” (-1). */
export function voteAlert(token: string, w: RouteWarning, vote: 1 | -1) {
  return api("POST", "/alerts/vote", { source: w.source, id: w.id, kind: w.kind, vote }, token);
}

/** Kontrole ze zgłoszeń żyją kilka godzin — w czasie jazdy dociągamy ostrzeżenia na tyle km przed nami. */
export const ALERTS_REFRESH = { everyMs: 5 * 60_000, aheadKm: 80 } as const;

/**
 * Świeże ostrzeżenia na odcinku trasy przed nami (od `km`) — zastępują dotychczasowe z tego odcinka.
 * null = nie udało się (zostają stare). Wysyłamy tylko kawałek trasy, żeby nie zużywać danych.
 */
export async function refreshWarnings(token: string, route: NavRoute, km: number, vehicle: Vehicle): Promise<RouteWarning[] | null> {
  const lo = km - 0.5;
  const hi = km + ALERTS_REFRESH.aheadKm;
  const points = route.points.filter((p) => p[2] >= lo && p[2] <= hi);
  if (points.length < 2) return null;
  try {
    const r = await api<{ warnings: RouteWarning[] }>("POST", "/nav/warnings", { points, vehicle, pois: false, lengthKm: route.lengthKm, travelMin: route.travelMin }, token);
    const [a, b] = [points[0][2], points[points.length - 1][2]];
    return [...(route.warnings ?? []).filter((w) => w.km < a || w.km > b), ...r.warnings, ...curveWarnings(route, vehicle, a, b)].sort((x, y) => x.km - y.km);
  } catch {
    return null;
  }
}

/** Korki są na razie wyłączone (2026-10-01: licencja i limity TomTom) — true włącza odświeżanie i ich pokazywanie (serwer: TRAFFIC_ENABLED=1). */
export const TRAFFIC_ON: boolean = false;

/** Korki z TomTom na trasie przed nami — dla obu silników, co kilka minut (trasa TomTom ma je tylko z chwili wyznaczenia). */
export const TRAFFIC_REFRESH = { everyMs: 5 * 60_000, aheadKm: 150 } as const;

/**
 * Bieżące utrudnienia na odcinku trasy przed nami (od `km`) — zastępują dotychczasowe z tego odcinka; za nami i dalej
 * zostają. null = nie udało się (zostają stare).
 */
export async function refreshTraffic(token: string, route: NavRoute, km: number): Promise<Pick<NavRoute, "traffic" | "trafficMin" | "trafficAt"> | null> {
  const points = route.points.filter((p) => p[2] >= km - 0.5 && p[2] <= km + TRAFFIC_REFRESH.aheadKm);
  if (points.length < 2) return null;
  try {
    const r = await api<{ traffic: TrafficSection[] }>("POST", "/nav/traffic", { points }, token);
    const [a, b] = [points[0][2], points[points.length - 1][2]];
    const traffic = [...(route.traffic ?? []).filter((t) => t.toKm < a || t.km > b), ...r.traffic].sort((x, y) => x.km - y.km);
    // „Korki teraz” — opóźnienie z utrudnień, których jeszcze nie minęliśmy.
    const trafficMin = Math.round(traffic.filter((t) => t.toKm > km).reduce((sum, t) => sum + t.delayMin, 0) * 10) / 10;
    return { traffic, trafficMin, trafficAt: Date.now() };
  } catch {
    return null;
  }
}

export async function searchPlaces(token: string, q: string, near?: { lat: number; lon: number } | null): Promise<NavPlace[]> {
  const params = new URLSearchParams({ q });
  if (near) {
    // Do podpowiedzi „w pobliżu” wystarczy przybliżona pozycja (~1 km).
    params.set("lat", near.lat.toFixed(2));
    params.set("lon", near.lon.toFixed(2));
  }
  const r = await api<{ results: NavPlace[] }>("GET", `/nav/search?${params}`, undefined, token);
  return r.results;
}

export async function fetchRoute(token: string, from: { lat: number; lon: number }, to: NavPlace, vehicle: Vehicle, now: number, routeType: RouteType = "fastest", via: NavPlace[] = []): Promise<NavRoute> {
  const r = await api<{ route: Omit<NavRoute, "at" | "from" | "to"> }>("POST", "/nav/route", { from, to: { lat: to.lat, lon: to.lon }, vehicle, routeType, via: via.map((p) => ({ lat: p.lat, lon: p.lon })) }, token);
  return withWarnings(token, { ...r.route, at: now, from, to, via }, vehicle);
}

/** Punkty pośrednie, których jeszcze nie minęliśmy (km po trasie dalej niż my, a nie tuż obok nas). */
export function viaAhead(route: NavRoute, pos: { lat: number; lon: number } | null): NavPlace[] {
  const via = route.via ?? [];
  if (!pos) return via;
  const me = locate(route.points, pos)?.km ?? 0;
  return via.filter((v) => {
    const at = locate(route.points, v);
    return (at ? at.km > me + 0.2 : true) && distanceM(pos, v) > 300;
  });
}

/** Nowy punkt pośredni w kolejności przejazdu: przed pierwszym punktem, który na trasie leży dalej niż on. */
export function insertVia(route: NavRoute, via: NavPlace[], p: NavPlace): NavPlace[] {
  const km = (x: NavPlace) => locate(route.points, x)?.km ?? Infinity;
  const at = km(p);
  const i = via.findIndex((v) => km(v) > at);
  return i < 0 ? [...via, p] : [...via.slice(0, i), p, ...via.slice(i)];
}

/** Trasa z alternatywami (do porównania) — każda już z ostrzeżeniami z naszej bazy. Pierwsza = najlepsza wg silnika. */
export async function fetchRoutes(token: string, from: { lat: number; lon: number }, to: NavPlace, vehicle: Vehicle, now: number, routeType: RouteType = "fastest"): Promise<NavRoute[]> {
  const r = await api<{ route: Omit<NavRoute, "at" | "from" | "to">; alternatives?: Omit<NavRoute, "at" | "from" | "to">[] }>("POST", "/nav/route", { from, to: { lat: to.lat, lon: to.lon }, vehicle, routeType, alternatives: true }, token);
  // Różne `at` — po nim aplikacja rozpoznaje trasę (np. dociąganie ostrzeżeń).
  return Promise.all([r.route, ...(r.alternatives ?? [])].map((x, i) => withWarnings(token, { ...x, at: now + i, from, to }, vehicle)));
}

/** Jednorazowa pozycja (także gdy śledzenie GPS jest wyłączone). */
export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Brak GPS w tej przeglądarce."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? "Brak zgody na lokalizację — zezwól na nią w przeglądarce." : "Nie udało się ustalić pozycji. Spróbuj ponownie.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

/** Ograniczenie i rodzaj drogi tam, gdzie jedziemy (bez trasy) — w formacie trasy, `km` = nasza pozycja na śladzie. */
export interface LimitHere {
  speedLimits: NavRoute["speedLimits"];
  roads: RoadSection[];
  km: number;
  /** Miejsce zapytania — dalej niż HERE.validM od niego odpowiedź już nie obowiązuje. */
  lat: number;
  lon: number;
}

/**
 * Ograniczenie bez wyznaczonej trasy: zbiera ślad z odczytów GPS i co HERE.askEveryM pyta serwer (Premium).
 * Wyłączone (np. jedziemy po trasie) — ślad i odpowiedź się zerują, żeby po powrocie nie pokazać starego znaku.
 */
export function useLimitHere(token: string | undefined, live: { lat: number; lon: number; t: number } | null, enabled: boolean): LimitHere | null {
  const [here, setHere] = useState<LimitHere | null>(null);
  const trail = useRef<TrailPoint[]>([]);
  const asked = useRef<{ lat: number; lon: number } | null>(null);
  const busy = useRef(false);
  const on = enabled && !!token;

  useEffect(() => {
    if (on) return;
    trail.current = [];
    asked.current = null;
    setHere(null);
  }, [on]);

  useEffect(() => {
    if (!on || !live) return;
    trail.current = pushTrail(trail.current, live);
    const pts = trail.current;
    if (busy.current || pts.length < 2 || trailM(pts) < HERE.minM) return;
    if (asked.current && distanceM(asked.current, live) < HERE.askEveryM) return;
    const at = { lat: live.lat, lon: live.lon };
    asked.current = at;
    busy.current = true;
    api<Omit<LimitHere, "lat" | "lon">>("POST", "/nav/here", { points: pts }, token)
      .then((r) => setHere({ ...r, ...at }))
      // Bez sieci / błąd — spróbujemy po kolejnych HERE.askEveryM.
      .catch(() => {})
      .finally(() => {
        busy.current = false;
      });
    // live jako obiekt zmienia się z każdym odczytem — wystarczy czas odczytu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, live?.t, token]);

  return here && live && distanceM(here, live) <= HERE.validM ? here : null;
}

/** Stacja / MOP / parking TIR wokół pozycji (bez trasy) — z bazy OSM na serwerze. */
export type NearbyPoi = Pick<RoutePoi, "id" | "kind" | "name" | "truck" | "lat" | "lon">;

/** Pobieramy ponownie po tylu km jazdy; serwer zwraca zasięg listy + ten zapas, więc przed nami zawsze jest pełne `km`. */
const NEARBY_REFETCH_KM = 8;

/** Miejsca wokół pozycji do listy „Po drodze” bez trasy (Premium), `km` = zasięg listy; błąd / brak sieci — ponowna próba po NEARBY_REFETCH_KM. */
export function useNearbyPois(token: string | undefined, live: { lat: number; lon: number; t: number } | null, enabled: boolean, km: number): NearbyPoi[] | null {
  const [pois, setPois] = useState<NearbyPoi[] | null>(null);
  const at = useRef<{ lat: number; lon: number; km: number } | null>(null);
  const on = enabled && !!token;
  useEffect(() => {
    if (!on || !live) return;
    if (at.current && at.current.km === km && distanceM(at.current, live) < NEARBY_REFETCH_KM * 1000) return;
    at.current = { lat: live.lat, lon: live.lon, km };
    api<{ pois: NearbyPoi[] }>("GET", `/nav/nearby?lat=${live.lat.toFixed(4)}&lon=${live.lon.toFixed(4)}&km=${km + NEARBY_REFETCH_KM}`, undefined, token)
      .then((r) => setPois(r.pois))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, live?.t, token, km]);
  return on ? pois : null;
}
