// Kafelek wektorowy → geometria WebGL dla własnego stylu mapy. Jeden bufor na kafelek: [x, y, nx, ny, d] na
// wierzchołek (pozycja w px poziomu kafelka, normalna do rozciągania linii w shaderze, długość wzdłuż linii do kresek).
// Partie (batches) to zakresy w buforze z kluczem stylu — GlMap rysuje je w kolejności warstw.

import { MvtLayer } from "../core/mvt";
import { BanKind, roadBan, RoadClass } from "../mapStyle";
import { Vehicle } from "../nav";
import { TILE } from "./MapView";

export interface VBatch {
  key: string;
  start: number;
  count: number;
}

export interface VLabel {
  x: number;
  y: number;
  text: string;
  kind: "city" | "town" | "village" | "hamlet" | "ref" | "street" | "limit";
  /** Nazwa ulicy: kąt drogi w px kafelka (stopnie, 0 = w prawo) — etykieta leży wzdłuż drogi. */
  angle?: number;
}

/** Tekst znaku: najbardziej dotkliwe ograniczenie dla zestawu (masa, nacisk osi, wysokość, szerokość, długość); null = zakaz TIR. */
function limitText(p: Record<string, unknown>, v: Vehicle): string | null {
  const n = (k: string) => { const x = parseFloat(String(p[k] ?? "").replace(",", ".")); return Number.isFinite(x) ? x : null; };
  const f = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
  const checks: [string, number, (x: number) => string][] = [
    ["maxweight", v.weightKg / 1000, (x) => `${f(x)}t`],
    ["maxweightrating", v.weightKg / 1000, (x) => `${f(x)}t`],
    ["maxaxleload", v.axleWeightKg / 1000, (x) => `${f(x)}t/oś`],
    ["maxheight", v.heightM, (x) => `${f(x)}m`],
    ["maxwidth", v.widthM, (x) => `↔${f(x)}m`],
    ["maxlength", v.lengthM, (x) => `${f(x)}m dł.`],
  ];
  for (const [k, mine, fmt] of checks) { const x = n(k); if (x !== null && x < mine) return fmt(x); }
  return null;
}

export interface VTileGeometry {
  data: Float32Array;
  batches: VBatch[];
  labels: VLabel[];
}

const STRIDE = 5;

class Builder {
  out: number[] = [];
  batches = new Map<string, number[]>();
  private cur: number[] | null = null;
  begin(key: string) {
    if (!this.batches.has(key)) this.batches.set(key, []);
    this.cur = this.batches.get(key)!;
  }
  /** Wierzchołek do bieżącej partii — partie zbieramy osobno i sklejamy na końcu, żeby zakresy były ciągłe. */
  v(x: number, y: number, nx = 0, ny = 0, d = 0) {
    this.cur!.push(x, y, nx, ny, d);
  }
  finish(): { data: Float32Array; batches: VBatch[] } {
    const batches: VBatch[] = [];
    let total = 0;
    for (const arr of this.batches.values()) total += arr.length;
    const data = new Float32Array(total);
    let off = 0;
    for (const [key, arr] of this.batches) {
      data.set(arr, off);
      batches.push({ key, start: off / STRIDE, count: arr.length / STRIDE });
      off += arr.length;
    }
    return { data, batches };
  }
}

/** Linia (px) → prostokąty na odcinkach i koła na złączeniach; szerokość nadaje shader (normalna × u_hw). */
function line(b: Builder, pts: number[]) {
  let d = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const nx = -dy / len, ny = dx / len;
    const d1 = d + len;
    b.v(x0, y0, nx, ny, d); b.v(x0, y0, -nx, -ny, d); b.v(x1, y1, nx, ny, d1);
    b.v(x1, y1, nx, ny, d1); b.v(x0, y0, -nx, -ny, d); b.v(x1, y1, -nx, -ny, d1);
    if (i + 2 < pts.length) {
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
        b.v(x1, y1, 0, 0, d1); b.v(x1, y1, Math.cos(a0), Math.sin(a0), d1); b.v(x1, y1, Math.cos(a1), Math.sin(a1), d1);
      }
    }
    d = d1;
  }
}

/**
 * Wielokąt → wachlarz trójkątów od pierwszego wierzchołka. GlMap rysuje wachlarze do bufora szablonu (parzystość),
 * a potem wypełnia kafelek kolorem tam, gdzie szablon = 1 — dowolne wklęsłości i dziury bez triangulacji.
 */
function fill(b: Builder, ring: number[]) {
  const n = ring.length / 2;
  for (let i = 1; i < n - 1; i++) {
    b.v(ring[0], ring[1]);
    b.v(ring[2 * i], ring[2 * i + 1]);
    b.v(ring[2 * i + 2], ring[2 * i + 3]);
  }
}

const ROAD_CLASSES = new Set<string>(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]);

