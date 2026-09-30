import { useEffect, useState } from "react";
import { api } from "../api";
import { REPORT_KINDS } from "../collect";
import { fromWorldPx, LatLon, MapView, worldPx } from "./MapView";

interface OsmItem { id: string; kind: string; value: number | null; raw: string; lat: number; lon: number; geom: [number, number][] | null; name: string; bridge: boolean }
interface ReportItem { id: number; kind: string; value: number | null; note: string; lat: number; lon: number; at: number; email: string }
interface MapData { osm: OsmItem[]; reports: ReportItem[]; traces: [number, number][] }

/** Warstwy OSM: rodzaj → podpis, kolor, jednostka. */
const LAYERS: { kind: string; label: string; color: string; unit?: string; on: boolean }[] = [
  { kind: "height", label: "Wysokość", color: "#ff5a5a", unit: "m", on: true },
  { kind: "weight", label: "Masa", color: "#ff9d2e", unit: "t", on: true },
  { kind: "hgv", label: "Zakaz TIR", color: "#c77dff", on: true },
  { kind: "axle", label: "Nacisk osi", color: "#e8d44c", unit: "t", on: false },
  { kind: "speed_hgv", label: "Prędkość TIR", color: "#4ea1ff", unit: "km/h", on: false },
  { kind: "width", label: "Szerokość", color: "#3fd0c9", unit: "m", on: false },
  { kind: "length", label: "Długość", color: "#3fd0c9", unit: "m", on: false },
];

interface CompareItem { id: number; kind: string; value: number | null; lat: number; lon: number; at: number; confirmations: number; drivers: number; status: "missing" | "match" | "diff" | "info"; osmId?: string; osmValue?: number | null; distM?: number }

const STATUS: Record<CompareItem["status"], string> = { missing: "Brak w OSM", diff: "Inna wartość w OSM", info: "Informacja", match: "Zgodne z OSM" };

/** Od tego zoomu pobieramy dane (dalej obszar byłby za duży). */
const MIN_DATA_ZOOM = 10;

