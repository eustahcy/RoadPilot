// Dane z internetu dla trybu HUD: stacje paliw (OpenStreetMap / Overpass API) i pogoda (Open-Meteo).
// Oba serwisy są darmowe i bez klucza. Pozycję zaokrąglamy do ~1 km, zanim wyjdzie z urządzenia;
// odległości do stacji liczymy lokalnie z dokładnej pozycji. Bez sieci HUD działa dalej, tylko bez tych danych.

import { useEffect, useRef, useState } from "react";
import { distanceM } from "./core/gps";
import { parseOverpass, Station, STATIONS } from "./core/stations";
import { Weather } from "./core/weather";

type LatLon = { lat: number; lon: number };

/** Publiczne serwery Overpass bywają przeciążone (504) — wtedy próbujemy następnego. */
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
/** Po błędzie (brak zasięgu) próbujemy ponownie najwcześniej po tylu ms. */
const RETRY_MS = 2 * 60_000;
const WEATHER_REFRESH_MS = 20 * 60_000;
const WEATHER_REFETCH_M = 20_000;

export interface Remote<T> {
  data?: T;
  loading: boolean;
  error: boolean;
}

/** Zaokrąglenie do 0,01° (~1 km) — tyle wystarczy do zapytania, reszta zostaje w telefonie. */
const coarse = (p: LatLon): LatLon => ({ lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 });

/**
 * Pobiera dane dla pozycji, gdy jeszcze ich nie ma, gdy przesunęliśmy się dalej niż `refetchM`
 * lub minął `maxAgeMs`. Po błędzie odczekuje RETRY_MS.
 */
function useRemote<T>(pos: LatLon | null, enabled: boolean, now: number, refetchM: number, maxAgeMs: number, load: (p: LatLon) => Promise<T>): Remote<T> {
  const [state, setState] = useState<Remote<T>>({ loading: false, error: false });
  const last = useRef<{ center: LatLon; at: number; ok: boolean } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled || !pos || busy.current) return;
    const l = last.current;
    if (l && distanceM(l.center, pos) < refetchM && now - l.at < (l.ok ? maxAgeMs : RETRY_MS)) return;
    const center = coarse(pos);
    last.current = { center, at: now, ok: false };
    busy.current = true;
    setState((s) => ({ ...s, loading: true }));
    load(center)
      .then((data) => {
        last.current = { center, at: now, ok: true };
        setState({ data, loading: false, error: false });
      })
      .catch(() => setState((s) => ({ ...s, loading: false, error: true })))
      .finally(() => {
        busy.current = false;
      });
    // pos jako obiekt zmienia się z każdym odczytem — wystarczą współrzędne
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pos?.lat, pos?.lon, now]);

  return state;
}

export function useStations(pos: LatLon | null, enabled: boolean, now: number): Remote<Station[]> {
  return useRemote(pos, enabled, now, STATIONS.refetchM, Infinity, fetchStations);
}

export function useWeather(pos: LatLon | null, enabled: boolean, now: number): Remote<Weather> {
  return useRemote(pos, enabled, now, WEATHER_REFETCH_M, WEATHER_REFRESH_MS, fetchWeather);
}

async function fetchStations(p: LatLon): Promise<Station[]> {
  const query = `[out:json][timeout:20];nwr["amenity"="fuel"](around:${STATIONS.radiusM},${p.lat},${p.lon});out center tags 300;`;
  let error: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return parseOverpass(await res.json());
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

async function fetchWeather(p: LatLon): Promise<Weather> {
  const url = `${WEATHER_URL}?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,is_day`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const c = (await res.json())?.current;
  if (typeof c?.temperature_2m !== "number") throw new Error("Open-Meteo: brak danych");
  return { tempC: c.temperature_2m, code: Number(c.weather_code) || 0, isDay: c.is_day !== 0 };
}
