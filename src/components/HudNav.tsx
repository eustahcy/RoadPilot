import { useEffect, useRef } from "react";
import { Live } from "../core/gps";
import { alongRoute, bearingAtKm, isOffRoute, laneHint, lanesAhead, locate, NAV, NavInstruction, nextInstruction, pointAtKm, RoutePos, routeSlice, speedLimitAt, nextOffRoute, OFF_ROUTE_IDLE, OffRouteState, locateTrace, TrackFix, travelHeading, junctionZoom } from "../core/navmatch";
import { isAhead, jamMatters, jamTone, NavPlace, NavRoute, RoutePoi, TRAFFIC_ON, TrafficSection, warningText } from "../nav";
import { GlLine, GlMapView, GlMarker, GlVector } from "./GlMap";
import { LatLon, moveView, useMapGestures } from "./MapView";
import { fmtAgo, Friend, STATUS_LABEL } from "../core/friends";
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
  /** Nowe punkty pośrednie → trasa liczona od nowa (od pozycji GPS, bez GPS od startu trasy). */
  onVia?: (via: NavPlace[]) => Promise<void>;
  /** Zakończ nawigację: bez trasy i celu (inaczej trasa wyznaczyłaby się sama od nowa). */
  onEnd?: () => void;
}

export interface NavTrack {
  pos?: RoutePos;
  off: boolean;
  /** Kierunek jazdy ze śladu (odbiornik od 15 km/h, wolniej z przesunięcia); null = nie wiemy (postój). */
  heading: number | null;
}

/**
 * Pozycja na trasie z GPS (z podpowiedzią z poprzedniego odczytu) i pilnowanie trasy: poza nią przez
 * NAV.rerouteAfterMs → nowa trasa, nie częściej niż NAV.rerouteEveryMs.
 */
export function useNavTrack(nav: HudNavData, live: Live | null, accuracyM = 20): NavTrack {
  const hint = useRef<number | undefined>(undefined);
  const offRoute = useRef<OffRouteState>(OFF_ROUTE_IDLE);
  // Ostatnie odczyty (ślad) — dopasowanie z kierunkiem jazdy i mediana odległości od trasy.
  const fixes = useRef<{ t: number; f: TrackFix }[]>([]);
  if (live && fixes.current[fixes.current.length - 1]?.t !== live.t) {
    fixes.current = [...fixes.current, { t: live.t, f: { lat: live.lat, lon: live.lon, kmh: live.kmh, heading: live.heading } }].slice(-5);
  }
  const trail = fixes.current.map((x) => x.f);
  const route = nav.route;

  let pos: RoutePos | undefined;
  if (route && live) {
    pos = locateTrace(route.points, trail, hint.current);
    // Zgubiona podpowiedź (np. po postoju w innym miejscu) — szukamy po całej trasie.
    if (!pos || isOffRoute(pos, accuracyM)) {
      const all = locateTrace(route.points, trail);
      if (all && (!pos || all.offM < pos.offM)) pos = all;
    }
  }
  const off = pos ? isOffRoute(pos, accuracyM) : false;

  useEffect(() => {
    if (pos && !off) hint.current = pos.idx;
    // Zegar urządzenia (nie czas odczytu GPS — iPhone potrafi podać stary): poza trasą od NAV.rerouteAfterMs, daleko od razu.
    // Brak trasy w tym urządzeniu, a jest cel i pozycja — też od razu.
    const missing = !route && !!nav.dest && !!live;
    const r = nextOffRoute(offRoute.current, { off, offM: pos?.offM, missing, now: Date.now(), rerouting: nav.rerouting });
    offRoute.current = r.state;
    if (r.reroute) nav.onReroute();
  });

  return { pos, off, heading: travelHeading(trail) };
}

/** Od tylu km przed miejscem z ograniczeniem pokazujemy ostrzeżenie. */
const WARN_AHEAD_KM = 3;
/** Od tylu km przed utrudnieniem pokazujemy je na karcie; korek, zamknięcie albo od 5 min opóźnienia — już od TRAFFIC_FAR_KM. */
const TRAFFIC_AHEAD_KM = 8;
const TRAFFIC_FAR_KM = 100;
const farJam = (t: TrafficSection) => jamTone(t) !== "slow" || t.delayMin >= 5;
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

/**
 * Strzałka w kierunku `deg` (0 = prosto, dodatnie w prawo; viewBox 24): trzon z dołu łukiem w stronę manewru i wypełniony grot.
 * Zawracanie — przez lewo (ruch prawostronny).
 */
