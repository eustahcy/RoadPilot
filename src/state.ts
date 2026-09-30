// Stan aplikacji zapisywany lokalnie w urządzeniu (bez backendu).

import { useEffect, useState } from "react";
import { GpsTrack } from "./core/gps";
import { DayLog } from "./core/history";
import { DriverState } from "./core/plan";
import { DEFAULT_SPEEDS, ProfileId, Segment, Speeds } from "./core/route";
import { ScenarioId } from "./core/scenarios";
import { ServiceInfo } from "./core/service";
import { ActiveStop } from "./core/stop";
import { MusicApp } from "./core/apps";
import { DEFAULT_HUD_ITEMS, HudItems, HudStyle } from "./hudConfig";
import { DEFAULT_VEHICLE, NavEngine, NavPlace, NavRoute, Vehicle } from "./nav";
import { DEFAULT_WORK, WorkSettings } from "./core/workday";

export interface Trip {
  /** Miejsce startu — tylko do opisu osi trasy w HUD. */
  origin: string;
  destination: string;
  /** Cel wybrany w wyszukiwarce nawigacji (punkt) — null, gdy cel to tylko tekst. */
  dest: NavPlace | null;
  distance: number;
  profile: ProfileId;
  /** Używane tylko dla profilu „custom”. */
  segments: Segment[];
  trafficPct: number;
  /** Godzina rozładunku / awizacji (ms) — null, gdy nie ma. */
  unloadAt: number | null;
  /** Ile minut przed awizacją chcę być na miejscu. */
  unloadBufferMin: number;
  /** Km przejechane od ustawienia dystansu (licznik GPS) — plan liczy tylko resztę trasy. */
  doneKm: number;
}

export interface Settings {
  speeds: Speeds;
  /** Ile minut przed postojem zacząć szukać parkingu. */
  parkingBufferMin: number;
  allowExtension: boolean;
  allowReducedRest: boolean;
  /** Śledzenie GPS: odlicza km i dolicza jazdę do liczników. */
  gps: boolean;
  /** Przyjazd liczony z prędkości z ostatnich 10 min zamiast z prędkości typów dróg. */
  liveEta: boolean;
  /** Termin i kilometry do serwisu pojazdu. */
  service: ServiceInfo;
  /** HUD: obraz w lustrzanym odbiciu — do odbicia w szybie (telefon leży na desce). */
  hudMirror: boolean;
  /** Stałe powiadomienie (jak odtwarzacz muzyki) — trzyma aplikację przy życiu w tle. */
  ongoing: boolean;
  /** Po 5 s stania (GPS) postój włącza się sam. */
  autoStop: boolean;
  /** HUD: przesuwające się pasy ruchu wokół prędkości. */
  hudAnimation: boolean;
  /** HUD: styl i widoczne elementy (osobno dla każdego stylu). Nazwa drogi = element „road”. */
  hudStyle: HudStyle;
  hudItems: Record<HudStyle, HudItems>;
  /** Czas pracy: limit, wydłużenie do 15 h, przypomnienia. */
  work: WorkSettings;
  /** Skróty w HUD: aplikacja muzyki i nawigacji ("none" = bez przycisku). */
  musicApp: MusicApp;
  /** Nawigacja RoadPilot dla ciężarówek (beta, TomTom) i dane pojazdu do niej. */
  navEnabled: boolean;
  vehicle: Vehicle;
  /** Silnik tras (Ustawienia → Pojazd i nawigacja). */
  navEngine: NavEngine;
  /** Komunikaty głosowe nawigacji (przycisk 🔊 w HUD). */
  navVoice: boolean;
}

