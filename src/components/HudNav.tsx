import { useEffect, useRef } from "react";
import { Live } from "../core/gps";
import { bearingAtKm, isOffRoute, lanesAhead, locate, NAV, NavInstruction, nextInstruction, pointAtKm, RoutePos, routeSlice, speedLimitAt } from "../core/navmatch";
import { isAhead, jamMatters, jamTone, NavPlace, NavRoute, TrafficSection, warningText } from "../nav";
import { MapView } from "./MapView";
import { Friend, STATUS_LABEL } from "../core/friends";
import { fmtDuration } from "../core/scenarios";
import { distanceM } from "../core/gps";

/** Nawigacja w HUD: trasa (może jej nie być w tym urządzeniu — wtedy cel z konta) i wyznaczanie od bieżącej pozycji. */
export interface HudNavData {
  route: NavRoute | null;
  dest: NavPlace | null;
  rerouting: boolean;
  onReroute: () => void;
  /** Otwiera wyszukiwarkę celu i porównanie tras w HUD (gdy jest). */
  onPlan?: () => void;
}

export interface NavTrack {
  pos?: RoutePos;
  off: boolean;
}

/**
 * Pozycja na trasie z GPS (z podpowiedzią z poprzedniego odczytu) i pilnowanie trasy: poza nią przez
 * NAV.rerouteAfterMs → nowa trasa, nie częściej niż NAV.rerouteEveryMs.
 */
export function useNavTrack(nav: HudNavData, live: Live | null, accuracyM = 20): NavTrack {
  const hint = useRef<number | undefined>(undefined);
  const offSince = useRef<number | null>(null);
  const lastReroute = useRef(0);
  const route = nav.route;

  let pos: RoutePos | undefined;
  if (route && live) {
    pos = locate(route.points, live, hint.current);
    // Zgubiona podpowiedź (np. po postoju w innym miejscu) — szukamy po całej trasie.
    if (!pos || isOffRoute(pos, accuracyM)) {
      const all = locate(route.points, live);
      if (all && (!pos || all.offM < pos.offM)) pos = all;
    }
  }
  const off = pos ? isOffRoute(pos, accuracyM) : false;

  useEffect(() => {
    if (pos && !off) hint.current = pos.idx;
    const now = live?.t ?? Date.now();
    // Brak trasy w tym urządzeniu, a jest cel i pozycja — wyznaczamy od razu (raz na NAV.rerouteEveryMs).
    const missing = !route && nav.dest && live;
    if (!off && !missing) {
      offSince.current = null;
      return;
    }
    offSince.current ??= now;
    const wait = missing ? 0 : NAV.rerouteAfterMs;
    if (!nav.rerouting && now - offSince.current >= wait && Date.now() - lastReroute.current >= NAV.rerouteEveryMs) {
      lastReroute.current = Date.now();
      nav.onReroute();
    }
  });

  return { pos, off };
}

/** Od tylu km przed miejscem z ograniczeniem pokazujemy ostrzeżenie. */
const WARN_AHEAD_KM = 3;
/** Od tylu km przed korkiem pokazujemy go na karcie. */
const TRAFFIC_AHEAD_KM = 8;
/** Nazwa utrudnienia na karcie: korek / wolniejszy ruch / roboty / zamknięcie. */
function jamText(t: TrafficSection) {
  const tone = jamTone(t);
  if (tone === "closed") return "Droga zamknięta";
  if (t.cause === "roadwork") return "Roboty drogowe";
  return tone === "jam" ? "Korek" : "Wolniejszy ruch";
}

/** „+10 min” na mapie przy utrudnieniu. */
export const delayLabel = (t: TrafficSection) => (jamTone(t) === "closed" ? "zamknięte" : `+${Math.max(1, Math.round(t.delayMin))} min`);