function arrowGeom(deg: number): { shaft: string; head: string } {
  if (Math.abs(deg) >= 170) return { shaft: "M15 22V10a4 4 0 0 0-8 0v4", head: "M7 20.5L2.8 14h8.4z" };
  // Ostry skręt: trzon z boku, łuk górą i grot w dół — inaczej szeroki grot wchodzi na trzon. W lewo = lustro.
  if (Math.abs(deg) > 110) {
    const m = (x: number) => (deg > 0 ? x : 24 - x);
    return { shaft: `M${m(7)} 22V8C${m(7)} 2 ${m(14)} 1.5 ${m(15.2)} 8.4`, head: `M${m(19)} 13L${m(12)} 10.6L${m(18.4)} 6.2z` };
  }
  const a = (deg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  // Ostre skręty zaczynają łuk wyżej — grot nie wchodzi na trzon.
  const cy = Math.abs(deg) > 100 ? 8 : 11;
  const tip = [12 + 9 * dx, cy + 9 * dy];
  const base = [tip[0] - 5.5 * dx, tip[1] - 5.5 * dy];
  const [nx, ny] = [-dy * 4.5, dx * 4.5];
  const f = (x: number) => x.toFixed(2);
  const shaft = Math.abs(deg) < 4 ? `M12 22V${f(base[1] + 0.5)}` : `M12 22V${cy + 3}Q12 ${cy} ${f(base[0] - dx * 0.5)} ${f(base[1] - dy * 0.5)}`;
  return { shaft, head: `M${f(tip[0])} ${f(tip[1])}L${f(base[0] + nx)} ${f(base[1] + ny)}L${f(base[0] - nx)} ${f(base[1] - ny)}z` };
}

function Arrow({ deg, className }: { deg: number; className?: string }) {
  const g = arrowGeom(deg);
  return <g className={className}><path d={g.shaft} /><path className="head" d={g.head} /></g>;
}

/**
 * Rondo jak w ruchu prawostronnym: wjazd od dołu, jazda przeciwnie do ruchu wskazówek zegara, zjazd w kierunku `deg`
 * (0 = na wprost, 90 = w prawo, −90 = w lewo). Przejechana część ronda pogrubiona, reszta przygaszona.
 */
function RoundaboutIcon({ deg, exit }: { deg: number; exit?: string }) {
  const cx = 12, cy = 10.5, r = 5.4;
  // Zawracanie na rondzie: zjazd tuż obok wjazdu, po lewej (objeżdżamy całe rondo) — grot nie leży na wjeździe.
  if (Math.abs(deg) > 150) deg = -150;
  const e = (deg * Math.PI) / 180;
  const [dx, dy] = [Math.sin(e), -Math.cos(e)];
  // Kąt przejechany od wjazdu (dół ronda), przeciwnie do ruchu wskazówek: zjazd w prawo 90°, prosto 180°, w lewo 270°.
  let t = (((180 - deg) % 360) + 360) % 360;
  if (t < 20) t = 340;
  const X = [cx + r * dx, cy + r * dy];
  const tip = [cx + 12.2 * dx, cy + 12.2 * dy];
  const base = [cx + 8 * dx, cy + 8 * dy];
  const [nx, ny] = [-dy * 3.4, dx * 3.4];
  const f = (x: number) => x.toFixed(2);
  return (
    <>
      <circle className="ring" cx={cx} cy={cy} r={r} />
      <path d={`M12 22V${cy + r}A${r} ${r} 0 ${t > 180 ? 1 : 0} 0 ${f(X[0])} ${f(X[1])}L${f(base[0])} ${f(base[1])}`} />
      <path className="head" d={`M${f(tip[0])} ${f(tip[1])}L${f(base[0] + nx)} ${f(base[1] + ny)}L${f(base[0] - nx)} ${f(base[1] - ny)}z`} />
      {exit && <text className="rb-exit" x={cx} y={cy + 2.6} textAnchor="middle">{exit}</text>}
    </>
  );
}

/** Kąt do strzałki: prawdziwy kąt manewru przy skrętach i dużych odbiciach, inaczej typowy dla rodzaju (rozwidlenia, zjazdy). */
const maneuverDeg = (ins: NavInstruction) => (ins.angle !== undefined && (ins.maneuver.includes("TURN") || Math.abs(ins.angle) >= 60) ? ins.angle : ANGLES[ins.maneuver] ?? 0);

export function ManeuverIcon({ ins }: { ins: NavInstruction }) {
  if (ins.maneuver.startsWith("ARRIVE") || ins.maneuver === "WAYPOINT_REACHED") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M6 22V3" /><path className="head" d="M6 3.5c3-1.6 5.5 1.4 8.5 0s4.5-.8 4.5-.8v8.6s-1.5-.7-4.5.8-5.5-1.6-8.5 0z" /></svg>;
  }
  if (ins.maneuver.startsWith("ROUNDABOUT")) {
    const deg = ins.angle ?? (ins.maneuver === "ROUNDABOUT_LEFT" ? -90 : ins.maneuver === "ROUNDABOUT_BACK" ? 180 : ins.maneuver === "ROUNDABOUT_CROSS" ? 0 : 90);
    return <svg viewBox="-2 -2.5 28 28" aria-hidden><RoundaboutIcon deg={deg} exit={ins.roundaboutExit} /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden><Arrow deg={maneuverDeg(ins)} /></svg>;
}

/** Krótki czasownik manewru do kafelka „następny”: „Skręć”, „Zjedź”, „Rondo”… */
function maneuverVerb(ins: NavInstruction) {
  const m = ins.maneuver;
  if (m.startsWith("ARRIVE")) return "Cel";
  if (m.startsWith("ROUNDABOUT")) return "Rondo";
  if (m.includes("UTURN")) return "Zawróć";
  if (m.includes("EXIT")) return "Zjedź";
  if (m.startsWith("KEEP") || m.startsWith("BEAR")) return m.endsWith("LEFT") ? "Lewa strona" : "Prawa strona";
  if (m.includes("TURN") || m.startsWith("SHARP")) return "Skręć";
  return "Prosto";
}

/** „800 m”, „1,2 km”, „15 km”. */
export function fmtDist(km: number) {
  if (km < 0.95) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return km < 10 ? `${(Math.round(km * 10) / 10).toString().replace(".", ",")} km` : `${Math.round(km)} km`;
}

/** Krótki opis manewru: zjazd, kierunek z drogowskazu, ulica — bez powtarzania całego zdania TomTom. */
/**
 * Numer drogi z początku nazwy („A4”, „S52/E 77”, „DK 79”, „708”) → tabliczka jak na znakach: A / S / krajowe czerwone,
 * wojewódzkie (3 cyfry, DW) żółte, europejskie zielone. Reszta nazwy (np. „Autostrada Wolności”) obok.
 */
export function roadBadge(name: string | undefined): { ref: string; kind: "red" | "yellow" | "green"; rest: string } | undefined {
  const m = /^\s*((?:A|S)\s?\d{1,2}|DK\s?\d{1,3}|DW\s?\d{3}|E\s?\d{2,3}|\d{1,3})\b[\s/;,·-]*(.*)$/.exec(name ?? "");
  if (!m) return undefined;
  const ref = m[1].replace(/\s/, "").replace(/^D[KW]/, (x) => `${x} `);
  const num = /\d+/.exec(ref)![0];
  const kind = ref.startsWith("E") ? "green" : ref.startsWith("DW") || (/^\d+$/.test(ref) && num.length === 3) ? "yellow" : "red";
  return { ref, kind, rest: m[2].replace(/^E\s?\d{2,3}\b[\s/;,·-]*/, "").trim() };
}

function detail(ins: NavInstruction) {
  const parts: string[] = [];
  if (ins.roundaboutExit) parts.push(`${ins.roundaboutExit}. zjazd`);
  if (ins.signpost) parts.push(`→ ${ins.signpost}`);
  else if (ins.street) parts.push(ins.street);
  return parts.join(" · ") || ins.text;
}

/** Panel nawigacji w HUD: następny manewr, pasy ruchu, ograniczenie prędkości; stan „poza trasą” i „brak trasy”. */
/** `section` — odcinkowy pomiar rysuje NavView (pasek ze średnią); wtedy nie powtarzamy go jako zwykłego ostrzeżenia. */
export function HudNav({ nav, track, compact, card, section, onManeuvers }: { nav: HudNavData; track: NavTrack; compact?: boolean; card?: boolean; section?: React.ReactNode | null; /** Karta: kafelek kolejnego manewru otwiera listę manewrów. */ onManeuvers?: () => void }) {
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
  const hint = lanes && laneHint(lanes);
  // Bramki przed nami (OSM barrier=toll_booth na naszej jezdni) — od NAV.tollAheadKm.
  const toll = route.pois?.find((p) => p.kind === "toll" && p.km > pos.km - 0.05 && p.km - pos.km <= NAV.tollAheadKm);
  const limit = speedLimitAt(route.speedLimits, pos.km);
  const arrived = !next || route.lengthKm - pos.km < 0.05;
  // Najbliższe ostrzeżenie przed nami (nasze dane) — pokazujemy od WARN_AHEAD_KM; odcinkowy pomiar do jego końca.
  const warn = route.warnings?.find((w) => !w.soft && isAhead(w, pos.km) && w.km - pos.km <= WARN_AHEAD_KM && (section === undefined || w.kind !== "section"));
  const inSection = warn?.toKm !== undefined && pos.km >= warn.km;
  // Najbliższe utrudnienie przed nami: blisko (TRAFFIC_AHEAD_KM) każde ważne, dalej (TRAFFIC_FAR_KM) tylko korek / zamknięcie / duże opóźnienie.
  const jam = TRAFFIC_ON && route.traffic?.find((t) => jamMatters(t) && t.toKm > pos.km && (t.km - pos.km <= TRAFFIC_AHEAD_KM || (t.km - pos.km <= TRAFFIC_FAR_KM && farJam(t))));

  // Karta (tablet): kafelek z manewrem po najbliższym — „Skręć za 390 m”, dotknięcie = lista manewrów.
  const after = card && next ? route.instructions.find((x) => x.km > next.ins.km + 0.005 && x.maneuver !== "DEPART") : undefined;
  return (
    <div className={`${cls} ${warn || section ? "with-warn" : ""} ${jam ? "with-jam" : ""} ${after ? "with-after" : ""}`}>
      {after && (
        <button className="hud-after" onClick={onManeuvers} aria-label="Najbliższe manewry">
          <ManeuverIcon ins={after} />
          <b>{maneuverVerb(after)}</b>
          <small>za {fmtDist(after.km - pos.km)}</small>
          <svg className="hud-after-more" viewBox="0 0 24 24" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </button>
      )}
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
            {card && roadBadge(next!.ins.signpost ? undefined : next!.ins.street) ? (() => {
              const r = roadBadge(next!.ins.street)!;
              return <small className="hud-road"><em className={`road-badge ${r.kind}`}>{r.ref}</em>{r.rest && <span>{r.rest}</span>}</small>;
            })() : <small>{detail(next!.ins)}</small>}
            {next!.then && <small className="hud-then">następnie: {detail(next!.then)}</small>}
          </span>
        </div>
      )}
      {lanes && (
        <div className={`hud-lanes-guide ${hint ? `hint-${hint.side}` : ""}`} aria-label="Pasy ruchu">
          <div className="hud-lane-row">
            {lanes.lanes.map((l, i) => (
              <span key={i} className={`hud-lane ${l.follow ? "on" : ""}`}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  {/* Strzałka, którą jedziemy, na wierzchu. */}
                  {(l.dirs.length ? l.dirs : ["STRAIGHT"]).slice().sort((x, y) => Number(x === l.follow) - Number(y === l.follow)).map((d) => <Arrow key={d} className={l.follow === d ? "go" : ""} deg={LANE_ANGLES[d] ?? 0} />)}
                </svg>
              </span>
            ))}
          </div>
          <small>{hint ? <b>{hint.text}</b> : null}{lanes.inKm > 0.05 ? `${hint ? " · " : ""}za ${fmtDist(lanes.inKm)}` : hint ? "" : "wybierz pas"}</small>
        </div>
      )}
      {limit !== undefined && !card && (
        <span className="hud-limit" aria-label={`Ograniczenie ${limit} km/h`}>{limit}</span>
      )}
      {section}
      {warn && (
        <div className={`hud-warn ${inSection || warn.km - pos.km <= 0.5 ? "near" : ""}`} role="alert">
          <b><WarnIcon /> {warningText(warn)}</b>
          <small>{inSection ? `do końca odcinka ${fmtDist(warn.toKm! - pos.km)}` : `za ${fmtDist(Math.max(0, warn.km - pos.km))}`}{warn.name ? ` · ${warn.name}` : ""}</small>
        </div>
      )}
      {toll && (
        <div className={`hud-warn hud-toll ${toll.km - pos.km <= 0.5 ? "near" : ""}`} role="status">
          <b><TollIcon /> Bramki</b>
          <small>{toll.km > pos.km ? `za ${fmtDist(toll.km - pos.km)}` : "teraz"}{toll.name ? ` · ${toll.name}` : ""}</small>
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

/** Pochylenie mapy (stopnie) — mocniejsze = dalszy horyzont i większa perspektywa, jak w nawigacjach samochodowych. */
const MAP_PITCH = 62;
/** Mapa 2D (płaska, z góry): tyle poziomów zoomu dalej niż w 3D — widać ok. 4× szerzej. */
const FLAT_ZOOM = -2;

/** Płynny ruch mapy między odczytami GPS. */
const SMOOTH = {
  /** Przez tyle ms po nowym odczycie wygaszamy różnicę między przewidywaniem a odczytem (bez skoku). */
  correctMs: 1000,
  /** Bez odczytu (tunel, słaby GPS) przewidujemy ruch po trasie najwyżej tyle s (i NAV.deadReckonKm); poza trasą krócej. */
  maxPredictS: NAV.deadReckonS,
  maxPredictOffS: 8,
} as const;

interface Shown {
  lat: number;
  lon: number;
  /** Km na trasie, gdy jedziemy po niej. */
  km?: number;
  bearing?: number;
}

/**
 * Pozycja do pokazania na mapie: jak w nawigacjach, między odczytami GPS (co ~1 s) przewidujemy ruch z ostatniej
 * prędkości — po trasie (przyciągnięci do niej), a poza trasą wzdłuż kierunku. Nowy odczyt nie przestawia mapy skokiem:
 * różnicę między przewidywaniem a odczytem wygaszamy przez SMOOTH.correctMs.
 * Zwraca funkcję „gdzie jesteśmy teraz” — MapView woła ją w każdej klatce i przesuwa warstwę bez ponownego renderu
 * (render Reacta 20×/s przerysowywał setki kafelków: migotanie na Androidzie, brak pamięci w Safari).
 */
function useSmoothPosition(route: NavRoute | null, pos: RoutePos | undefined, off: boolean, live: Live | null, heading: number | null): () => Shown | undefined {
  // Ostatni odczyt i korekta = to, co pokazywaliśmy w chwili odczytu, minus odczyt (wygaszana do zera).
  const fix = useRef<{ live: Live; km?: number; heading: number | null; at: number; corrKm: number; corrLat: number; corrLon: number } | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  const predict = useRef(() => {
    const f = fix.current;
    const r = routeRef.current;
    if (!f) return undefined;
    const onR = f.km !== undefined && !!r;
    const dt = Math.min(onR ? SMOOTH.maxPredictS : SMOOTH.maxPredictOffS, (performance.now() - f.at) / 1000);
    const fade = Math.max(0, 1 - (dt * 1000) / SMOOTH.correctMs);
    const kmMoved = Math.min(NAV.deadReckonKm, ((f.live.kmh ?? 0) / 3600) * dt);
    if (f.km !== undefined && r) {
      const km = Math.min(r.lengthKm, f.km + kmMoved + f.corrKm * fade);
      const p = pointAtKm(r.points, km)!;
      return { lat: p.lat, lon: p.lon, km, bearing: bearingAtKm(r.points, km, 0.12) } as Shown;
    }
    // Poza trasą: wzdłuż kierunku jazdy (ze śladu, nie z kompasu przy małej prędkości; 1° szerokości ≈ 111,32 km).
    const h = f.heading;
    const dLat = h === null ? 0 : (kmMoved * Math.cos((h * Math.PI) / 180)) / 111.32;
    const dLon = h === null ? 0 : (kmMoved * Math.sin((h * Math.PI) / 180)) / (111.32 * Math.cos((f.live.lat * Math.PI) / 180));
    return { lat: f.live.lat + dLat + f.corrLat * fade, lon: f.live.lon + dLon + f.corrLon * fade } as Shown;
  }).current;

  const onRoute = !!route && !!pos && !off;
  const fixT = live?.t;
  useEffect(() => {
    if (!live) {
      fix.current = null;
      return;
    }
    const s = predict();
    const km = onRoute ? pos!.km : undefined;
    fix.current = {
      live,
      km,
      heading,
      at: performance.now(),
      corrKm: s?.km !== undefined && km !== undefined ? s.km - km : 0,
      corrLat: s && km === undefined ? s.lat - live.lat : 0,
      corrLon: s && km === undefined ? s.lon - live.lon : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixT, onRoute]);

  return predict;
}

/**
 * Mapa wokół nas: kierunek jazdy w górę, widok pochylony jak w nawigacji, trasa na niebiesko (utrudnienia na żółto /
 * czerwono z opóźnieniem „+10 min”), punkt manewru,
 * cel; zielona strzałka = my (obrócona o różnicę między naszym kierunkiem a kierunkiem trasy).
 */
/** Na tyle km przed nami rysujemy pinezki w prowadzeniu (dalej i tak giną przy horyzoncie). */
const PINS_AHEAD_KM = 20;
/** Najwięcej pinezek naraz — przy przeglądaniu długiej trasy najpierw fotoradary i odcinki, potem najbliższe miejsca. */
const PINS_MAX = 160;

/** Typ drogi trasy na danym km (z odcinków trasy). */
function roadTypeAt(route: NavRoute, km: number) {
  let at = 0;
  for (const s of route.segments) {
    at += s.km;
    if (km <= at) return s.type;
  }
  return route.segments.at(-1)?.type;
}

/** Pinezka: kropla z główką (r 15) nad punktem; w główce ikona. */
function Pin({ id, fill, stroke = "#fff", children }: { id: string; fill: string; stroke?: string; children: React.ReactNode }) {
  return (
    <g className="map-pin" data-pin={id}>
      <path d="M0 0 C-4 -9 -15 -14 -15 -26 A15 15 0 1 1 15 -26 C15 -14 4 -9 0 0 Z" fill={fill} stroke={stroke} strokeWidth="2.5" />
      <g transform="translate(0 -26)">{children}</g>
    </g>
  );
}

const PIN_P = <text x="0" y="6.5" textAnchor="middle" fontSize="19" fontWeight="900" fill="#fff" fontFamily="Inter, system-ui, sans-serif">P</text>;
/** Bramki: szlaban (belka w pasy) na słupku. */
const PIN_TOLL = <g><path d="M-8 8V-6" stroke="#fff" strokeWidth="3" strokeLinecap="round" /><rect x="-8" y="-8" width="17" height="5" rx="1.5" fill="#fff" /><path d="M-3 -8v5M3 -8v5" stroke="#e8322c" strokeWidth="2.4" /></g>;
const PIN_FUEL = <path d="M-7 8V-8h9v16zM-5 -6v5h5v-5zM2 -3h2.5l2 2v7a1.5 1.5 0 0 0 3 0V-5l-3-3" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />;
const PIN_CAMERA = <><rect x="-9" y="-5" width="14" height="10" rx="2" fill="#1b2229" /><path d="M5 -2l5-3v10l-5-3z" fill="#1b2229" /><circle cx="-2" cy="0" r="2.6" fill="#fff" /></>;
/** Odcinkowy pomiar: dwie kreski z odcinkiem między nimi i „km/h” ukryte w prostym symbolu |—|. */
const PIN_SECTION = <><path d="M-9 -7v14M9 -7v14M-9 0h18" stroke="#1b2229" strokeWidth="3" strokeLinecap="round" /><circle cx="0" cy="0" r="3.2" fill="#e8322c" /></>;

/** Co n-ty punkt długiej łamanej — przy podglądzie całej trasy wystarczy kilka tysięcy. */
const thinPts = <T,>(pts: T[]) => {
  const step = Math.max(1, Math.floor(pts.length / 3000));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
};

/** Odstęp pinezek (km) przy przeglądaniu: ok. 34 px ekranu przy danym zoomie — inaczej po oddaleniu leżą jedna na drugiej. */
function pinGapKm(v: MapBrowse) {
  const kmPerPx = (40_075 * Math.cos((v.center.lat * Math.PI) / 180)) / (512 * 2 ** v.zoom);
  return kmPerPx * 34;
}

/** Co to za pinezka — do karty po dotknięciu. `km` — km trasy (od jej startu). */
export interface PinInfo {
  key: string;
  kind: RoutePoi["kind"] | "camera" | "red_light" | "section" | "section_end" | "via";
  title: string;
  name: string;
  details: string[];
  km: number;
  lat: number;
  lon: number;
  /** Numer punktu pośredniego (od 0) — dla „Usuń z trasy”. */
  viaIndex?: number;
}

/** Szlaban do baneru bramek na karcie. */
function TollIcon() {
  return (
    <svg className="hud-toll-ico" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 21V6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="3" y="5" width="18" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9 5v5M15 5v5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export const POI_TITLE: Record<RoutePoi["kind"], string> = { fuel: "Stacja paliw", services: "MOP ze stacją i barem", mop: "MOP — miejsce odpoczynku", parking: "Parking dla ciężarówek", toll: "Bramki — punkt poboru opłat" };

/** Stacje / MOP-y / parkingi, fotoradary / odcinki i punkty pośrednie na kawałku trasy [fromKm, toKm] → znaczniki mapy; `gapKm` — min. odstęp. */
function routePins(route: NavRoute, fromKm: number, toKm: number, gapKm = 0): { markers: GlMarker[]; info: PinInfo[] } {
  const pins: { info: PinInfo; prio: number; node: React.ReactNode }[] = [];
  const inRange = (k: number) => k >= fromKm && k <= toKm;
  const add = (info: PinInfo, prio: number, node: React.ReactNode) => pins.push({ info, prio, node });
  for (const w of route.warnings ?? []) {
    const base = { name: w.name, details: w.source === "report" ? ["Zgłoszenie kierowcy"] : [], lat: w.lat, lon: w.lon };
    if (w.kind === "camera" || w.kind === "red_light") {
      const key = `w${w.source}${w.id}`;
      if (inRange(w.km)) add({ ...base, key, kind: w.kind, title: warningText(w), km: w.km }, 0, <Pin id={key} fill="#fff" stroke="#e8322c">{PIN_CAMERA}</Pin>);
    } else if (w.kind === "section") {
      const len = w.toKm !== undefined ? ` · ${(w.toKm - w.km).toFixed(1).replace(".", ",")} km` : "";
      const start = pointAtKm(route.points, w.km);
      const key = `ss${w.id}`;
      if (start && inRange(w.km)) add({ ...base, ...start, key, kind: "section", title: `Początek odcinkowego pomiaru${len}`, details: [warningText(w), ...base.details], km: w.km }, 0, <Pin id={key} fill="#fff" stroke="#e8322c">{PIN_SECTION}</Pin>);
      const end = w.toKm !== undefined ? pointAtKm(route.points, w.toKm) : undefined;
      const keyEnd = `se${w.id}`;
      if (end && inRange(w.toKm!)) {
        add({ ...base, ...end, key: keyEnd, kind: "section_end", title: "Koniec odcinkowego pomiaru", details: [warningText(w)], km: w.toKm! }, 0, (
          <Pin id={keyEnd} fill="#e9edf0" stroke="#8a949c">
            <g opacity="0.55">{PIN_SECTION}</g>
            <path d="M-11 11L11 -11" stroke="#e8322c" strokeWidth="3.4" strokeLinecap="round" />
          </Pin>
        ));
      }
    }
  }
  for (const p of route.pois ?? []) {
    if (!inRange(p.km) || !poiVisible(route, p)) continue;
    const key = `p${p.id}`;
    const details = [`${p.side === "right" ? "Po prawej" : "Po lewej"} stronie, ok. ${Math.round(p.offM / 10) * 10} m od trasy`, ...(p.truck && p.kind !== "parking" ? ["Oznaczone dla ciężarówek"] : [])];
    const node = p.kind === "toll"
      ? <Pin id={key} fill="#6d4bd1">{PIN_TOLL}</Pin>
      : p.kind === "fuel"
      ? <Pin id={key} fill="#e07a1f">{PIN_FUEL}</Pin>
      : <Pin id={key} fill="#2f6fd6">{PIN_P}{p.kind === "services" && <circle cx="11" cy="-11" r="5" fill="#e07a1f" stroke="#fff" strokeWidth="1.5" />}</Pin>;
    add({ key, kind: p.kind, title: POI_TITLE[p.kind], name: p.name, details, km: p.km, lat: p.lat, lon: p.lon }, 1, node);
  }
  // Punkty pośrednie zawsze (bez rozrzedzania) — to Twój wybór.
  const vias: typeof pins = [];
  (route.via ?? []).forEach((v, i) => {
    const at = locate(route.points, v);
    const key = `v${i}`;
    vias.push({ info: { key, kind: "via", title: `Punkt pośredni ${i + 1}`, name: v.label, details: v.sub ? [v.sub] : [], km: at?.km ?? 0, lat: v.lat, lon: v.lon, viaIndex: i }, prio: -1, node: (
      <Pin id={key} fill="#8b5cf6"><text x="0" y="6.5" textAnchor="middle" fontSize="17" fontWeight="900" fill="#fff" fontFamily="Inter, system-ui, sans-serif">{i + 1}</text></Pin>
    ) });
  });
  // Najpierw fotoradary i odcinki, potem miejsca; pinezka za blisko już wybranej (po km trasy) odpada.
  const kept: typeof pins = [];
  for (const p of pins.sort((a, b) => a.prio - b.prio || a.info.km - b.info.km)) {
    if (kept.length >= PINS_MAX) break;
    if (gapKm > 0 && kept.some((q) => Math.abs(q.info.km - p.info.km) < gapKm)) continue;
    kept.push(p);
  }
  // Dalsze rysujemy pierwsze — bliższe pinezki leżą na wierzchu; punkty pośrednie na samej górze.
  const all = [...kept.sort((a, b) => b.info.km - a.info.km), ...vias];
  return { markers: all.map((p) => ({ key: p.info.key, lat: p.info.lat, lon: p.info.lon, node: p.node })), info: all.map((p) => p.info) };
}

/** Na autostradzie i ekspresówce miejsce po lewej jest dla przeciwnego kierunku — nie zjedziemy tam. */
export function poiVisible(route: NavRoute, p: RoutePoi) {
  if (p.side === "right") return true;
  const t = roadTypeAt(route, p.km);
  return t !== "motorway" && t !== "expressway";
}

/** Przeglądanie mapy palcem: widok z góry (bez pochylenia), mapa nie jedzie za pozycją. */
export interface MapBrowse {
  center: LatLon;
  zoom: number;
  bearing: number;
}

export function HudRouteMap({ nav, track, live, token, anchorY = 0.8, zoomOffset = 0, flat = false, friends, vector, browse = null, onBrowse, onPin, onHold }: { nav: HudNavData; track: NavTrack; live: Live | null; token: string; anchorY?: number; zoomOffset?: number; /** Mapa 2D: bez pochylenia, bardziej oddalona. */ flat?: boolean; friends?: Friend[]; /** Własny styl mapy (kafelki wektorowe); brak = TomTom. */ vector?: GlVector; browse?: MapBrowse | null; /** Przesunięcie / szczypanie mapy — brak = mapa bez gestów. */ onBrowse?: (b: MapBrowse) => void; /** Dotknięcie pinezki (null = dotknięcie mapy obok). */ onPin?: (p: PinInfo | null) => void; /** Przytrzymanie palca na mapie — miejsce pod palcem. */ onHold?: (p: LatLon) => void }) {
  const route = nav.route;
  const lastBearing = useRef(0);
  const zoomRef = useRef<number | null>(null);
  const pos = track.pos;
  const predict = useSmoothPosition(route, pos, track.off, live, track.heading);
  const smooth = predict();
  const center = smooth ?? live ?? (route ? pointAtKm(route.points, 0) : undefined);
  const routeBearing = smooth?.bearing ?? (route && pos && !track.off ? bearingAtKm(route.points, pos.km, 0.12) : undefined);
  // Kierunek mapy: z trasy, poza nią ze śladu jazdy (kompas przy małej prędkości kręcił mapą); na postoju bez zmian.
  const bearing = routeBearing ?? track.heading ?? lastBearing.current;
  lastBearing.current = bearing;
  const arrowTurn = track.heading !== null && (live?.kmh ?? 0) >= NAV.headingMinKmh ? ((track.heading - bearing + 540) % 360) - 180 : 0;
  // Zoom zmienia się płynnie (bez skakania przy każdej zmianie prędkości).
  // Przed manewrem (zwłaszcza rondo, pasy, dwa manewry naraz) mapa sama się przybliża i wraca po jego minięciu.
  const target = navZoom(live?.kmh ?? null) + (route && pos && !track.off && !browse ? junctionZoom(route.instructions, route.lanes, pos.km) : 0);
  zoomRef.current = zoomRef.current === null ? target : zoomRef.current + (target - zoomRef.current) * 0.15;
  const zoom = Math.max(9, Math.min(18, Math.round(zoomRef.current * 20) / 20 + zoomOffset + (flat ? FLAT_ZOOM : 0)));

  // Gesty: pierwszy ruch palcem przechodzi z prowadzenia do przeglądania (od bieżącej pozycji i kierunku),
  // kolejne przesuwają / przybliżają widok. Bieżący widok w refie — gest i przejście dzieją się w tym samym zdarzeniu.
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<MapBrowse | null>(browse);
  view.current = browse;
  const followView = { center: center ?? { lat: 0, lon: 0 }, zoom, bearing };
  const pinInfo = useRef(new Map<string, PinInfo>());
  const pickRef = useRef<((x: number, y: number) => LatLon | undefined) | null>(null);
  /** Pinezka pod palcem: najwyżej leżąca (ostatnia w SVG), z zapasem 10 px — pinezki są małe. */
  const pinAt = (x: number, y: number) => {
    const el = box.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const [cx, cy] = [r.left + x, r.top + y];
    let hit: PinInfo | null = null;
    el.querySelectorAll<SVGGElement>("[data-pin]").forEach((g) => {
      if (g.parentElement?.getAttribute("display") === "none") return;
      const b = g.getBoundingClientRect();
      if (cx >= b.left - 10 && cx <= b.right + 10 && cy >= b.top - 10 && cy <= b.bottom + 10) hit = pinInfo.current.get(g.dataset.pin!) ?? hit;
    });
    return hit;
  };
  const gestures = useMapGestures(
    (g) => {
      const v = view.current;
      if (!v || !onBrowse || !box.current) return;
      const [c, z] = moveView(v, g, { w: box.current.clientWidth, h: box.current.clientHeight, bearing: v.bearing });
      view.current = { ...v, center: c, zoom: z };
      onBrowse(view.current);
    },
    () => {
      if (!view.current && onBrowse) view.current = { center: followView.center, zoom: followView.zoom, bearing: followView.bearing };
    },
    {
      onTap: (x, y) => onPin?.(pinAt(x, y)),
      onLongPress: (x, y) => {
        const p = pickRef.current?.(x, y);
        if (p && onHold) {
          navigator.vibrate?.(30);
          onHold(p);
        }
      },
    },
  );

  if (!center) return <div className="hud-map empty"><span>Czekam na pozycję GPS…</span></div>;
  const km = pos?.km ?? 0;
  // Przy przeglądaniu cała trasa przed nami (co n-ty punkt), w prowadzeniu 12 km.
  // W 2D widać dalej — trasa na 25 km.
  const ahead = route ? (browse ? thinPts(routeSlice(route.points, km, Infinity)) : routeSlice(route.points, km, km + (flat ? 25 : 12))) : [];
  const behind = route && pos ? routeSlice(route.points, Math.max(0, km - 1), km) : [];
  const next = route && pos ? nextInstruction(route.instructions, km) : undefined;
  // Utrudnienia na widocznym kawałku trasy — żółty wolniej, czerwony korek; etykieta z opóźnieniem na początku odcinka.
  const jamTo = browse ? Infinity : km + 12;
  const jams = (TRAFFIC_ON ? route?.traffic ?? [] : [])
    .filter((t) => t.toKm > km && t.km < jamTo)
    .map((t) => ({ t, tone: jamTone(t), pts: routeSlice(route!.points, Math.max(km, t.km), Math.min(jamTo, t.toKm)) }))
    .filter((j) => j.pts.length > 1);
  // Etykiety nie mogą na siebie wchodzić — kolejna co najmniej 1,5 km dalej.
  let lastLabel = -Infinity;
  const labels = jams.filter((j) => {
    if (!jamMatters(j.t) || j.t.km - lastLabel < 1.5) return false;
    lastLabel = j.t.km;
    return true;
  });
  // Znajomi: punkt + imię i km od nas (bez sygnału — szara strzałka w ostatniej pozycji) (bez limitu odległości — mapa i tak pokazuje tylko okolicę).
  // Km po trasie, gdy znajomy jest przy naszej trasie; inaczej w linii prostej.
  const mates = (friends ?? []).filter((f) => f.relation === "accepted" && f.presence).map((f) => {
    const along = route && pos && !track.off ? alongRoute(route.points, f.presence!, pos.km) : undefined;
    return { f, p: f.presence!, km: along ? Math.abs(along.km) : live ? distanceM(live, f.presence!) / 1000 : undefined };
  });

  // Linie rysuje WebGL; znaczniki to kilka elementów SVG w układzie ekranu (GlMapView przestawia je co klatkę).
  const rgba = (hex: string, a = 1): [number, number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, a];
  const JAM = { slow: "#f2c230", jam: "#e8322c", closed: "#8a1010" } as const;
  const lines: GlLine[] = [
    ...(behind.length > 1 ? [{ pts: behind, color: rgba(vector?.theme === "day" ? "#8a949c" : "#5b6b78", 0.7), widthPx: 8 }] : []),
    ...(ahead.length > 1 ? [{ pts: ahead, color: rgba("#0b3d80"), widthPx: 15 }, { pts: ahead, color: rgba("#3d8bff"), widthPx: 10 }] : []),
    ...jams.map((j) => ({ pts: j.pts, color: rgba(JAM[j.tone]), widthPx: 9 })),
  ];
  const markers: GlMarker[] = [];
  if (next && route) markers.push({ key: "next", ...pointAtKm(route.points, next.ins.km)!, node: <circle className="hud-map-next" r="8" strokeWidth="4" /> });
  if (route) markers.push({ key: "end", lat: route.to.lat, lon: route.to.lon, node: <path className="hud-map-end" d="M0 0v-34h24l-6 7 6 7h-24" /> });
  for (const j of labels) {
    // Gdy już jedziemy w korku, etykieta stoi kawałek przed strzałką, nie na niej (ale nie za końcem odcinka).
    const at = pointAtKm(route!.points, Math.min(j.t.toKm - 0.05, Math.max(km + 0.35, j.t.km)))!;
    const text = delayLabel(j.t);
    const w = text.length * 8 + 14;
    markers.push({ key: `l${j.t.km}`, ...at, node: <g className={`hud-map-delay ${j.tone}`}><rect x={-w / 2} y={-34} width={w} height={22} rx={11} /><text x={0} y={-18}>{text}</text></g> });
  }
  // Pinezki: stacje, MOP-y, parkingi, fotoradary, odcinkowe pomiary. W prowadzeniu tylko kawałek przed nami, przy przeglądaniu cała trasa.
  const pins = route ? routePins(route, browse ? -Infinity : km - 0.3, browse ? Infinity : km + PINS_AHEAD_KM, browse ? pinGapKm(browse) : 0) : { markers: [], info: [] };
  markers.push(...pins.markers);
  pinInfo.current = new Map(pins.info.map((p) => [p.key, p]));
  for (const { f, p, km: fkm } of mates) {
    const moving = p.status === "driving";
    // Etykieta: imię · km od nas · prędkość (w ruchu) albo rodzaj postoju i ile trwa; bez sygnału — kiedy był ostatni.
    const extra = p.offline ? fmtAgo((live?.t ?? Date.now()) - p.at) : moving ? (p.kmh !== null ? `${p.kmh} km/h` : "") : `${STATUS_LABEL[p.status].toLowerCase()}${p.since !== null ? ` ${fmtDuration(Math.max(0, ((live?.t ?? Date.now()) - p.since) / 60_000))}` : ""}`;
    const text = [f.name, fkm !== undefined ? `${fkm < 10 ? fkm.toFixed(1).replace(".", ",") : Math.round(fkm)} km` : "", extra].filter(Boolean).join(" · ");
    const w = text.length * 7.6 + 16;
    const heading = moving && p.heading !== null ? p.heading : null;
    // Strzałka obrócona o kierunek znajomego względem kierunku mapy (u góry jest nasz kierunek jazdy); etykieta zawsze prosto.
    markers.push({ key: `fa${f.id}`, lat: p.lat, lon: p.lon, rotate: heading === null ? undefined : (b) => heading - b, node: <path className={`hud-map-friend-arrow ${p.offline ? "offline" : moving ? "" : "stopped"}`} d="M0 -24 L17 19 L0 10 L-17 19 Z" /> });
    markers.push({ key: `f${f.id}`, lat: p.lat, lon: p.lon, node: <g className={`hud-map-friend ${p.offline ? "offline" : ""}`}><rect x={-w / 2} y={-48} width={w} height={22} rx={11} /><text x={0} y={-32}>{text}</text></g> });
  }

  if (browse) {
    // Przy przeglądaniu strzałka „my” to zwykły znacznik na mapie (widok nie jedzie za nami).
    const me = smooth ?? live;
    if (me) markers.push({ key: "me", lat: me.lat, lon: me.lon, rotate: (b) => bearing - b, node: <path className="hud-map-me" d="M0 -30 L22 24 L0 12 L-22 24 Z" /> });
    return (
      <div className="hud-map" ref={box} {...(onBrowse ? gestures : {})}>
        <GlMapView token={token} center={browse.center} zoom={browse.zoom} bearing={browse.bearing} pitch={0} anchorY={0.5} lines={lines} markers={markers} vector={vector} pickRef={pickRef} />
      </div>
    );
  }

  return (
    <div className="hud-map" ref={box} {...(onBrowse ? gestures : {})}>
      <GlMapView token={token} center={center} zoom={zoom} bearing={bearing} pitch={flat ? 0 : MAP_PITCH} anchorY={anchorY} lines={lines} markers={markers} follow={predict} vector={vector} pickRef={pickRef}>
        <svg className="hud-map-me-wrap" style={{ left: "50%", top: `${anchorY * 100}%` }} viewBox="-30 -34 60 64" aria-hidden>
          <path className="hud-map-me-halo" transform={`rotate(${arrowTurn})`} d="M0 -30 L22 24 L0 12 L-22 24 Z" />
          <path className="hud-map-me" transform={`rotate(${arrowTurn})`} d="M0 -30 L22 24 L0 12 L-22 24 Z" />
        </svg>
      </GlMapView>
    </div>
  );
}
