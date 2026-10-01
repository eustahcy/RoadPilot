// Trasa jako lista odcinków o różnych prędkościach — nie „km / jedna średnia”.

export type RoadType = "motorway" | "expressway" | "rural" | "urban" | "mixed";

export interface Segment {
  type: RoadType;
  km: number;
  /** Prędkość ciężarówek zmierzona na tym odcinku (jazda kierowców RoadPilot) — nie wyższa niż ustawiona dla rodzaju drogi. */
  kmh?: number;
}

export type Speeds = Record<RoadType, number>;

export const ROAD_TYPES: RoadType[] = ["motorway", "expressway", "rural", "urban", "mixed"];

export const ROAD_LABELS: Record<RoadType, string> = {
  motorway: "Autostrada",
  expressway: "Droga ekspresowa",
  rural: "Poza terenem zabudowanym",
  urban: "Teren zabudowany",
  mixed: "Odcinek mieszany",
};

/** Realne średnie prędkości ciężarówki (km/h), nie limity z przepisów. */
export const DEFAULT_SPEEDS: Speeds = {
  motorway: 78,
  expressway: 74,
  rural: 62,
  urban: 32,
  mixed: 55,
};

export type ProfileId = "motorway" | "mixed" | "national" | "custom";

export const PROFILES: Record<Exclude<ProfileId, "custom">, { label: string; hint: string; shares: [RoadType, number][] }> = {
  motorway: {
    label: "Głównie autostrady",
    hint: "dojazd miastem, potem autostrada",
    shares: [["urban", 0.02], ["expressway", 0.05], ["motorway", 0.85], ["rural", 0.05], ["urban", 0.03]],
  },
  mixed: {
    label: "Trasa mieszana",
    hint: "autostrady, ekspresówki i krajówki",
    shares: [["urban", 0.03], ["rural", 0.12], ["motorway", 0.45], ["expressway", 0.2], ["rural", 0.15], ["urban", 0.05]],
  },
  national: {
    label: "Drogi krajowe",
    hint: "dużo przejazdów przez miejscowości",
    shares: [["urban", 0.05], ["rural", 0.35], ["mixed", 0.2], ["expressway", 0.1], ["rural", 0.22], ["urban", 0.08]],
  },
};

/** Rozkłada dystans na odcinki wg profilu. Suma odcinków == distance. */
export function segmentsFromProfile(distance: number, profile: Exclude<ProfileId, "custom">): Segment[] {
  const shares = PROFILES[profile].shares;
  const out: Segment[] = [];
  let used = 0;
  shares.forEach(([type, share], i) => {
    const km = i === shares.length - 1 ? round1(distance - used) : round1(distance * share);
    used = round1(used + km);
    if (km > 0) out.push({ type, km });
  });
  return out;
}

/** Odcinki pozostałe po przejechaniu `doneKm` od startu (np. licznik GPS). */
export function remainingSegments(segments: Segment[], doneKm: number): Segment[] {
  let skip = Math.max(0, doneKm);
  const out: Segment[] = [];
  for (const s of segments) {
    const km = Math.max(0, s.km - skip);
    skip = Math.max(0, skip - s.km);
    if (km > 0) out.push({ type: s.type, km: round1(km) });
  }
  return out;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Trasa z prędkościami efektywnymi (po doliczeniu zapasu na ruch).
 * Pozycje w km od startu, czasy w minutach.
 */
export class Route {
  readonly segments: Segment[];
  readonly totalKm: number;
  private readonly starts: number[];
  private readonly speeds: number[]; // km/min

  constructor(segments: Segment[], speeds: Speeds, trafficBufferPct = 0) {
    this.segments = segments.filter((s) => s.km > 0);
    const factor = 1 + Math.max(0, trafficBufferPct) / 100;
    let acc = 0;
    this.starts = this.segments.map((s) => {
      const start = acc;
      acc += s.km;
      return start;
    });
    this.totalKm = acc;
    this.speeds = this.segments.map((s) => Math.max(1, s.kmh !== undefined ? Math.min(s.kmh, speeds[s.type]) : speeds[s.type]) / factor / 60);
  }

  /** Czas jazdy (min) z pozycji fromKm do toKm. */
  driveMinutes(fromKm: number, toKm: number = this.totalKm): number {
    let minutes = 0;
    this.segments.forEach((s, i) => {
      const a = Math.max(fromKm, this.starts[i]);
      const b = Math.min(toKm, this.starts[i] + s.km);
      if (b > a) minutes += (b - a) / this.speeds[i];
    });
    return minutes;
  }

  /** Pozycja (km) po jeździe przez `minutes` od fromKm. */
  advance(fromKm: number, minutes: number): number {
    let km = fromKm;
    let left = minutes;
    for (let i = 0; i < this.segments.length && left > 1e-9; i++) {
      const end = this.starts[i] + this.segments[i].km;
      if (km >= end) continue;
      const need = (end - km) / this.speeds[i];
      if (need <= left) {
        left -= need;
        km = end;
      } else {
        km += left * this.speeds[i];
        left = 0;
      }
    }
    return Math.min(km, this.totalKm);
  }

  /** Typ drogi na danej pozycji. */
  roadAt(km: number): RoadType | undefined {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (km >= this.starts[i]) return this.segments[i].type;
    }
    return this.segments[0]?.type;
  }
}
