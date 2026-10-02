import { useEffect, useRef, useState } from "react";
import { fmtDuration, fmtKm } from "../format";
import { isAlert, jamMatters, jamTone, NavRoute, TRAFFIC_ON } from "../nav";
import { locate, routeSlice } from "../core/navmatch";
import { routeRefs } from "./HudView";
import { LatLon, MapView, MAX_VIEW_ZOOM, MIN_VIEW_ZOOM, moveView, useMapGestures, worldPx } from "./MapView";
import { GlLine, GlMapView, GlMarker, GlVector } from "./GlMap";
import { Vehicle } from "../nav";
import { inVtiles, useVtiles } from "../vtiles";

export const ROUTE_COLORS = ["#42d392", "#4ea1ff", "#e8b44c"];
const LETTERS = ["A", "B", "C"];

/** Zoom, przy którym wszystkie trasy mieszczą się w ramce w×h (z marginesem). */
function fit(routes: NavRoute[], w: number, h: number): { center: LatLon; zoom: number } {
  const all = routes.flatMap((r) => r.points);
  const lats = all.map((p) => p[0]);
  const lons = all.map((p) => p[1]);
  const min = { lat: Math.min(...lats), lon: Math.min(...lons) };
  const max = { lat: Math.max(...lats), lon: Math.max(...lons) };
  const [x0, y0] = worldPx({ lat: max.lat, lon: min.lon }, 0);
  const [x1, y1] = worldPx({ lat: min.lat, lon: max.lon }, 0);
  // Z boków miejsce na dymki tras („B · 8 h 30 min” ~ 150 px, na wąskiej mapie sama litera), u góry i na dole na start i metę.
  const zoom = Math.log2(Math.min((w < 420 ? w - 100 : Math.max(w * 0.4, w - 320)) / Math.max(1e-9, x1 - x0), (h - 70) / Math.max(1e-9, y1 - y0)));
  return { center: { lat: (min.lat + max.lat) / 2, lon: (min.lon + max.lon) / 2 }, zoom: Math.max(4, Math.min(15, zoom)) };
}

/** Mały pojazd do tła porównania: bez czerwonych zakazów — na mapie liczą się tylko trasy (ograniczenia są w zestawieniu). */
export const QUIET_VEHICLE: Vehicle = { heightM: 1, widthM: 1, lengthM: 2, weightKg: 1000, axleWeightKg: 500, axles: 2, adr: "none", maxKmh: 90 };

/**
 * Miejsce na dymek trasy: punkt najdalej od pozostałych tras (tam, gdzie warianty się rozchodzą), z dala od początku i końca,
 * i strona dymka: na zewnątrz — od strony, po której nie ma innej trasy. Odległość w przybliżeniu równoodległościowym.
 */
function callout(r: NavRoute, others: NavRoute[]): { at: LatLon; side: 1 | -1 } {
  const pts = thin(r.points);
  const other = others.flatMap((o) => thin(o.points).filter((_, i) => i % 3 === 0));
  const k = Math.cos((((pts[0]?.[0] ?? 52) * Math.PI) / 180));
  let best = pts[Math.floor(pts.length / 2)], bestD = -1, near: [number, number, number] | undefined;
  for (let i = Math.floor(pts.length * 0.15); i < pts.length * 0.85; i += 2) {
    const p = pts[i];
    let d = Infinity, n: [number, number, number] | undefined;
    for (const o of other) { const x = (o[0] - p[0]) ** 2 + ((o[1] - p[1]) * k) ** 2; if (x < d) { d = x; n = o; } }
    if (!other.length) d = 0;
    if (d > bestD) { bestD = d; best = p; near = n; }
  }
  return { at: { lat: best[0], lon: best[1] }, side: near && near[1] > best[1] ? -1 : 1 };
}

/** Co n-ty punkt — na podglądzie całej trasy wystarczy kilkaset. */
const thin = (pts: [number, number, number][]) => {
  const step = Math.max(1, Math.floor(pts.length / 400));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
};

/**
 * Porównanie tras: mapa z wszystkimi wariantami i zestawienie — czas (z korkami), różnica do najszybszej,
 * długość, korki, ograniczenia dla pojazdu, fotoradary. Dotknięcie wybiera trasę.
 */
const rgba = (hex: string, a = 1): [number, number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, a];
const JAM_COLOR = { slow: "#f2c230", jam: "#e8322c", closed: "#8a1010" } as const;

