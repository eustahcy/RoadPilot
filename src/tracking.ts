// Śledzenie GPS w przeglądarce: odczyty z Geolocation API → licznik km i liczniki kierowcy.

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { addFix, AUTO_STOP_IDLE, creditDriving, creditStop, Fix, GPS, Live, nextAutoStop, nextLive, startTrack } from "./core/gps";
import { recordDrive, recordStop } from "./core/history";
import { RULES } from "./core/rules";
import { ActiveStop, endStop } from "./core/stop";
import { AppState } from "./state";

export type GpsStatus = "off" | "waiting" | "ok" | "weak" | "denied" | "unavailable";

/** Częściej nie ma sensu — i tak przeliczamy cały plan przy każdym odczycie. */
const MIN_FIX_INTERVAL_MS = 5_000;

export function tripTotalKm(s: AppState) {
  return s.trip.profile === "custom" ? s.trip.segments.reduce((a, x) => a + x.km, 0) : s.trip.distance;
}

/**
 * Bez odczytów od tylu ms urządzenie liczące jazdę traci tę rolę — przejmuje ją inne z GPS (ta sama wartość
 * w server/index.mjs nie jest potrzebna: serwer pilnuje tylko wersji zapisu).
 */
export const TRACKER_TTL_MS = 3 * 60_000;

/** Stały identyfikator tego urządzenia (przeglądarki) — do wyboru, które liczy jazdę. */
export const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem("roadpilot:device");
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem("roadpilot:device", id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();

/** Czy jazdę liczy inne urządzenie (świeże odczyty w ciągu TRACKER_TTL_MS). */
export function otherTracker(s: AppState, t: number, device = DEVICE_ID) {
  return !!s.tracker && s.tracker.device !== device && t - s.tracker.at < TRACKER_TTL_MS;
}

/**
 * Nakłada odczyt GPS na stan: odlicza km od trasy, dolicza jazdę i zaliczone postoje. Gdy jazdę liczy inne urządzenie
 * na tym koncie, prowadzimy tylko własny licznik (bez doliczania) — przy przejęciu nie zaliczymy drugi raz tego samego czasu.
 */
export function applyFix(s: AppState, fix: Fix, device = DEVICE_ID): AppState {
  if (!s.track) return fix.accuracy <= GPS.maxAccuracyM ? { ...s, track: startTrack(fix) } : s;
  const r = addFix(s.track, fix);
  if (r.track === s.track) return s;
  if (otherTracker(s, fix.t, device)) return { ...s, track: r.track };
  let driver = s.driver;
  let stop = s.stop;
  let history = s.history;
  if (stop && r.driveMin > 0) {
    // Ruszyliśmy bez „Koniec przerwy” — postój kończy się tam, gdzie zaczęła się jazda. Postoju z GPS nie liczymy drugi raz.
    const end = fix.t - r.driveMin * 60_000;
    driver = endStop(driver, stop, end);
    history = recordStop(history, stop.start, end);
    stop = null;
  } else if (r.stopEnded && !stop) {
    driver = creditStop(driver, r.stopEnded.start, r.stopEnded.end);
    history = recordStop(history, r.stopEnded.start, r.stopEnded.end);
  }
  driver = creditDriving(driver, r.driveMin);
  history = recordDrive(history, fix.t, r.driveMin, r.km);
  const doneKm = Math.min(tripTotalKm(s), s.trip.doneKm + r.km);
  return { ...s, track: r.track, driver, stop, history, odoKm: s.odoKm + r.km, trip: doneKm === s.trip.doneKm ? s.trip : { ...s.trip, doneKm }, tracker: { device, at: fix.t } };
}

/** Kierowca zaczyna postój. */
export function startStop(s: AppState, start: number, targetMin: number | null, auto = false): AppState {
  return { ...s, stop: auto ? { start, targetMin, auto } : { start, targetMin } };
}

/**
 * Kierowca kończy postój: zaliczamy faktyczny czas. Postój wykryty przez GPS zaczynamy liczyć od nowa od tej chwili,
 * żeby po ruszeniu ten sam czas nie został zaliczony drugi raz.
 */
export function finishStop(s: AppState, end: number): AppState {
  if (!s.stop) return s;
  const track = s.track && s.track.stopSince !== null ? { ...s.track, stopSince: Math.max(s.track.stopSince, end) } : s.track;
  return { ...s, driver: endStop(s.driver, s.stop, end), stop: null, track, history: end > s.stop.start ? recordStop(s.history, s.stop.start, end) : s.history };
}

/** „Zakończ dzień”: odpoczynek dzienny od teraz — trwający postój (np. włączony po zatrzymaniu) staje się odpoczynkiem od swojego początku. */
export function endDay(s: AppState, now: number): AppState {
  return { ...s, stop: { start: s.stop?.start ?? now, targetMin: RULES.regularDailyRest, dayEnd: true } };
}

/**
 * „Rozpocznij dzień”: kończy trwający odpoczynek (zalicza faktyczny czas) i zaczyna nowy dzień pracy od teraz —
 * także gdy odpoczynek był krótszy niż 9 h (decyzja kierowcy; UI o tym ostrzega).
 */
export function startDay(s: AppState, now: number): AppState {
  const after = finishStop(s, now);
  return { ...after, driver: { ...after.driver, shiftStart: now, drivenTodayMin: 0, sinceBreakMin: 0, splitBreakTaken: false } };
}

export function changeStop(s: AppState, patch: Partial<ActiveStop>): AppState {
  return s.stop ? { ...s, stop: { ...s.stop, ...patch } } : s;
}

export function useGpsTracking(enabled: boolean, setState: Dispatch<SetStateAction<AppState>>): { status: GpsStatus; live: Live | null } {
  const [status, setStatus] = useState<GpsStatus>("off");
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      setLive(null);
      return;
    }
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setStatus("unavailable");
      return;
    }
    setStatus("waiting");
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: Fix = {
          t: pos.timestamp,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
        };
        setStatus(fix.accuracy <= GPS.maxAccuracyM ? "ok" : "weak");
        // Prędkość do HUD — z każdego odczytu; liczniki trasy rzadziej.
        setLive((prev) => nextLive(prev, fix, pos.coords.heading));
        if (fix.t - last < MIN_FIX_INTERVAL_MS) return;
        last = fix.t;
        setState((s) => applyFix(s, fix));
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "weak"),
      { enableHighAccuracy: true, maximumAge: MIN_FIX_INTERVAL_MS, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, setState]);

  useWakeLock(enabled);
  return { status, live };
}

