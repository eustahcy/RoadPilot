// Śledzenie GPS w przeglądarce: odczyty z Geolocation API → licznik km i liczniki kierowcy.

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { addFix, AUTO_STOP_IDLE, creditDriving, creditStop, Fix, GapRoad, gapNeedsRoad, GPS, Live, nextAutoStop, nextLive, startTrack } from "./core/gps";
import { recordDrive, recordGap, recordStop } from "./core/history";
import { restViolation, trackViolations } from "./core/violations";
import { RULES } from "./core/rules";
import { ActiveStop, endStop } from "./core/stop";
import { AppState } from "./state";

export type GpsStatus = "off" | "waiting" | "ok" | "weak" | "denied" | "unavailable";

/** Odczyt starszy niż tyle ms po powrocie do aplikacji jest kasowany z `live` (czekamy na nowy). */
const LIVE_RESUME_MAX_MS = 30_000;

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

/** Czekamy na drogę z serwera dla luki najwyżej tyle — potem liczymy z linii prostej. */
export const GAP_WAIT_MS = 15_000;

/**
 * Nakłada odczyt GPS na stan: odlicza km od trasy, dolicza jazdę i zaliczone postoje, zapisuje przekroczenia. Gdy jazdę liczy
 * inne urządzenie na tym koncie, prowadzimy tylko własny licznik (bez doliczania) — przy przejęciu nie zaliczymy drugi raz tego samego czasu.
 *
 * Luka (aplikacja była zamknięta) z dużym przesunięciem: z `lookup` odczyt czeka w AppState.pendingGap, aż useGapRoad zapyta serwer
 * o prawdziwą drogę ciężarówki (wtedy applyFix z `road`); kolejne odczyty w tym czasie pomijamy — po odpowiedzi liczą się od odczytu z luki.
 */
export function applyFix(s: AppState, fix: Fix, device = DEVICE_ID, opts: { lookup?: boolean; road?: GapRoad | null } = {}): AppState {
  if (!s.track) return fix.accuracy <= GPS.maxAccuracyM ? { ...s, track: startTrack(fix) } : s;
  if (s.pendingGap) {
    if (fix.t - s.pendingGap.asked < GAP_WAIT_MS) return s;
    // Serwer nie odpowiedział — liczymy lukę z linii prostej, od odczytu, który na nią czekał.
    s = applyFix({ ...s, pendingGap: null }, s.pendingGap.fix, device, { road: null });
  }
  if (opts.road === undefined && opts.lookup && !otherTracker(s, fix.t, device) && gapNeedsRoad(s.track!, fix)) {
    return { ...s, pendingGap: { fix, from: { lat: s.track!.anchor.lat, lon: s.track!.anchor.lon }, asked: fix.t } };
  }
  const r = addFix(s.track!, fix, { road: opts.road, stopped: !!s.stop });
  if (r.track === s.track) return s;
  if (otherTracker(s, fix.t, device)) return { ...s, track: r.track };
  let driver = s.driver;
  let stop = s.stop;
  let history = s.history;
  const pos = { lat: fix.lat, lon: fix.lon };
  const est = !!r.gap;
  if (stop && r.driveMin > 0) {
    // Ruszyliśmy bez „Koniec przerwy” — postój kończy się tam, gdzie zaczęła się jazda. Postoju z GPS nie liczymy drugi raz.
    const end = r.driveEnd - r.driveMin * 60_000;
    history = restViolation(history, driver, stop.start, end, pos, false);
    driver = endStop(driver, stop, end);
    history = recordStop(history, stop.start, end, est);
    stop = null;
  } else if (r.stopEnded && !stop) {
    history = restViolation(history, driver, r.stopEnded.start, r.stopEnded.end, pos, false);
    driver = creditStop(driver, r.stopEnded.start, r.stopEnded.end);
    history = recordStop(history, r.stopEnded.start, r.stopEnded.end, est);
  }
  if (r.gap) history = recordGap(history, r.gap);
  history = trackViolations(history, driver, { t: fix.t, driveMin: r.driveMin, driveEnd: r.driveEnd, lat: fix.lat, lon: fix.lon, est });
  driver = creditDriving(driver, r.driveMin);
  history = recordDrive(history, r.driveEnd, r.driveMin, r.km);
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
  if (s.stop) {
    const pos = s.track ? { lat: s.track.anchor.lat, lon: s.track.anchor.lon } : null;
    after.history = restViolation(after.history, s.driver, s.stop.start, now, pos, true);
  }
  return { ...after, driver: { ...after.driver, shiftStart: now, drivenTodayMin: 0, sinceBreakMin: 0, splitBreakTaken: false } };
}