/** Kąt strzałki (stopnie, 0 = prosto, + w prawo) dla manewru TomTom. */
const ANGLES: Record<string, number> = {
  STRAIGHT: 0, FOLLOW: 0, SWITCH_MAIN_ROAD: 0, SWITCH_PARALLEL_ROAD: 0, ENTER_MOTORWAY: 0, ENTER_FREEWAY: 0, ENTER_HIGHWAY: 0, ENTRANCE_RAMP: 0,
  KEEP_RIGHT: 25, BEAR_RIGHT: 40, TURN_RIGHT: 90, SHARP_RIGHT: 135, MOTORWAY_EXIT_RIGHT: 35, TAKE_EXIT: 35, ARRIVE_RIGHT: 60, WAYPOINT_RIGHT: 60,
  KEEP_LEFT: -25, BEAR_LEFT: -40, TURN_LEFT: -90, SHARP_LEFT: -135, MOTORWAY_EXIT_LEFT: -35, ARRIVE_LEFT: -60, WAYPOINT_LEFT: -60,
  MAKE_UTURN: 180, TRY_MAKE_UTURN: 180, ROUNDABOUT_BACK: 180,
};

const LANE_ANGLES: Record<string, number> = {
  STRAIGHT: 0, SLIGHT_RIGHT: 40, RIGHT: 90, SHARP_RIGHT: 135, SLIGHT_LEFT: -40, LEFT: -90, SHARP_LEFT: -135, U_TURN: 180,
};

/** Strzałka: pionowy trzon z dołu, łuk w stronę manewru i grot. */
function arrowPath(deg: number) {
  if (Math.abs(deg) >= 170) return "M8 21V10a4 4 0 0 1 8 0v7M13 14l3 3 3-3";
  const a = (deg * Math.PI) / 180;
  const cx = 12, cy = 11, r = 7;
  const ex = cx + r * Math.sin(a);
  const ey = cy - r * Math.cos(a);
  // Grot: dwie krótkie linie cofnięte o ±28° od kierunku.
  const head = (d: number) => `${(ex - 4 * Math.sin(a + d)).toFixed(2)} ${(ey + 4 * Math.cos(a + d)).toFixed(2)}`;
  return `M12 22V${cy}Q12 ${cy - 3} ${ex.toFixed(2)} ${ey.toFixed(2)}M${head(0.5)}L${ex.toFixed(2)} ${ey.toFixed(2)}L${head(-0.5)}`;
}

function ManeuverIcon({ ins }: { ins: NavInstruction }) {
  if (ins.maneuver.startsWith("ARRIVE") || ins.maneuver === "WAYPOINT_REACHED") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 21V4M5 4h14v9H5M9 4v9M13 4v9M17 4v9M5 8.5h14" /></svg>;
  }
  if (ins.maneuver.startsWith("ROUNDABOUT")) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 22v-6M12 16a4 4 0 1 1 3.5-2" />
        <path d={arrowPath(ins.angle ?? 90).replace(/^M12 22V11/, "M15.5 14")} />
      </svg>
    );
  }
  return <svg viewBox="0 0 24 24" aria-hidden><path d={arrowPath(ins.angle !== undefined && ins.maneuver.includes("TURN") ? ins.angle : ANGLES[ins.maneuver] ?? 0)} /></svg>;
}

/** „800 m”, „1,2 km”, „15 km”. */
export function fmtDist(km: number) {
  if (km < 0.95) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return km < 10 ? `${(Math.round(km * 10) / 10).toString().replace(".", ",")} km` : `${Math.round(km)} km`;
}

/** Krótki opis manewru: zjazd, kierunek z drogowskazu, ulica — bez powtarzania całego zdania TomTom. */
function detail(ins: NavInstruction) {
  const parts: string[] = [];
  if (ins.roundaboutExit) parts.push(`${ins.roundaboutExit}. zjazd`);
  if (ins.signpost) parts.push(`→ ${ins.signpost}`);
  else if (ins.street) parts.push(ins.street);
  return parts.join(" · ") || ins.text;
}