/** Podgląd danych do mapy RoadPilot: ograniczenia z OSM, zgłoszenia kierowców, ślady przejazdów. */
export function AdminMap({ token }: { token: string }) {
  const [center, setCenter] = useState<LatLon>({ lat: 52.23, lon: 21.01 });
  const [zoom, setZoom] = useState(12);
  const [layers, setLayers] = useState(() => Object.fromEntries(LAYERS.map((l) => [l.kind, l.on])) as Record<string, boolean>);
  const [reports, setReports] = useState(true);
  const [traces, setTraces] = useState(true);
  const [data, setData] = useState<MapData>({ osm: [], reports: [], traces: [] });
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareItem[] | null>(null);
  useEffect(() => {
    api<{ items: CompareItem[] }>("GET", "/admin/compare", undefined, token).then((r) => setCompare(r.items)).catch(() => setCompare([]));
  }, [token]);

  // Dane widocznego obszaru — po chwili bez ruchu mapy.
  useEffect(() => {
    if (zoom < MIN_DATA_ZOOM) return setData({ osm: [], reports: [], traces: [] });
    const id = setTimeout(() => {
      const [cx, cy] = worldPx(center, zoom);
      const nw = fromWorldPx(cx - 700, cy - 500, zoom);
      const se = fromWorldPx(cx + 700, cy + 500, zoom);
      const q = new URLSearchParams({
        minLat: se.lat.toFixed(5), maxLat: nw.lat.toFixed(5), minLon: nw.lon.toFixed(5), maxLon: se.lon.toFixed(5),
        kinds: LAYERS.filter((l) => layers[l.kind]).map((l) => l.kind).join(","),
        reports: reports ? "1" : "0",
        traces: traces ? "1" : "0",
      });
      api<MapData>("GET", `/admin/map?${q}`, undefined, token).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
    }, 400);
    return () => clearTimeout(id);
  }, [center, zoom, layers, reports, traces, token]);

  const color = (k: string) => LAYERS.find((l) => l.kind === k)?.color ?? "#fff";
  const unit = (k: string) => LAYERS.find((l) => l.kind === k)?.unit ?? "";
  const reportLabel = (k: string) => REPORT_KINDS.find((r) => r.id === k)?.label ?? k;
  const sel = picked?.startsWith("o:") ? data.osm.find((o) => `o:${o.id}:${o.kind}` === picked) : undefined;
  const selR = picked?.startsWith("r:") ? data.reports.find((r) => `r:${r.id}` === picked) : undefined;

  return (
    <section className="card admin-map-card">
      <div className="eyebrow">Mapa danych · OpenStreetMap + RoadPilot</div>
      <div className="admin-layers">
        {LAYERS.map((l) => (
          <label key={l.kind} className={`admin-layer ${layers[l.kind] ? "on" : ""}`} style={{ "--c": l.color } as React.CSSProperties}>
            <input type="checkbox" checked={layers[l.kind]} onChange={(e) => setLayers({ ...layers, [l.kind]: e.target.checked })} />
            {l.label}
          </label>
        ))}
        <label className={`admin-layer ${reports ? "on" : ""}`} style={{ "--c": "#ffffff" } as React.CSSProperties}>
          <input type="checkbox" checked={reports} onChange={(e) => setReports(e.target.checked)} />Zgłoszenia
        </label>
        <label className={`admin-layer ${traces ? "on" : ""}`} style={{ "--c": "#44f07c" } as React.CSSProperties}>
          <input type="checkbox" checked={traces} onChange={(e) => setTraces(e.target.checked)} />Ślady
        </label>
      </div>
      <div className="admin-map">
        <MapView
          token={token}
          center={center}
          zoom={zoom}
          onMove={(c, z) => { setCenter(c); setZoom(z); }}
          overlay={(px) => (
            <>
              {data.traces.map(([lat, lon], i) => {
                const [x, y] = px({ lat, lon });
                return <circle key={`t${i}`} cx={x} cy={y} r="2.2" fill="#44f07c" opacity=".55" />;
              })}
              {data.osm.map((o) => {
                const key = `o:${o.id}:${o.kind}`;
                const [x, y] = px(o);
                const c = color(o.kind);
                return (
                  <g key={key} className="pick" onClick={() => setPicked(key)}>
                    {o.geom && o.geom.length > 1 && <path d={o.geom.map(([la, lo], i) => `${i ? "L" : "M"}${px({ lat: la, lon: lo }).join(" ")}`).join("")} stroke={c} strokeWidth={picked === key ? 7 : 4} fill="none" strokeLinecap="round" opacity=".9" />}
                    <circle cx={x} cy={y} r={picked === key ? 9 : 6} fill={c} stroke="#0b1218" strokeWidth="2" />
                    {zoom >= 14 && o.value !== null && <text x={x + 9} y={y + 4} className="admin-map-label">{String(o.value).replace(".", ",")}</text>}
                  </g>
                );
              })}
              {data.reports.map((r) => {
                const [x, y] = px(r);
                return (
                  <g key={`r${r.id}`} className="pick" onClick={() => setPicked(`r:${r.id}`)}>
                    <rect x={x - 8} y={y - 8} width="16" height="16" rx="3" fill="#fff" stroke="#0b1218" strokeWidth="2" transform={`rotate(45 ${x} ${y})`} />
                  </g>
                );
              })}
            </>
          )}
        >
          <div className="admin-map-zoom">
            <button onClick={() => setZoom((z) => Math.min(18, z + 1))} aria-label="Przybliż">+</button>
            <button onClick={() => setZoom((z) => Math.max(5, z - 1))} aria-label="Oddal">−</button>
          </div>
          {zoom < MIN_DATA_ZOOM && <div className="admin-map-hint">Przybliż mapę, żeby zobaczyć dane</div>}
        </MapView>
      </div>
      {error && <p className="auth-error">{error}</p>}
      {sel && (
        <p className="admin-map-info">
          <b style={{ color: color(sel.kind) }}>{LAYERS.find((l) => l.kind === sel.kind)?.label}</b>{" "}
          {sel.value !== null ? `${String(sel.value).replace(".", ",")} ${unit(sel.kind)}` : sel.raw}
          {sel.bridge ? " · most" : ""}{sel.name ? ` · ${sel.name}` : ""} ·{" "}
          <a href={`https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[sel.id[0]]}/${sel.id.slice(1)}`} target="_blank" rel="noreferrer">OSM {sel.id}</a>
        </p>
      )}
      {selR && (
        <p className="admin-map-info">
          <b>{reportLabel(selR.kind)}</b>{selR.value !== null ? ` ${String(selR.value).replace(".", ",")}` : ""} · {new Date(selR.at).toLocaleString("pl-PL")} · {selR.email}{selR.note ? ` · ${selR.note}` : ""}
        </p>
      )}
      <div className="admin-compare">
        <div className="eyebrow">Zgłoszenia a OpenStreetMap</div>
        {compare === null ? <p className="muted small">Wczytuję…</p> : compare.length === 0 ? <p className="muted small">Brak zgłoszeń od kierowców.</p> : (
          <ul>
            {compare.slice(0, 50).map((c) => (
              <li key={c.id}>
                <button onClick={() => { setCenter({ lat: c.lat, lon: c.lon }); setZoom(16); setReports(true); setPicked(`r:${c.id}`); }}>
                  <span className={`cmp-status ${c.status}`}>{STATUS[c.status]}</span>
                  <b>{reportLabel(c.kind)}{c.value !== null ? ` ${String(c.value).replace(".", ",")}` : ""}</b>
                  {c.status === "diff" && c.osmValue !== undefined && <span> · w OSM {c.osmValue === null ? "bez wartości" : String(c.osmValue).replace(".", ",")}</span>}
                  <small>
                    {c.confirmations > 1 ? `${c.confirmations} zgłoszenia od ${c.drivers} ${c.drivers === 1 ? "kierowcy" : "kierowców"} · ` : ""}
                    {new Date(c.at).toLocaleDateString("pl-PL")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">„Brak w OSM” i „Inna wartość” to kandydaci do poprawienia mapy RoadPilot (i OpenStreetMap). Stuknij, żeby pokazać na mapie.</p>
      </div>
      <p className="muted small">
        W widoku: {data.osm.length} ograniczeń OSM{data.osm.length >= 3000 ? " (pierwsze 3000 — przybliż)" : ""}, {data.reports.length} zgłoszeń, {data.traces.length} punktów śladu.
        Dane dróg © współtwórcy OpenStreetMap (ODbL), mapa © TomTom.
      </p>
    </section>
  );
}