export interface AppState {
  version: 1;
  trip: Trip;
  driver: DriverState;
  settings: Settings;
  /** Planowanie na inną godzinę niż „teraz” (ms) — null = aktualny czas. */
  planTime: number | null;
  /** Stan licznika GPS (zapisany, żeby po ponownym otwarciu doliczyć, co działo się w międzyczasie). */
  track: GpsTrack | null;
  /** Wszystkie km policzone przez GPS (nie zeruje się ze zmianą trasy) — do odliczania km do serwisu. */
  odoKm: number;
  /** Otwarty tryb HUD — po ponownym uruchomieniu aplikacja wraca do niego. */
  hud: boolean;
  /** Trwający postój oznaczony przez kierowcę („zaczynam przerwę”) — null, gdy jedzie. */
  stop: ActiveStop | null;
  /** Scenariusz wybrany przez kierowcę zamiast zalecanego — null = zalecany przez RoadPilot. */
  choice: ScenarioId | null;
  /** Trasa z nawigacji (geometria, manewry, pasy) — tylko w tym urządzeniu, nie trafia na konto (duża). */
  navRoute: NavRoute | null;
  /** Historia dzienna z GPS (najnowszy dzień pierwszy). */
  history: DayLog[];
}

const KEY = "roadpilot:v1";

export function defaultState(now = Date.now()): AppState {
  return {
    version: 1,
    trip: { origin: "", destination: "", dest: null, distance: 660, profile: "mixed", segments: [], trafficPct: 5, unloadAt: null, unloadBufferMin: 30, doneKm: 0 },
    driver: {
      shiftStart: floorMinute(now),
      drivenTodayMin: 0,
      sinceBreakMin: 0,
      splitBreakTaken: false,
      extensionsLeft: 2,
      reducedRestsLeft: 3,
      weekDrivenMin: 0,
      prevWeekDrivenMin: 0,
    },
    settings: { speeds: { ...DEFAULT_SPEEDS }, parkingBufferMin: 45, allowExtension: false, allowReducedRest: false, gps: false, liveEta: false, service: { date: null, km: null, odoAtSet: 0 }, hudMirror: false, ongoing: false, autoStop: true, hudAnimation: true, hudStyle: "full", hudItems: { full: { ...DEFAULT_HUD_ITEMS.full }, minimal: { ...DEFAULT_HUD_ITEMS.minimal }, nav: { ...DEFAULT_HUD_ITEMS.nav } }, work: { ...DEFAULT_WORK }, musicApp: "none", navEnabled: false, vehicle: { ...DEFAULT_VEHICLE }, navEngine: "tomtom", navVoice: true },
    planTime: null,
    track: null,
    odoKm: 0,
    hud: false,
    stop: null,
    choice: null,
    navRoute: null,
    history: [],
  };
}

/** Elementy HUD scalone z domyślnymi; dawne „hudRoadInfo: false” wyłącza nazwę drogi w obu stylach. */
function hudItems(base: Settings["hudItems"], saved?: Partial<Settings> & { hudRoadInfo?: boolean }): Settings["hudItems"] {
  const road = saved?.hudItems === undefined && saved?.hudRoadInfo === false ? { road: false } : {};
  return { full: { ...base.full, ...saved?.hudItems?.full, ...road }, minimal: { ...base.minimal, ...saved?.hudItems?.minimal, ...road }, nav: { ...base.nav, ...saved?.hudItems?.nav, ...road } };
}

/** Zapisany (lub pobrany z konta) stan scalony z domyślnym — nowe pola dostają wartości domyślne. */
export function normalize(s: Partial<AppState>): AppState {
  const base = defaultState();
  if (s.version !== 1) return base;
  return {
    ...base,
    ...s,
    trip: { ...base.trip, ...s.trip },
    driver: { ...base.driver, ...s.driver },
    settings: { ...base.settings, ...s.settings, speeds: { ...base.settings.speeds, ...s.settings?.speeds }, service: { ...base.settings.service, ...s.settings?.service }, work: { ...base.settings.work, ...s.settings?.work }, hudItems: hudItems(base.settings.hudItems, s.settings), vehicle: { ...base.settings.vehicle, ...s.settings?.vehicle } },
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw) as Partial<AppState>) : defaultState();
  } catch {
    return defaultState();
  }
}

export function usePersistentState() {
  const [state, setState] = useState<AppState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* tryb prywatny / brak miejsca — aplikacja działa dalej bez zapisu */
    }
  }, [state]);
  return [state, setState] as const;
}

/** Aktualny czas, odświeżany co 15 s. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    const onVisible = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}

export function floorMinute(t: number) {
  return Math.floor(t / 60_000) * 60_000;
}