/** Geometria kafelka z warstw MVT; współrzędne w px poziomu kafelka (0…TILE). `vehicle` decyduje, które drogi to zakazy. */
export function buildVectorTile(layers: MvtLayer[], vehicle: Vehicle): VTileGeometry {
  const b = new Builder();
  const labels: VLabel[] = [];
  const byName = new Map(layers.map((l) => [l.name, l]));
  const px = (l: MvtLayer, g: number[]) => g.map((v) => (v / l.extent) * TILE);

  for (const cls of ["wood", "grass", "residential", "industrial"]) {
    const l = byName.get("landuse");
    if (!l) break;
    b.begin(`landuse:${cls}`);
    for (const f of l.features) if (f.type === 3 && f.props.class === cls) for (const ring of f.geom) fill(b, px(l, ring));
  }
  const water = byName.get("water");
  if (water) {
    b.begin("water");
    for (const f of water.features) if (f.type === 3) for (const ring of f.geom) fill(b, px(water, ring));
  }
  const building = byName.get("building");
  if (building) {
    b.begin("building");
    for (const f of building.features) if (f.type === 3) for (const ring of f.geom) fill(b, px(building, ring));
  }
  const waterway = byName.get("waterway");
  if (waterway) {
    b.begin("waterway");
    for (const f of waterway.features) if (f.type === 2) for (const g of f.geom) line(b, px(waterway, g));
  }
  const railway = byName.get("railway");
  if (railway) {
    b.begin("railway");
    for (const f of railway.features) if (f.type === 2) for (const g of f.geom) line(b, px(railway, g));
  }
  const road = byName.get("road");
  const streets: { len: number; label: VLabel }[] = [];
  const limits: VLabel[] = [];
  if (road) {
    for (const f of road.features) {
      if (f.type !== 2) continue;
      const cls = String(f.props.class) as RoadClass;
      if (!ROAD_CLASSES.has(cls)) continue;
      const ban: BanKind | undefined = roadBan(f.props, vehicle);
      // Zakaz rysujemy zamiast zwykłej nawierzchni (obrys zostaje w klasie drogi).
      b.begin(`casing:${cls}`);
      for (const g of f.geom) line(b, px(road, g));
      b.begin(ban ? `ban:${ban}:${cls}` : `road:${cls}`);
      for (const g of f.geom) line(b, px(road, g));
      // Najdłuższy kawałek w kafelku: środek i kąt odcinka — dla numeru drogi (prosto) albo nazwy ulicy (wzdłuż).
      let best: number[] | null = null;
      for (const g of f.geom) if (!best || g.length > best.length) best = g;
      if (!best || best.length < 4) continue;
      const pts = px(road, best);
      let total = 0;
      for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      // Punkt w połowie długości i kąt odcinka, na którym leży.
      let acc = 0, mx = pts[0], my = pts[1], angle = 0;
      for (let i = 2; i < pts.length; i += 2) {
        const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        if (acc + seg >= total / 2) {
          const t = seg ? (total / 2 - acc) / seg : 0;
          mx = pts[i - 2] + (pts[i] - pts[i - 2]) * t;
          my = pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t;
          angle = (Math.atan2(pts[i + 1] - pts[i - 1], pts[i] - pts[i - 2]) * 180) / Math.PI;
          break;
        }
        acc += seg;
      }
      // Ograniczenie, które dotyczy naszego zestawu — znak z wartością („10t”, „3,5m”) albo przekreślona ciężarówka przy drodze.
      if (ban) limits.push({ x: mx, y: my, text: limitText(f.props, vehicle) ?? "TIR", kind: "limit" });
      const ref = f.props.ref;
      if (typeof ref === "string" && (cls === "motorway" || cls === "trunk" || cls === "primary" || cls === "secondary")) {
        labels.push({ x: mx, y: my, text: ref.split(";")[0], kind: "ref" });
      } else if (typeof f.props.name === "string" && cls !== "service" && total > 40) {
        streets.push({ len: total, label: { x: mx, y: my, text: f.props.name, kind: "street", angle } });
      }
    }
  }
  // Znaki ograniczeń: najwyżej 12 na kafelek, ten sam znak nie częściej niż co ~60 px kafelka.
  for (const l of limits) {
    if (labels.filter((x) => x.kind === "limit").length >= 12) break;
    if (labels.some((x) => x.kind === "limit" && x.text === l.text && Math.hypot(x.x - l.x, x.y - l.y) < 60)) continue;
    labels.push(l);
  }
  // Nazwy ulic: najdłuższe w kafelku, bez powtórzeń, najwyżej 14 na kafelek.
  const seen = new Set<string>();
  for (const s of streets.sort((a, b) => b.len - a.len)) {
    if (seen.has(s.label.text) || seen.size >= 14) continue;
    seen.add(s.label.text);
    labels.push(s.label);
  }
  const place = byName.get("place");
  if (place) {
    for (const f of place.features) {
      if (f.type !== 1 || typeof f.props.name !== "string") continue;
      const kind = String(f.props.class) as VLabel["kind"];
      const p = px(place, f.geom[0]);
      labels.push({ x: p[0], y: p[1], text: f.props.name, kind });
    }
  }
  return { ...b.finish(), labels };
}

export const V_STRIDE = STRIDE;
