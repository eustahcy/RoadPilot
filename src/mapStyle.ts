// Własny styl mapy HUD (kafelki wektorowe z OSM): paleta dzienna i nocna, szerokości dróg, zakazy dla pojazdu.
// Kolory RGBA 0–1 (WebGL). Dzień: tło pod brudną biel z lekką zielenią, drogi szare (decyzja użytkownika).

import { Vehicle } from "./nav";

export type MapTheme = "day" | "night";
export type RGBA = [number, number, number, number];

const hex = (h: string, a = 1): RGBA => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, a];

export type RoadClass = "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "minor" | "service";
export const ROAD_ORDER: RoadClass[] = ["service", "minor", "tertiary", "secondary", "primary", "trunk", "motorway"];

export interface MapPalette {
  ground: RGBA;
  /** Kolory CSS do nieba i mgły nad mapą. */
  sky: string;
  fog: string;
  landuse: Record<"wood" | "residential" | "industrial" | "grass", RGBA>;
  water: RGBA;
  waterway: RGBA;
  building: RGBA;
  railway: RGBA;
  road: Record<RoadClass, RGBA>;
  casing: RGBA;
  /** Zakaz wjazdu HGV: czerwono-białe kreski; ograniczenie liczbowe niespełnione: czerwony z białymi kropkami. */
  banA: RGBA;
  banB: RGBA;
  /** Tekst i tło etykiet (CSS). */
  labelText: string;
  labelHalo: string;
}

export const PALETTES: Record<MapTheme, MapPalette> = {
  day: {
    ground: hex("#eef0e6"),
    sky: "#dfe6ee",
    fog: "rgba(238, 240, 230, .85)",
    landuse: { wood: hex("#d9e6cf"), residential: hex("#e8e8e2"), industrial: hex("#e3e1dc"), grass: hex("#e4ecda") },
    water: hex("#b9d4ea"),
    waterway: hex("#b9d4ea"),
    building: hex("#dcdcd6"),
    railway: hex("#b8b8b8"),
    road: { motorway: hex("#8a8f96"), trunk: hex("#959aa1"), primary: hex("#a0a5ab"), secondary: hex("#adb2b8"), tertiary: hex("#bcc0c5"), minor: hex("#cdd0d4"), service: hex("#d8dbde") },
    casing: hex("#6e747b"),
    banA: hex("#e0312c"),
    banB: hex("#ffffff"),
    labelText: "#2b3138",
    labelHalo: "rgba(238, 240, 230, .9)",
  },
  night: {
    ground: hex("#141b23"),
    sky: "#0a1219",
    fog: "rgba(16, 30, 42, .9)",
    landuse: { wood: hex("#162420"), residential: hex("#1a222b"), industrial: hex("#1c2129"), grass: hex("#172320") },
    water: hex("#12283a"),
    waterway: hex("#12283a"),
    building: hex("#1f2831"),
    railway: hex("#3a4552"),
    road: { motorway: hex("#6f7d8c"), trunk: hex("#66737f"), primary: hex("#5b6874"), secondary: hex("#505c67"), tertiary: hex("#46515b"), minor: hex("#3c4650"), service: hex("#333c45") },
    casing: hex("#0d1319"),
    banA: hex("#e0312c"),
    banB: hex("#f4f4f4"),
    labelText: "#e6edf3",
    labelHalo: "rgba(10, 18, 25, .85)",
  },
};

/** Szerokość drogi w px ekranu (przed perspektywą) przy danym zoomie; rośnie ~1,5× na poziom od 14. */
const BASE_WIDTH: Record<RoadClass, number> = { motorway: 11, trunk: 9.5, primary: 8, secondary: 6.5, tertiary: 5, minor: 3.6, service: 2.2 };
export function roadWidth(cls: RoadClass, zoom: number): number {
  const w = BASE_WIDTH[cls] * 1.5 ** (zoom - 14);
  return Math.max(1, Math.min(w, 40));
}

/** Rodzaj zakazu dla pojazdu na drodze z atrybutami OSM — undefined = przejazd dozwolony. */
export type BanKind = "ban" | "limit";

const num = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]*)/i.exec(v.trim());
  if (!m) return null;
  let x = Number(m[1].replace(",", "."));
  const u = m[2].toLowerCase();
  if (u === "kg") x /= 1000;
  else if (u === "st") x *= 0.907;
  else if (u === "lbs") x *= 0.000454;
  else if (u === "ft") x *= 0.3048;
  return x;
};

export function roadBan(props: Record<string, unknown>, v: Vehicle): BanKind | undefined {
  const hgv = props.hgv;
  if (hgv === "no" || hgv === "destination" || hgv === "delivery") return "ban";
  const over = (k: string, mine: number) => { const lim = num(props[k]); return lim !== null && lim < mine; };
  if (over("maxheight", v.heightM) || over("maxweight", v.weightKg / 1000) || over("maxweightrating", v.weightKg / 1000) || over("maxaxleload", v.axleWeightKg / 1000) || over("maxwidth", v.widthM) || over("maxlength", v.lengthM)) return "limit";
  return undefined;
}

/** Miejsce dnia/nocy: z pogody (Open-Meteo isDay), a bez niej z zegara 7–19. */
export function autoTheme(isDay: boolean | undefined, now: number): MapTheme {
  if (isDay !== undefined) return isDay ? "day" : "night";
  const h = new Date(now).getHours();
  return h >= 7 && h < 19 ? "day" : "night";
}