/** Panel nawigacji w HUD: następny manewr, pasy ruchu, ograniczenie prędkości; stan „poza trasą” i „brak trasy”. */
export function HudNav({ nav, track, compact, card }: { nav: HudNavData; track: NavTrack; compact?: boolean; card?: boolean }) {
  const { route } = nav;
  const { pos, off } = track;
  // card — styl Nawigacja: duża zielona strzałka, ograniczenie prędkości jest na mapie.
  const cls = `hud-nav ${compact ? "compact" : ""} ${card ? "card" : ""}`;

  if (!route) {
    return (
      <div className={`${cls} off`}>
        <span className="hud-nav-msg">{nav.rerouting ? `Wyznaczam trasę do: ${nav.dest?.label ?? "celu"}…` : nav.dest ? `Brak trasy w tym urządzeniu — cel: ${nav.dest.label}` : nav.onPlan ? "Dokąd jedziemy?" : "Wybierz cel w zakładce Trasa"}</span>
        {!nav.rerouting && nav.dest && <button className="hud-nav-btn" onClick={nav.onReroute}>Wyznacz trasę</button>}
        {!nav.rerouting && !nav.dest && nav.onPlan && <button className="hud-nav-btn" onClick={nav.onPlan}>Wybierz cel</button>}
      </div>
    );
  }

  if (!pos) {
    return (
      <div className={`${cls} waiting`}>
        <span className="hud-nav-msg">Nawigacja: czekam na pozycję GPS…</span>
      </div>
    );
  }

  if (off) {
    return (
      <div className={`${cls} off`}>
        <span className="hud-nav-msg">{nav.rerouting ? "Wyznaczam trasę od nowa…" : `Poza trasą (${Math.round(pos.offM)} m)`}</span>
        {!nav.rerouting && <button className="hud-nav-btn" onClick={nav.onReroute}>Wyznacz ponownie</button>}
      </div>
    );
  }

  const next = nextInstruction(route.instructions, pos.km);
  const lanes = lanesAhead(route.lanes, pos.km);
  const limit = speedLimitAt(route.speedLimits, pos.km);
  const arrived = !next || route.lengthKm - pos.km < 0.05;
  // Najbliższe ostrzeżenie przed nami (nasze dane) — pokazujemy od WARN_AHEAD_KM; odcinkowy pomiar do jego końca.
  const warn = route.warnings?.find((w) => isAhead(w, pos.km) && w.km - pos.km <= WARN_AHEAD_KM);
  const inSection = warn?.toKm !== undefined && pos.km >= warn.km;
  // Najbliższy korek, spowolnienie (od minuty) albo zamknięcie przed nami — od TRAFFIC_AHEAD_KM.
  const jam = route.traffic?.find((t) => jamMatters(t) && t.toKm > pos.km && t.km - pos.km <= TRAFFIC_AHEAD_KM);

  return (
    <div className={`${cls} ${warn ? "with-warn" : ""} ${jam ? "with-jam" : ""}`}>
      {arrived ? (
        <div className="hud-man">
          <ManeuverIcon ins={{ km: 0, maneuver: "ARRIVE", text: "" }} />
          <span><b>Na miejscu</b><small>{route.to.label}</small></span>
        </div>
      ) : (
        <div className={`hud-man ${next!.inKm <= 0.3 ? "soon" : ""}`}>
          <ManeuverIcon ins={next!.ins} />
          <span>
            <b>{fmtDist(next!.inKm)}{next!.ins.exit && <em className="hud-exit">zjazd {next!.ins.exit}</em>}</b>
            <small>{detail(next!.ins)}</small>
            {next!.then && <small className="hud-then">następnie: {detail(next!.then)}</small>}
          </span>
        </div>
      )}
      {lanes && (
        <div className="hud-lanes-guide" aria-label="Pasy ruchu">
          <div className="hud-lane-row">
            {lanes.lanes.map((l, i) => (
              <span key={i} className={`hud-lane ${l.follow ? "on" : ""}`}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  {(l.dirs.length ? l.dirs : ["STRAIGHT"]).map((d) => <path key={d} className={l.follow === d ? "go" : ""} d={arrowPath(LANE_ANGLES[d] ?? 0)} />)}
                </svg>
              </span>
            ))}
          </div>
          <small>{lanes.inKm > 0.05 ? `pasy za ${fmtDist(lanes.inKm)}` : "wybierz pas"}</small>
        </div>
      )}
      {limit !== undefined && !card && (
        <span className="hud-limit" aria-label={`Ograniczenie ${limit} km/h`}>{limit}</span>
      )}
      {warn && (
        <div className={`hud-warn ${inSection || warn.km - pos.km <= 0.5 ? "near" : ""}`} role="alert">
          <b><WarnIcon /> {warningText(warn)}</b>
          <small>{inSection ? `do końca odcinka ${fmtDist(warn.toKm! - pos.km)}` : `za ${fmtDist(Math.max(0, warn.km - pos.km))}`}{warn.name ? ` · ${warn.name}` : ""}</small>
        </div>
      )}
      {jam && (
        <div className={`hud-traffic ${jamTone(jam)}`}>
          <b>{jamText(jam)}</b>
          <small>
            {pos.km >= jam.km ? `jeszcze ${fmtDist(jam.toKm - pos.km)}` : `za ${fmtDist(jam.km - pos.km)} · ${fmtDist(jam.toKm - jam.km)}`}
            {jam.delayMin >= 1 ? ` · +${Math.round(jam.delayMin)} min` : ""}
          </small>
        </div>
      )}
    </div>
  );
}

