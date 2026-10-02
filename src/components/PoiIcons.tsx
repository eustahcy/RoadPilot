// Piktogramy miejsc przy trasie (pasek „po drodze”, lista, pinezki): dystrybutor, bramki, MOP ze stacją.
// Rysowane w układzie -12…12 (środek w 0,0); `cut` = kolor tła, którym „wycinamy” okienka.

import type { RoutePoi } from "../nav";

/** Dystrybutor: korpus z okienkiem, podstawa i wąż z pistoletem po prawej. */
export function FuelGlyph({ cut, scale = 1 }: { cut: string; scale?: number }) {
  return (
    <g transform={`scale(${scale})`}>
      <path d="M-7.5 8.5V-6.5a2.5 2.5 0 0 1 2.5-2.5h7a2.5 2.5 0 0 1 2.5 2.5v15z" fill="#fff" />
      <rect x="-5.2" y="-6.6" width="7.4" height="5" rx="1.2" fill={cut} />
      <rect x="-9" y="8" width="15.5" height="2.6" rx="1.3" fill="#fff" />
      <path d="M4.5 -2.5h1.6a1.6 1.6 0 0 1 1.6 1.6v5.6a1.7 1.7 0 0 0 3.4 0V-4.2l-2.6-3" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** Bramki: budka poboru z okienkiem i opuszczony szlaban w czerwone pasy. */
export function TollGlyph({ cut, scale = 1 }: { cut: string; scale?: number }) {
  return (
    <g transform={`scale(${scale})`}>
      <path d="M-10.5 -4.5 -8.5 -8h6l2 3.5z" fill="#fff" />
      <rect x="-10" y="-4" width="8" height="13.5" rx="1.2" fill="#fff" />
      <rect x="-8.4" y="-2.2" width="4.8" height="3.6" rx=".8" fill={cut} />
      <rect x="-2.5" y="-0.6" width="13" height="3.6" rx="1.8" fill="#fff" />
      <path d="M1 -0.6v3.6M5 -0.6v3.6M9 -0.6v3.6" stroke="#e8322c" strokeWidth="1.8" />
    </g>
  );
}

/** Litera (P / M) wyśrodkowana w znaku. */
export function LetterGlyph({ letter, size = 17 }: { letter: string; size?: number }) {
  return <text x="0" y={size * 0.36} textAnchor="middle" fontSize={size} fontWeight="900" fill="#fff" fontFamily="Inter, system-ui, sans-serif">{letter}</text>;
}

/** Plakietka „ze stacją” w rogu znaku MOP-u: pomarańczowe kółko z dystrybutorem. */
export function FuelBadge({ x = 10, y = -10, r = 6.5 }: { x?: number; y?: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="#e07a1f" stroke="#fff" strokeWidth="1.6" />
      <FuelGlyph cut="#e07a1f" scale={(r * 0.85) / 11} />
    </g>
  );
}

export const POI_COLOR: Record<RoutePoi["kind"], string> = { fuel: "#e07a1f", toll: "#6d4bd1", services: "#2f6fd6", mop: "#2f6fd6", parking: "#2f6fd6" };

/**
 * Stacja przy MOP-ie to jedno miejsce: stacja (fuel) po tej samej stronie ≤ MERGE_KM od MOP-u robi z niego „MOP ze stacją”
 * (services) z marką stacji, a sama znika z listy — bez podwójnych wpisów na pasku i pinezek obok siebie.
 */
const MERGE_KM = 0.6;
export function mergeStations<T extends Pick<RoutePoi, "kind" | "km" | "side" | "name"> & { brand?: string }>(pois: T[]): T[] {
  const drop = new Set<T>();
  const out = pois.map((p) => ({ ...p }));
  for (const f of out) {
    if (f.kind !== "fuel") continue;
    const m = out.find((x) => (x.kind === "mop" || x.kind === "services") && x.side === f.side && Math.abs(x.km - f.km) <= MERGE_KM);
    if (!m) continue;
    m.kind = "services" as T["kind"];
    if (!m.brand && f.name) m.brand = f.name;
    drop.add(f);
  }
  return out.filter((p) => !drop.has(p));
}
