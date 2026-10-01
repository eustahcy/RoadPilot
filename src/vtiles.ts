// Własne kafelki wektorowe mapy (OSM, Polska): czy serwer je ma i jaki mają zasięg — poza nim mapa z kafelków TomTom.
// Jedno zapytanie na sesję, wspólne dla Nawigacji i mapy znajomego.

import { useEffect, useState } from "react";
import { api } from "./api";

export interface VtilesMeta {
  available: boolean;
  /** [minLon, minLat, maxLon, maxLat]. */
  bounds: number[];
}

let cached: Promise<VtilesMeta | null> | null = null;

export function useVtiles(token: string | null | undefined): VtilesMeta | null {
  const [meta, setMeta] = useState<VtilesMeta | null>(null);
  useEffect(() => {
    if (!token) return setMeta(null);
    cached ??= api<VtilesMeta>("GET", "/vtiles/meta", undefined, token).catch(() => {
      cached = null; // brak sieci — spróbujemy przy następnym otwarciu
      return null;
    });
    let alive = true;
    cached.then((m) => alive && setMeta(m));
    return () => {
      alive = false;
    };
  }, [token]);
  return meta;
}

/** Punkt w zasięgu własnych kafelków. */
export const inVtiles = (m: VtilesMeta | null, p: { lat: number; lon: number } | null | undefined) =>
  !!m?.available && !!p && p.lon >= m.bounds[0] && p.lat >= m.bounds[1] && p.lon <= m.bounds[2] && p.lat <= m.bounds[3];