function WarnIcon() {
  return <svg className="hud-warn-ico" viewBox="0 0 24 24" aria-hidden><path d="M12 3 2 21h20L12 3Z" /><path d="M12 10v5M12 18h.01" /></svg>;
}

// ── Widok nawigacji na mapie (TomTom, styl nocny) ──────────────────────────

/** Zoom zależny od prędkości: w mieście bliżej, na autostradzie dalej — widać drogę kilka km przed nami. */
function navZoom(kmh: number | null) {
  const v = Math.max(0, Math.min(1, ((kmh ?? 0) - 30) / 60));
  return 16.3 - v * 1.6;
}

const MAP_PITCH = 52;

/**
 * Mapa wokół nas: kierunek jazdy w górę, widok pochylony jak w nawigacji, trasa na niebiesko (utrudnienia na żółto /
 * czerwono z opóźnieniem „+10 min”), punkt manewru,
 * cel; zielona strzałka = my (obrócona o różnicę między naszym kierunkiem a kierunkiem trasy).
 */
export function HudRouteMap({ nav, track, live, token, anchorY = 0.8, zoomOffset = 0, friends }: { nav: HudNavData; track: NavTrack; live: Live | null; token: string; anchorY?: number; zoomOffset?: number; friends?: Friend[] }) {
  const route = nav.route;
  const lastBearing = useRef(0);
  const zoomRef = useRef<number | null>(null);
  const center = live ?? (route ? pointAtKm(route.points, 0) : undefined);
  const pos = track.pos;
  const routeBearing = route && pos && !track.off ? bearingAtKm(route.points, pos.km, 0.12) : undefined;
  const bearing = routeBearing ?? live?.heading ?? lastBearing.current;
  lastBearing.current = bearing;
  const arrowTurn = live?.heading != null && (live.kmh ?? 0) >= 5 ? ((live.heading - bearing + 540) % 360) - 180 : 0;
  // Zoom zmienia się płynnie (bez skakania przy każdej zmianie prędkości).
  const target = navZoom(live?.kmh ?? null);
  zoomRef.current = zoomRef.current === null ? target : zoomRef.current + (target - zoomRef.current) * 0.15;
  const zoom = Math.max(12, Math.min(18, Math.round(zoomRef.current * 20) / 20 + zoomOffset));

  if (!center) return <div className="hud-map empty"><span>Czekam na pozycję GPS…</span></div>;
  const km = pos?.km ?? 0;
  const ahead = route ? routeSlice(route.points, km, km + 12) : [];
  const behind = route && pos ? routeSlice(route.points, Math.max(0, km - 1), km) : [];
  const next = route && pos ? nextInstruction(route.instructions, km) : undefined;
  // Utrudnienia na widocznym kawałku trasy — żółty wolniej, czerwony korek; etykieta z opóźnieniem na początku odcinka.
  const jams = (route?.traffic ?? [])
    .filter((t) => t.toKm > km && t.km < km + 12)
    .map((t) => ({ t, tone: jamTone(t), pts: routeSlice(route!.points, Math.max(km, t.km), Math.min(km + 12, t.toKm)) }))
    .filter((j) => j.pts.length > 1);
  // Etykiety nie mogą na siebie wchodzić — kolejna co najmniej 1,5 km dalej.
  let lastLabel = -Infinity;
  const labels = jams.filter((j) => {
    if (!jamMatters(j.t) || j.t.km - lastLabel < 1.5) return false;
    lastLabel = j.t.km;
    return true;
  });
  // Etykieta stoi prosto: cofamy obrót mapy i jej pochylenie (rotateX ściska pion o cos(pitch)).
  const upright = `rotate(${bearing}) scale(1 ${(1 / Math.cos((MAP_PITCH * Math.PI) / 180)).toFixed(3)})`;
  // Znajomi z sygnałem: punkt + imię i km od nas (bez limitu odległości — mapa i tak pokazuje tylko okolicę).
  const mates = (friends ?? []).filter((f) => f.relation === "accepted" && f.presence).map((f) => ({ f, p: f.presence!, km: live ? distanceM(live, f.presence!) / 1000 : undefined }));

  return (
    <div className="hud-map">
      <MapView
        token={token}
        center={center}
        zoom={zoom}
        bearing={bearing}
        pitch={MAP_PITCH}
        anchorY={anchorY}
        overlay={(px) => {
          const d = (pts: { lat: number; lon: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${px(p).map((v) => v.toFixed(1)).join(" ")}`).join("");
          const np = next && route ? px(pointAtKm(route.points, next.ins.km)!) : null;
          const end = route ? px({ lat: route.to.lat, lon: route.to.lon }) : null;
          return (
            <>
              {behind.length > 1 && <path className="hud-map-done" d={d(behind)} />}
              {ahead.length > 1 && (
                <>
                  <path className="hud-map-route-edge" d={d(ahead)} />
                  <path className="hud-map-route" d={d(ahead)} />
                </>
              )}
              {jams.map((j) => <path key={j.t.km} className={`hud-map-jam ${j.tone}`} d={d(j.pts)} />)}
              {labels.map((j) => {
                // Gdy już jedziemy w korku, etykieta stoi kawałek przed strzałką, nie na niej (ale nie za końcem odcinka).
                const [x, y] = px(pointAtKm(route!.points, Math.min(j.t.toKm - 0.05, Math.max(km + 0.35, j.t.km)))!);
                const text = delayLabel(j.t);
                const w = text.length * 9 + 16;
                return (
                  <g key={`l${j.t.km}`} className={`hud-map-delay ${j.tone}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) ${upright}`}>
                    <rect x={-w / 2} y={-40} width={w} height={26} rx={13} />
                    <text x={0} y={-22}>{text}</text>
                  </g>
                );
              })}
              {mates.map(({ f, p, km }) => {
                const [x, y] = px(p);
                const moving = p.status === "driving";
                // Etykieta: imię · km od nas · prędkość (w ruchu) albo rodzaj postoju i ile trwa.
                const extra = moving ? (p.kmh !== null ? `${p.kmh} km/h` : "") : `${STATUS_LABEL[p.status].toLowerCase()}${p.since !== null ? ` ${fmtDuration(Math.max(0, ((live?.t ?? Date.now()) - p.since) / 60_000))}` : ""}`;
                const text = [f.name, km !== undefined ? `${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km` : "", extra].filter(Boolean).join(" · ");
                const w = text.length * 9.5 + 18;
                return (
                  <g key={`f${f.id}`} className={`hud-map-friend ${moving ? "" : "stopped"}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
                    {/* Strzałka jak nasza (prosto, bez spłaszczenia pochyleniem): obrót o kierunek znajomego względem kierunku mapy */}
                    <path transform={`${upright} rotate(${moving && p.heading !== null ? p.heading - bearing : 0})`} d="M0 -24 L17 19 L0 10 L-17 19 Z" />
                    <g transform={upright}>
                      <rect x={-w / 2} y={-56} width={w} height={26} rx={13} />
                      <text x={0} y={-38}>{text}</text>
                    </g>
                  </g>
                );
              })}
              {np && <circle className="hud-map-next" cx={np[0]} cy={np[1]} r="9" strokeWidth="4" />}
              {end && <path className="hud-map-end" transform={`translate(${end[0]} ${end[1]}) rotate(${bearing})`} d="M0 0v-34h24l-6 7 6 7h-24" />}
            </>
          );
        }}
      >
        <svg className="hud-map-me-wrap" style={{ left: "50%", top: `${anchorY * 100}%` }} viewBox="-30 -34 60 64" aria-hidden>
          <path className="hud-map-me" transform={`rotate(${arrowTurn})`} d="M0 -30 L22 24 L0 12 L-22 24 Z" />
        </svg>
      </MapView>
    </div>
  );
}