export function RouteCompare({ routes, selectedAt, token, onPick, mapStyle }: { routes: NavRoute[]; selectedAt: number | undefined; token: string; onPick: (r: NavRoute) => void; /** Styl własnej mapy — w jej zasięgu zamiast kafelków TomTom. */ mapStyle?: GlVector }) {
  const fastest = Math.min(...routes.map((r) => r.travelMin));
  // Dopasowanie do faktycznego rozmiaru ramki (w HUD jest szersza niż na karcie).
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 340, h: 200 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.clientWidth && setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Widok przesunięty / przybliżony palcem; null = dopasowany do wszystkich tras (też po nowym wyznaczeniu).
  const [manual, setManual] = useState<{ center: LatLon; zoom: number } | null>(null);
  const routesKey = routes.map((r) => r.at).join(",");
  useEffect(() => setManual(null), [routesKey]);
  const view = manual ?? fit(routes, size.w, size.h);
  const zoomBy = (d: number) => setManual({ center: view.center, zoom: Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, view.zoom + d)) });
  const order = routes.map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.at === selectedAt) - Number(b.r.at === selectedAt));
  // Własna mapa, gdy start i cel każdej trasy są w zasięgu kafelków (Polska).
  const vtiles = useVtiles(token);
  const own = !!mapStyle && routes.every((r) => inVtiles(vtiles, r.from) && inVtiles(vtiles, r.to));
  const pickRef = useRef<((x: number, y: number) => LatLon | undefined) | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const gestures = useMapGestures(
    (g) => {
      const [center, zoom] = moveView(viewRef.current, g, { w: size.w, h: size.h });
      setManual({ center, zoom });
    },
    undefined,
    {
      // Dotknięcie linii wybiera trasę: najbliższa w promieniu ~24 px ekranu.
      onTap: (x, y) => {
        const p = pickRef.current?.(x, y);
        if (!p) return;
        const mPerPx = (40_075_000 * Math.cos((p.lat * Math.PI) / 180)) / (512 * 2 ** viewRef.current.zoom);
        const best = routes.map((r) => ({ r, d: locate(r.points, p)?.offM ?? Infinity })).sort((a, b) => a.d - b.d)[0];
        if (best && best.d <= 24 * mPerPx) onPick(best.r);
      },
    },
  );
  const glLines = (): GlLine[] => {
    const sel = routes.find((r) => r.at === selectedAt);
    const out: GlLine[] = [];
    for (const { r, i } of order) {
      const pts = thin(r.points).map((p) => ({ lat: p[0], lon: p[1] }));
      const on = r.at === selectedAt;
      out.push({ pts, color: rgba("#04080c", on ? 0.95 : 0.7), widthPx: on ? 15 : 10 }, { pts, color: rgba(ROUTE_COLORS[i], on ? 1 : 0.6), widthPx: on ? 9 : 6 });
    }
    for (const t of TRAFFIC_ON ? sel?.traffic?.filter(jamMatters) ?? [] : []) {
      const pts = routeSlice(sel!.points, t.km, Math.max(t.toKm, t.km + 0.3));
      if (pts.length > 1) out.push({ pts, color: rgba(JAM_COLOR[jamTone(t)]), widthPx: 5 });
    }
    return out;
  };
  // Dymki na mapie: litera i czas przy każdej trasie (tam, gdzie się rozchodzą), start i meta.
  const glMarkers = (): GlMarker[] => {
    const out: GlMarker[] = routes.map((r, i) => {
      const { at, side } = callout(r, routes.filter((o) => o !== r));
      const on = r.at === selectedAt;
      // Wąska mapa (telefon pionowo): sama litera — czas jest na kartach pod mapą.
      const text = size.w < 420 ? LETTERS[i] : `${LETTERS[i]} · ${fmtDuration(r.travelMin)}`;
      const w = Math.max(30, text.length * 8.4 + 22);
      return {
        key: `rc${r.at}`, ...at,
        // Dymek obok linii, po stronie bez innej trasy (A i B rozchodzą się na boki — dymki nie nachodzą na siebie).
        node: (
          <g className={`rc-callout ${on ? "on" : ""}`}>
            <rect x={side > 0 ? 12 : -12 - w} y={-14} width={w} height={28} rx={14} fill={ROUTE_COLORS[i]} />
            <path d={side > 0 ? "M2 0 14 -7v14z" : "M-2 0-14 -7v14z"} fill={ROUTE_COLORS[i]} />
            <text x={side * (12 + w / 2)} y={5}>{text}</text>
          </g>
        ),
      };
    });
    const r0 = routes[0];
    if (r0) {
      out.unshift(
        { key: "rc-start", lat: r0.from.lat, lon: r0.from.lon, node: <circle className="rc-start" r={7} /> },
        { key: "rc-end", lat: r0.to.lat, lon: r0.to.lon, node: <g className="rc-end"><circle r={10} /><path d="M-3.5 5V-6M-3.5-6h7.5l-2 2.5 2 2.5h-7.5" /></g> },
      );
    }
    return out;
  };
  const zoomButtons = (
    <>
      <div className="map-zoom">
        <button onClick={() => zoomBy(1)} aria-label="Przybliż">+</button>
        <button onClick={() => zoomBy(-1)} aria-label="Oddal">−</button>
      </div>
      {manual && <button className="map-fit" onClick={() => setManual(null)}>Cała trasa</button>}
    </>
  );
  return (
    <div className="route-compare">
      <div className="route-compare-map" ref={box}>
        {own ? (
          <>
            <div className="rc-gl" {...gestures}>
              <GlMapView token={token} center={view.center} zoom={view.zoom} lines={glLines()} markers={glMarkers()} vector={mapStyle && { ...mapStyle, vehicle: QUIET_VEHICLE, quiet: true }} pickRef={pickRef} />
            </div>
            {zoomButtons}
          </>
        ) : (
        <>
        <MapView
          token={token}
          center={view.center}
          zoom={view.zoom}
          onMove={(center, zoom) => setManual({ center, zoom })}
          overlay={(px) => {
            const d = (pts: { lat: number; lon: number }[]) => pts.map((p, k) => `${k ? "L" : "M"}${px(p).map((v) => v.toFixed(1)).join(" ")}`).join("");
            const sel = routes.find((r) => r.at === selectedAt);
            return (
              <>
                {order.map(({ r, i }) => (
                  <path
                    key={r.at}
                    className={`rc-line ${r.at === selectedAt ? "on" : ""}`}
                    stroke={ROUTE_COLORS[i]}
                    d={d(thin(r.points).map((p) => ({ lat: p[0], lon: p[1] })))}
                    onClick={() => onPick(r)}
                  />
                ))}
                {/* Utrudnienia na wybranej trasie: żółty wolniej, czerwony korek. */}
                {TRAFFIC_ON && sel?.traffic?.filter(jamMatters).map((t) => {
                  const pts = routeSlice(sel.points, t.km, Math.max(t.toKm, t.km + 0.3));
                  return pts.length > 1 ? <path key={t.km} className={`rc-jam ${jamTone(t)}`} d={d(pts)} /> : null;
                })}
              </>
            );
          }}
        />
        {zoomButtons}
        </>
        )}
      </div>
      <ul className="rc-list">
        {routes.map((r, i) => {
          const restrictions = r.warnings?.filter((w) => !isAlert(w)).length;
          const cams = r.warnings?.filter((w) => w.kind === "camera" || w.kind === "section" || w.kind === "red_light").length ?? 0;
          const jams = r.traffic?.filter((t) => jamTone(t) !== "slow").length ?? 0;
          const diff = r.travelMin - fastest;
          const on = r.at === selectedAt;
          return (
            <li key={r.at}>
              <button className={`rc-item ${on ? "on" : ""}`} onClick={() => onPick(r)} aria-pressed={on} style={{ "--rc": ROUTE_COLORS[i] } as React.CSSProperties}>
                <i>{LETTERS[i]}</i>
                <span className="rc-main">
                  <b>{fmtDuration(r.travelMin)}{diff >= 1 ? <em> +{fmtDuration(diff)}</em> : <em className="best"> najszybsza</em>}</b>
                  <small>{fmtKm(r.lengthKm)} · {routeRefs(r.instructions) || "—"}</small>
                  <span className="rc-tags">
                    {!TRAFFIC_ON ? null : r.trafficMin >= 1 ? <span className="t-bad">korki +{fmtDuration(r.trafficMin)}{jams ? ` (${jams})` : ""}</span> : r.engine === "tomtom" ? <span className="t-ok">bez korków</span> : null}
                    {restrictions === undefined ? null : restrictions ? <span className="t-bad">ograniczenia: {restrictions}</span> : <span className="t-ok">bez ograniczeń</span>}
                    {cams > 0 && <span>fotoradary: {cams}</span>}
                  </span>
                </span>
                <span className="rc-pick" aria-hidden>{on ? "✓" : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
