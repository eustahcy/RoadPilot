import { useState } from "react";
import { DeadlinePlan } from "../core/deadline";
import { Friend } from "../core/friends";
import { Live } from "../core/gps";
import { nextInstruction, speedLimitAt, speedTone } from "../core/navmatch";
import { Plan } from "../core/plan";
import { Route } from "../core/route";
import { fmtDuration } from "../core/scenarios";
import { fmtClock, fmtKm } from "../format";
import { isAhead, RouteWarning, warningText } from "../nav";
import { GpsStatus, useWakeLock } from "../tracking";
import { useNavVoice } from "../voice";
import { AlertVote } from "./AlertVote";
import { GlVector } from "./GlMap";
import { HudNav, HudNavData, HudRouteMap, NavTrack, useNavTrack } from "./HudNav";
import { HudPlanner, HudRoutePicker } from "./HudRoutePicker";
import { arrivalInfo, fullscreenSupported, Icon, isStop, routeRefs, STALE_MS, toggleFullscreen, useFullscreen, useTick } from "./HudView";
import { ReportKind } from "../collect";
import { ReportSheet } from "./ReportSheet";
import { ActiveStopPanel, confirmStartDay, fmtTimer, StopControlsProps, StopPicker } from "./StopControls";

// Nawigacja — osobny ekran (zakładka „Nawigacja”), niezależny od HUD: mapa w perspektywie, manewr i pasy,
// ostrzeżenia, komunikaty głosowe, wyszukiwanie celu i porównanie tras, znajomi na mapie, zgłoszenia.

export interface NavViewProps {
  /** Trasa / cel i wyznaczanie od bieżącej pozycji (Premium); undefined = brak Premium. */
  nav?: HudNavData;
  planner?: HudPlanner;
  /** Token sesji do kafelków mapy. */
  mapToken?: string;
  /** Własny styl mapy (kafelki wektorowe RoadPilot, dzień / noc) — undefined = kafelki TomTom. */
  mapVector?: GlVector;
  voice: { supported: boolean; on: boolean; toggle: () => void };
  report?: { onSend: (kind: ReportKind, value: number | null) => Promise<void>; onVote: (w: RouteWarning, vote: 1 | -1) => Promise<void> };
  friends?: Friend[];
  live: Live | null;
  gpsOn: boolean;
  gpsStatus: GpsStatus;
  onEnableGps: () => void;
  /** Pozostała trasa (km do celu) i plan przerw — z silnika. */
  route: Route;
  plan?: Plan;
  deadline?: DeadlinePlan;
  stopControls: StopControlsProps;
  /** Ogranicznik pojazdu (km/h) — do koloru prędkości, gdy niższy niż znak. */
  vehicleMaxKmh?: number;
  onExit: () => void;
}

function NavVoice({ nav, track, kmh, enabled }: { nav?: HudNavData; track: NavTrack; kmh: number | null; enabled: boolean }) {
  const route = nav?.route ?? null;
  const pos = track.pos;
  const next = route && pos && !track.off ? nextInstruction(route.instructions, pos.km) : undefined;
  useNavVoice(enabled && !!route, next, pos?.km, route?.warnings, kmh);
  return null;
}

const NO_NAV: HudNavData = { route: null, dest: null, rerouting: false, onReroute: () => {} };

