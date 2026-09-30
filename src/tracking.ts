// Śledzenie GPS w przeglądarce: odczyty z Geolocation API → licznik km i liczniki kierowcy.

import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { addFix, creditDriving, creditStop, Fix, GPS, startTrack } from "./core/gps";
import { AppState } from "./state";

export type GpsStatus = "off" | "waiting" | "ok" | "weak" | "denied" | "unavailable";

/** Częściej nie ma sensu — i tak przeliczamy cały plan przy każdym odczycie. */
const MIN_FIX_INTERVAL_MS = 5_000;

export function tripTotalKm(s: AppState) {
  return s.trip.profile === "custom" ? s.trip.segments.reduce((a, x) => a + x.km, 0) : s.trip.distance;
}

/** Nakłada odczyt GPS na stan: odlicza km od trasy, dolicza jazdę i zaliczone postoje. */
export function applyFix(s: AppState, fix: Fix): AppState {
  if (!s.track) return fix.accuracy <= GPS.maxAccuracyM ? { ...s, track: startTrack(fix) } : s;
  const r = addFix(s.track, fix);
  if (r.track === s.track) return s;
  let driver = s.driver;
  if (r.stopEnded) driver = creditStop(driver, r.stopEnded.start, r.stopEnded.end);
  driver = creditDriving(driver, r.driveMin);
  const doneKm = Math.min(tripTotalKm(s), s.trip.doneKm + r.km);
  return { ...s, track: r.track, driver, trip: doneKm === s.trip.doneKm ? s.trip : { ...s.trip, doneKm } };
}

export function useGpsTracking(enabled: boolean, setState: Dispatch<SetStateAction<AppState>>): GpsStatus {
  const [status, setStatus] = useState<GpsStatus>("off");

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
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
  return status;
}

/** Przy wygaszonym ekranie przeglądarka nie podaje pozycji — trzymamy ekran włączony, gdy się da. */
function useWakeLock(enabled: boolean) {
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