export function changeStop(s: AppState, patch: Partial<ActiveStop>): AppState {
  return s.stop ? { ...s, stop: { ...s.stop, ...patch } } : s;
}

/**
 * GPS → stan. `token` (konto): po luce z dużym przesunięciem pytamy serwer o prawdziwą drogę ciężarówki (useGapRoad),
 * bez konta luka liczy się z linii prostej. `hold` — stan z konta jeszcze nie pobrany: odczyty idą tylko do prędkości
 * na ekranie, liczniki czekają (inaczej wczorajszy stan z tego telefonu doliczyłby jazdę i nadpisał nowszy z innego).
 */
export function useGpsTracking(enabled: boolean, setState: Dispatch<SetStateAction<AppState>>, token: string | null = null, pendingGap: AppState["pendingGap"] = null, hold = false): { status: GpsStatus; live: Live | null } {
  const [status, setStatus] = useState<GpsStatus>("off");
  const [live, setLive] = useState<Live | null>(null);
  const lookup = useRef(!!token);
  lookup.current = !!token;
  const holdRef = useRef(hold);
  holdRef.current = hold;

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
    let prevFix: { t: number; lat: number; lon: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        // iPhone po powrocie z tła podaje ostatnią zapamiętaną pozycję (z dawną prędkością) ze świeżą godziną —
        // ta sama pozycja co odczyt sprzed minut to stary odczyt: czekamy na nowy.
        const replay = prevFix && pos.coords.latitude === prevFix.lat && pos.coords.longitude === prevFix.lon && pos.timestamp - prevFix.t > LIVE_RESUME_MAX_MS;
        if (replay) return;
        prevFix = { t: pos.timestamp, lat: pos.coords.latitude, lon: pos.coords.longitude };
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
        if (holdRef.current || fix.t - last < MIN_FIX_INTERVAL_MS) return;
        last = fix.t;
        setState((s) => applyFix(s, fix, DEVICE_ID, { lookup: lookup.current }));
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "weak"),
      { enableHighAccuracy: true, maximumAge: MIN_FIX_INTERVAL_MS, timeout: 30_000 },
    );
    // Po powrocie z tła w pamięci jest odczyt sprzed minut / godzin — nie pokazujemy go jako bieżącej prędkości
    // ani nie wysyłamy znajomym, tylko czekamy na nowy.
    const onVisible = () => document.visibilityState === "visible" && setLive((prev) => (prev && Date.now() - prev.t > LIVE_RESUME_MAX_MS ? null : prev));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      navigator.geolocation.clearWatch(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, setState]);

  useGapRoad(pendingGap ?? null, token, setState);
  useWakeLock(enabled);
  return { status, live };
}

/**
 * Odczyt po luce czeka (AppState.pendingGap) — pytamy serwer o drogę ciężarówki z ostatniej pozycji do obecnej
 * i liczymy lukę z nią; brak sieci / poza Polską → linia prosta (road: null).
 */
function useGapRoad(pending: AppState["pendingGap"], token: string | null, setState: Dispatch<SetStateAction<AppState>>) {
  const t = pending?.fix.t;
  useEffect(() => {
    if (!pending || !token) return;
    const { fix, from } = pending;
    let done = false;
    const finish = (road: GapRoad | null) => {
      if (done) return;
      done = true;
      setState((s) => (s.pendingGap?.fix.t === fix.t ? applyFix({ ...s, pendingGap: null }, fix, DEVICE_ID, { road }) : s));
    };
    api<{ road: GapRoad | null }>("POST", "/gps/gap", { from: [from.lat, from.lon], to: [fix.lat, fix.lon] }, token)
      .then((r) => finish(r.road))
      .catch(() => finish(null));
    const id = setTimeout(() => finish(null), GAP_WAIT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, token]);
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