export function NavView(p: NavViewProps) {
  const now = useTick(1000);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [warnList, setWarnList] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [zoomOffset, setZoomOffset] = useState(0);
  const fullscreen = useFullscreen();
  useWakeLock(true);
  const sc = p.stopControls;

  const fresh = p.live && now - p.live.t <= STALE_MS ? p.live : null;
  const speed = fresh?.kmh != null ? Math.round(fresh.kmh) : null;
  const track = useNavTrack(p.nav ?? NO_NAV, fresh);
  const nav = p.nav && p.planner ? { ...p.nav, onPlan: () => { setPlanning(true); setMenu(false); } } : p.nav;
  const route = p.nav?.route ?? null;
  const pos = track.pos;
  const next = route && pos && !track.off ? nextInstruction(route.instructions, pos.km) : undefined;
  const limit = route && pos ? speedLimitAt(route.speedLimits, pos.km) : undefined;
  const legal = limit !== undefined && p.vehicleMaxKmh !== undefined ? Math.min(limit, p.vehicleMaxKmh) : limit ?? p.vehicleMaxKmh;
  const tone = speedTone(speed, legal);
  const upcoming = route?.warnings?.filter((w) => !pos || isAhead(w, pos.km)) ?? [];
  const arrival = arrivalInfo(p.plan, p.deadline, now);
  const endDay = () => confirm("Zakończyć dzień pracy? Zacznie się odpoczynek dzienny.") && sc.onEndDay();
  const openSheet = () => { setSheet(true); setMenu(false); };
  const stopItem = sc.stop
    ? { label: sc.stop.dayEnd ? "Odpoczynek" : "Postój", value: fmtTimer(Math.max(0, (now - sc.stop.start) / 60_000)), sub: sc.stop.targetMin !== null ? `z ${fmtDuration(sc.stop.targetMin)}` : "do ruszenia", tone: "active" }
    : (() => {
        const st = p.plan?.events.find(isStop);
        const inMin = st ? (st.start - now) / 60_000 : undefined;
        return st
          ? { label: st.kind === "break" ? "Przerwa za" : "Odpoczynek za", value: inMin! <= 1 ? "teraz" : fmtDuration(inMin!), sub: `${fmtDuration((st.end - st.start) / 60_000)} o ${fmtClock(st.start, now)}`, tone: inMin! <= 30 ? "warn" : "" }
          : { label: "Przerwa", value: "—", sub: "dojedziesz bez postoju", tone: "" };
      })();

  const notice = !p.gpsOn ? (
    <div className="hud-notice">
      <span>Włącz GPS, żeby nawigacja prowadziła Cię po trasie.</span>
      <button className="primary" onClick={p.onEnableGps}>Włącz GPS</button>
    </div>
  ) : p.gpsStatus === "denied" || p.gpsStatus === "unavailable" ? (
    <div className="hud-notice warn">{p.gpsStatus === "denied" ? "Brak zgody na lokalizację — zezwól na nią w przeglądarce." : "GPS niedostępny — wymaga HTTPS."}</div>
  ) : null;

  return (
    <div className={`hud navmode ${p.mapVector?.theme === "day" ? "day" : ""}`}>
      <NavVoice nav={p.nav} track={track} kmh={fresh?.kmh ?? null} enabled={p.voice.on} />
      <div className="nm-map">
        {p.nav && p.mapToken ? <HudRouteMap nav={p.nav} track={track} live={fresh} token={p.mapToken} anchorY={0.7} zoomOffset={zoomOffset} friends={p.friends} vector={p.mapVector} /> : <div className="hud-map empty" />}
      </div>

      <header className="nm-top">
        {nav ? <HudNav nav={nav} track={track} card /> : (
          <div className="hud-nav card off">
            <span className="hud-nav-msg">Nawigacja jest dostępna w RoadPilot Premium.</span>
          </div>
        )}
        <div className="hud-menu-wrap">
          <button className="hud-pill hud-icon-btn" aria-label="Menu nawigacji" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="dots" />
          </button>
          {menu && (
            <div className="hud-menu" role="menu">
              <button role="menuitem" onClick={openSheet}>{sc.stop ? (sc.stop.dayEnd ? "Odpoczynek dzienny" : "Trwający postój") : "Zaczynam przerwę"}</button>
              {sc.stop?.dayEnd ? (
                <button role="menuitem" onClick={() => { if (confirmStartDay(sc.stop, now)) sc.onStartDay(); setMenu(false); }}>Rozpocznij dzień</button>
              ) : (
                <button role="menuitem" onClick={() => { endDay(); setMenu(false); }}>Zakończ dzień</button>
              )}
              {fullscreenSupported() && (
                <button role="menuitemcheckbox" aria-checked={fullscreen} onClick={() => { toggleFullscreen(); setMenu(false); }}>
                  {fullscreen ? "✓ " : ""}Pełny ekran
                </button>
              )}
              <button role="menuitem" onClick={p.onExit}>Wyjdź z nawigacji</button>
            </div>
          )}
        </div>
      </header>

      <div className="nm-side">
        {p.voice.supported && (
          <button className={`nm-btn ${p.voice.on ? "" : "off"}`} onClick={p.voice.toggle} aria-label={p.voice.on ? "Wycisz komunikaty" : "Włącz komunikaty głosowe"} aria-pressed={p.voice.on}>
            <Icon name={p.voice.on ? "sound" : "mute"} />
          </button>
        )}
        {p.planner && (
          <button className="nm-btn" onClick={() => { setPlanning(true); setMenu(false); }} aria-label="Cel i trasy alternatywne">
            <Icon name="search" />
          </button>
        )}
        <button className={`nm-btn ${upcoming.length ? "warn" : ""}`} onClick={() => setWarnList(true)} aria-label="Ostrzeżenia na trasie">
          <Icon name="warning" />
          {upcoming.length > 0 && <em>{upcoming.length}</em>}
        </button>
        {p.report && (
          <button className="nm-btn report" onClick={() => { setReporting(true); setMenu(false); }} aria-label="Zgłoś na drodze">
            <Icon name="flag" />
          </button>
        )}
        <div className="nm-zoom">
          <button onClick={() => setZoomOffset((z) => Math.min(2, z + 0.5))} aria-label="Przybliż">+</button>
          <button onClick={() => setZoomOffset((z) => Math.max(-2, z - 0.5))} aria-label="Oddal">−</button>
        </div>
      </div>
      {limit !== undefined && <span className="hud-limit nm-limit" aria-label={`Ograniczenie ${limit} km/h`}>{limit}</span>}

      <div className="nm-speed">
        <strong className={speed === null ? "none" : tone ?? ""}>{speed ?? "—"}</strong>
        <span>km/h</span>
      </div>
      {notice && <div className="nm-notice">{notice}</div>}

      <footer className="nm-bottom">
        <div className="nm-info">
          <div>
            <Icon name="flag" />
            <span><small>Do celu</small><b>{fmtKm(p.route.totalKm)}</b></span>
          </div>
          <div className={arrival.bad ? "bad" : ""}>
            <Icon name="clock" />
            <span><small>Przyjazd</small><b>{arrival.clock}</b><i>{arrival.left !== undefined ? `za ${arrival.left}` : arrival.note}</i></span>
          </div>
          <button className={stopItem.tone} onClick={openSheet}>
            <Icon name="coffee" />
            <span><small>{stopItem.label}</small><b>{stopItem.value}</b><i>{stopItem.sub}</i></span>
          </button>
          <div>
            <Icon name="road" />
            <span><small>Trasa</small><b>{route ? routeRefs(route.instructions) : "—"}</b><i>{route ? fmtKm(route.lengthKm) : ""}{route?.engine === "roadpilot" ? " · RoadPilot" : ""}</i></span>
          </div>
        </div>
      </footer>

      {warnList && (
        <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && setWarnList(false)}>
          <div className="hud-sheet-body">
            <button className="hud-sheet-close" aria-label="Zamknij" onClick={() => setWarnList(false)}>×</button>
            <div className="stop-label">Ostrzeżenia na trasie: ograniczenia dla pojazdu, fotoradary, kontrole</div>
            {upcoming.length ? (
              <ul className="nm-warn-list">
                {upcoming.map((w) => (
                  <li key={w.source + w.id + w.kind}>
                    <b>{warningText(w)}</b>
                    <span>{pos ? (w.toKm !== undefined && pos.km >= w.km ? `trwa — do końca ${fmtKm(w.toKm - pos.km)}` : `za ${fmtKm(Math.max(0, w.km - pos.km))}`) : `km ${Math.round(w.km)}`}{w.name ? ` · ${w.name}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Brak znanych ograniczeń, fotoradarów i kontroli (dane OpenStreetMap i zgłoszenia kierowców, Polska).</p>
            )}
          </div>
        </div>
      )}
      {p.report && route && !track.off && <AlertVote warnings={route.warnings} km={pos?.km} onVote={p.report.onVote} />}
      {sheet && (
        <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="hud-sheet-body">
            <button className="hud-sheet-close" aria-label="Zwiń" onClick={() => setSheet(false)}>×</button>
            {sc.stop ? (
              <ActiveStopPanel stop={sc.stop} driver={sc.driver} onEnd={(t) => { sc.onEnd(t); setSheet(false); }} onCancel={() => { sc.onCancel(); setSheet(false); }} onTarget={sc.onTarget} onStartDay={() => { sc.onStartDay(); setSheet(false); }} />
            ) : (
              <>
                <StopPicker driver={sc.driver} now={now} onCancel={() => setSheet(false)} onStart={sc.onStart} />
                <button className="ghost day-btn" onClick={() => { if (endDay()) setSheet(false); }}>Zakończ dzień</button>
              </>
            )}
          </div>
        </div>
      )}
      {reporting && p.report && (
        <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && setReporting(false)}>
          <div className="hud-sheet-body">
            <button className="hud-sheet-close" aria-label="Zamknij" onClick={() => setReporting(false)}>×</button>
            <ReportSheet onSend={p.report.onSend} onClose={() => setReporting(false)} located={p.live !== null} />
          </div>
        </div>
      )}
      {planning && p.planner && (
        <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && setPlanning(false)}>
          <div className="hud-sheet-body wide">
            <button className="hud-sheet-close" aria-label="Zamknij" onClick={() => setPlanning(false)}>×</button>
            <HudRoutePicker planner={p.planner} dest={p.nav?.dest ?? null} onClose={() => setPlanning(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
