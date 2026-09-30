import { useEffect, useRef, useState } from "react";
import { fmtDuration, fmtKm } from "../format";
import { isAlert, jamMatters, jamTone, NavRoute } from "../nav";
import { routeSlice } from "../core/navmatch";
import { routeRefs } from "./HudView";
import { LatLon, MapView, worldPx } from "./MapView";

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
export function RouteCompare({ routes, selectedAt, token, onPick }: { routes: NavRoute[]; selectedAt: number | undefined; token: string; onPick: (r: NavRoute) => void }) {
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
  const view = fit(routes, size.w, size.h);
  const order = routes.map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.at === selectedAt) - Number(b.r.at === selectedAt));
  return (
    <div className="route-compare">
      <div className="route-compare-map" ref={box}>
        <MapView
          token={token}
          center={view.center}
          zoom={view.zoom}
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
                {sel?.traffic?.filter(jamMatters).map((t) => {
                  const pts = routeSlice(sel.points, t.km, Math.max(t.toKm, t.km + 0.3));
                  return pts.length > 1 ? <path key={t.km} className={`rc-jam ${jamTone(t)}`} d={d(pts)} /> : null;
                })}
              </>
            );
          }}
        />
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
                    {r.trafficMin >= 1 ? <span className="t-bad">korki +{fmtDuration(r.trafficMin)}{jams ? ` (${jams})` : ""}</span> : r.engine === "tomtom" ? <span className="t-ok">bez korków</span> : null}
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