/**
 * Postój „sam”: po 5 s stania włącza postój bez limitu od chwili zatrzymania.
 * Kończy go ruszenie (applyFix). Sprawdzamy też co sekundę, bo na postoju odbiornik potrafi przestać podawać odczyty.
 */
export function useAutoStop(enabled: boolean, live: Live | null, stopActive: boolean, setState: Dispatch<SetStateAction<AppState>>) {
  const auto = useRef(AUTO_STOP_IDLE);
  const kmh = live?.kmh ?? null;

  useEffect(() => {
    if (!enabled) {
      auto.current = AUTO_STOP_IDLE;
      return;
    }
    const step = (t: number) => {
      const r = nextAutoStop(auto.current, kmh, t, stopActive);
      auto.current = r.auto;
      const startAt = r.startAt;
      // Nie wiemy, jak długo będziemy stać — postój bez limitu, kończy go ruszenie.
      // Postój sam włącza tylko urządzenie, które liczy jazdę — inne dostanie go z konta.
      if (startAt !== undefined) setState((s) => (s.stop || otherTracker(s, t) ? s : startStop(s, startAt, null, true)));
    };
    step(live?.t ?? Date.now());
    const id = setInterval(() => step(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled, kmh, live?.t, stopActive, setState]);
}

/** Przy wygaszonym ekranie przeglądarka nie podaje pozycji — trzymamy ekran włączony, gdy się da. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (active) lock = l;
        else l.release();
      } catch {
        /* brak zgody / oszczędzanie baterii — GPS działa dalej, dopóki ekran jest włączony */
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}
