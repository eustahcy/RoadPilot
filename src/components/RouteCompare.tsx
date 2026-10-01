import { useEffect, useRef, useState } from "react";
import { fmtDuration, fmtKm } from "../format";
import { isAlert, jamMatters, jamTone, NavRoute, TRAFFIC_ON } from "../nav";
import { locate, routeSlice } from "../core/navmatch";
import { routeRefs } from "./HudView";
import { LatLon, MapView, MAX_VIEW_ZOOM, MIN_VIEW_ZOOM, moveView, useMapGestures, worldPx } from "./MapView";
import { GlLine, GlMapView, GlVector } from "./GlMap";
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
  const zoom = Math.log2(Math.min((w * 0.82) / Math.max(1e-9, x1 - x0), (h * 0.8) / Math.max(1e-9, y1 - y0)));
  return { center: { lat: (min.lat + max.lat) / 2, lon: (min.lon + max.lon) / 2 }, zoom: Math.max(4, Math.min(15, zoom)) };
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
      out.push({ pts, color: rgba("#08111a", on ? 0.9 : 0.6), widthPx: on ? 11 : 8 }, { pts, color: rgba(ROUTE_COLORS[i], on ? 1 : 0.75), widthPx: on ? 7 : 5 });
    }
    for (const t of TRAFFIC_ON ? sel?.traffic?.filter(jamMatters) ?? [] : []) {
      const pts = routeSlice(sel!.points, t.km, Math.max(t.toKm, t.km + 0.3));
      if (pts.length > 1) out.push({ pts, color: rgba(JAM_COLOR[jamTone(t)]), widthPx: 5 });
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
              <GlMapView token={token} center={view.center} zoom={view.zoom} lines={glLines()} markers={[]} vector={mapStyle} pickRef={pickRef} />
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
              <button className={`rc-item ${on ? "on" : ""}`} onClick={() => onPick(r)} aria-pressed={on}>
                <i style={{ background: ROUTE_COLORS[i] }}>{LETTERS[i]}</i>
                <span className="rc-main">
                  <b>{fmtDuration(r.travelMin)}{diff >= 1 ? <em> +{fmtDuration(diff)}</em> : <em className="best"> najszybsza</em>}</b>
                  <small>{fmtKm(r.lengthKm)} · {routeRefs(r.instructions) || "—"}</small>
                  <span className="rc-tags">
                    {!TRAFFIC_ON ? null : r.trafficMin >= 1 ? <span className="t-bad">korki +{fmtDuration(r.trafficMin)}{jams ? ` (${jams})` : ""}</span> : r.engine === "tomtom" ? <span className="t-ok">bez korków</span> : null}
                    {restrictions === undefined ? null : restrictions ? <span className="t-bad">ograniczenia: {restrictions}</span> : <span className="t-ok">bez ograniczeń</span>}
                    {cams > 0 && <span>fotoradary: {cams}</span>}
                  </span>
                </span>
                <span className="rc-pick">{on ? "✓" : "Wybierz"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
