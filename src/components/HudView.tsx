import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { matchRoad, nearestPlace, RoadData, roadLabel } from "../core/roads";
import { DeadlinePlan } from "../core/deadline";
import { Live } from "../core/gps";
import { DriverState, Plan, PlanEvent } from "../core/plan";
import { Route } from "../core/route";
import { RULES } from "../core/rules";
import { Better, DriverStatus } from "../core/scenarios";
import { ServiceStatus } from "../core/service";
import { EXTENDED_WORK_MIN, WorkStatus } from "../core/workday";
import { nearestStation, NearestStation, Parking, STATIONS } from "../core/stations";
import { describeWeather, isHazard, Weather, WeatherIcon } from "../core/weather";
import { fmtClock, fmtDay, fmtDuration, fmtHm, fmtKm, fmtTime } from "../format";
import { Remote } from "../nearby";
import { GpsStatus, useWakeLock } from "../tracking";
import { MUSIC_APPS, musicLink, MusicApp } from "../core/apps";
import { launch, platform } from "../launch";
import { HudItems, HudStyle } from "../hudConfig";
import { locate } from "../core/navmatch";
import { NavRoute, useLimitHere } from "../nav";
import { legalLimitAt, nearestOnRoute, NavInstruction, ON_ROUTE_M, speedTone } from "../core/navmatch";
import { RouteWarning } from "../nav";
import { HUD_STYLES } from "../hudConfig";
import { ReportKind } from "../collect";
import { ReportSheet } from "./ReportSheet";
import { ActiveStopPanel, confirmStartDay, fmtTimer, StopControlsProps, StopPicker } from "./StopControls";
import { describeFriend, Friend, MyRoute, nearestFriend } from "../core/friends";
import { fmtFriendDist, FriendTile } from "./Friends";

interface Props {
  origin: string;
  destination: string;
  route: Route;
  doneKm: number;
  /** Plan, według którego jedziemy: pod rozładunek albo najwcześniejszy przyjazd. */
  plan?: Plan;
  deadline?: DeadlinePlan;
  status: DriverStatus;
  /** Stan kierowcy, z którego policzono `status` (po zaliczeniu trwającego postoju). */
  driver: DriverState;
  gpsOn: boolean;
  gpsStatus: GpsStatus;
  live: Live | null;
  parkings: Remote<Parking[]>;
  weather: Remote<Weather>;
  mirror: boolean;
  onMirror: (on: boolean) => void;
  onEnableGps: () => void;
  onExit: () => void;
  stopControls: StopControlsProps;
  work?: WorkStatus;
  service: ServiceStatus;
  /** Skróty do aplikacji wybranych w Ustawieniach. */
  musicApp: MusicApp;
  /** Szybszy wariant niż bieżący plan — undefined, gdy nie ma (albo jedziemy pod rozładunek). */
  better?: Better;
  onBetter: (b: Better) => void;
  /** Drogi i miejscowości w pobliżu (OpenStreetMap) — undefined, gdy wyłączone lub jeszcze nie pobrane. */
  roads?: RoadData;
  /** Średnia prędkość dzisiejszej jazdy (km/h). */
  avgKmh?: number;
  animation: boolean;
  onAnimation: (on: boolean) => void;
  hudStyle: HudStyle;
  /** Widoczne elementy bieżącego stylu (Ustawienia → HUD). */
  items: HudItems;
  onStyle: (s: HudStyle) => void;
  floating: Floating;
  /** Trasa z nawigacji — tylko jako dane: km po trasie do MOP-u i znajomych, limit prędkości do koloru. Nawigacja to osobny ekran (NavView). */
  navRoute?: NavRoute | null;
  /** Token konta Premium — znak ograniczenia bez trasy (ślad GPS dopasowany na serwerze); undefined = tylko z trasy. */
  limitToken?: string;
  /** Ogranicznik pojazdu (km/h) — do koloru prędkości, gdy niższy niż znak. */
  vehicleMaxKmh?: number;
  /** Pojazd > 3,5 t — limity ciężarówki (wyższy znak go nie dotyczy). */
  truck: boolean;
  /** Zgłoszenia z drogi do mapy RoadPilot — tylko ze zgodą kierowcy. */
  report?: { onSend: (kind: ReportKind, value: number | null) => Promise<void>; onVote: (w: RouteWarning, vote: 1 | -1) => Promise<void> };
  /** Znajomi z konta (kafelek „Najbliższy znajomy”, znaczniki na mapie) — undefined bez konta. */
  friends?: Friend[];
}

interface Floating {
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

/** Poniżej tej prędkości pasy stoją. */
const LANES_MIN_KMH = 3;

/** Po takim czasie bez odczytu prędkość jest nieaktualna. */
export const STALE_MS = 10_000;

export const isStop = (e: PlanEvent) => e.kind === "break" || e.kind === "rest" || e.kind === "weeklyRest";

export function HudView(p: Props) {
  const now = useTick(1000);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [reporting, setReporting] = useState(false);
  const fullscreen = useFullscreen();
  useWakeLock(true);
  const sc = p.stopControls;
  const show = p.items;
  const minimal = p.hudStyle === "minimal";

  const fresh = p.live && now - p.live.t <= STALE_MS ? p.live : null;
  const speed = fresh?.kmh != null ? Math.round(fresh.kmh) : null;
  const road = fresh && p.roads ? matchRoad(p.roads.roads, fresh, fresh.heading) : undefined;
  const place = p.live && p.roads ? nearestPlace(p.roads.places, p.live) : undefined;
  const moving = speed !== null && speed >= LANES_MIN_KMH;
  // Okres przerywanej linii przesuwa się tym szybciej, im szybciej jedziemy (90 km/h ≈ 0,28 s).
  const laneStyle = { "--lane-dur": `${moving ? Math.min(3, Math.max(0.12, 25 / speed!)) : 1}s` } as CSSProperties;
  // Z trasą z nawigacji odległości do MOP-ów i znajomych liczymy po trasie, nie w linii prostej (tylko dane, bez prowadzenia).
  const routePos = p.navRoute && fresh ? locate(p.navRoute.points, fresh) : undefined;
  const myRoute: MyRoute | undefined = p.navRoute && routePos && routePos.offM <= ON_ROUTE_M ? { points: p.navRoute.points, km: routePos.km } : undefined;
  // Parking tylko przed nami — to, co za plecami, nie trafia ani na oś, ani do kafelka. Z trasą: najbliższy przy trasie po km trasy.
  const onRouteParking = myRoute && show.parking && p.parkings.data ? nearestOnRoute(p.parkings.data, myRoute.points, myRoute.km) : undefined;
  const parking: NearestStation<Parking> | undefined = onRouteParking
    ? { station: onRouteParking.item, km: onRouteParking.km, ahead: true, onRoute: true }
    : show.parking && p.live && p.parkings.data ? nearestStation(p.parkings.data, p.live, p.live.heading) : undefined;
  const endDay = () => confirm("Zakończyć dzień pracy? Zacznie się odpoczynek dzienny.") && sc.onEndDay();
  const openSheet = () => { setSheet(true); setMenu(false); };
  const hasApps = show.apps && !!musicLink(p.musicApp, platform());
  const floatBtn = show.floating && p.floating.supported;

  // Kolor prędkości: limit z trasy (i ogranicznik pojazdu, gdy niższy) — zielony / żółty / czerwony.
  // Znak: z trasy, a bez niej (albo poza nią) — z drogi, którą jedziemy.
  const here = useLimitHere(p.limitToken, fresh, !myRoute);
  const signLimit = myRoute && p.navRoute ? legalLimitAt(p.navRoute, myRoute.km, p.truck)?.kmh : here ? legalLimitAt(here, Math.max(0, here.km - 0.005), p.truck)?.kmh : undefined;
  const vehicleMax = p.vehicleMaxKmh;
  const legal = signLimit !== undefined && vehicleMax !== undefined ? Math.min(signLimit, vehicleMax) : signLimit ?? vehicleMax;
  const tone = speedTone(speed, legal);
  const speedEl = (
    <div className="hud-speed" aria-label="Prędkość">
      <div className={`hud-speed-num ${speed === null ? "none" : ""}`}>
        <strong className={speed === null ? "none" : tone ?? ""}>{speed ?? "—"}</strong>
        <span>km/h</span>
        {signLimit !== undefined && <span className="hud-limit hud-speed-limit" aria-label={`Ograniczenie ${signLimit} km/h`}>{signLimit}</span>}
      </div>
      {(road || place) && (
        <div className="hud-where">
          {road && <b>{roadLabel(road)}</b>}
          {place && <small>{road ? " · " : ""}{place.name}</small>}
        </div>
      )}
    </div>
  );

  const menuEl = (
    <div className="hud-menu-wrap">
      <button className="hud-pill hud-icon-btn" aria-label="Menu HUD" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <Icon name="dots" />
      </button>
      {menu && (
        <div className="hud-menu" role="menu">
          {HUD_STYLES.filter((h) => h.id !== p.hudStyle).map((h) => (
            <button key={h.id} role="menuitem" onClick={() => { p.onStyle(h.id); setMenu(false); }}>
              Styl: {h.label.toLowerCase()}
            </button>
          ))}
          {p.floating.supported && (
            <button role="menuitemcheckbox" aria-checked={p.floating.active} onClick={() => { p.floating.toggle(); setMenu(false); }}>
              {p.floating.active ? "✓ " : ""}Pływające okienko
            </button>
          )}
          <button role="menuitemcheckbox" aria-checked={p.mirror} onClick={() => { p.onMirror(!p.mirror); setMenu(false); }}>
            {p.mirror ? "✓ " : ""}Odbicie na szybę
          </button>
          <button role="menuitemcheckbox" aria-checked={p.animation} onClick={() => { p.onAnimation(!p.animation); setMenu(false); }}>
            {p.animation ? "✓ " : ""}Animacja drogi
          </button>
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
          <button role="menuitem" onClick={p.onExit}>Wyjdź z HUD</button>
        </div>
      )}
    </div>
  );

  const notice = !p.gpsOn ? (
    <div className="hud-notice">
      <span>Włącz GPS, żeby widzieć prędkość i odliczać kilometry.</span>
      <button className="primary" onClick={p.onEnableGps}>Włącz GPS</button>
    </div>
  ) : p.gpsStatus === "denied" || p.gpsStatus === "unavailable" ? (
    <div className="hud-notice warn">{p.gpsStatus === "denied" ? "Brak zgody na lokalizację — zezwól na nią w przeglądarce." : "GPS niedostępny — wymaga HTTPS."}</div>
  ) : null;

  const reportEl = reporting && p.report && (
    <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && setReporting(false)}>
      <div className="hud-sheet-body">
        <button className="hud-sheet-close" aria-label="Zamknij" onClick={() => setReporting(false)}>×</button>
        <ReportSheet onSend={p.report.onSend} onClose={() => setReporting(false)} located={p.live !== null} />
      </div>
    </div>
  );


  const sheetEl = sheet && (
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
  );

  const lanes = p.animation && (
    <>
      <div className={`hud-lanes ${moving ? "" : "still"}`} style={laneStyle} aria-hidden>
        <div className="hud-lanes-road">
          <i className="lane edge l" /><i className="lane dash l" /><i className="lane dash r" /><i className="lane edge r" />
        </div>
      </div>
    </>
  );

  const apps = hasApps || floatBtn || p.report ? <AppsTile {...p} show={hasApps} floatBtn={floatBtn} onReport={p.report ? () => { setReporting(true); setMenu(false); } : undefined} /> : null;

  if (minimal) {
    return (
      <div className={`hud minimal ${p.mirror ? "mirror" : ""}`}>
        {lanes}
        <header className="hud-min-top">
          <span className="hud-min-meta">
            {show.clock && <b>{fmtTime(now)}</b>}
            {show.weather && <MinWeather weather={p.weather} />}
          </span>
          {menuEl}
        </header>
        <section className="hud-min-main">
          {speedEl}
          {notice}
          {show.route && <MinProgress done={p.doneKm} left={p.route.totalKm} />}
        </section>
        <footer className="hud-min-foot">
          <MinStats {...p} now={now} parking={parking} myRoute={myRoute} onBreak={openSheet} />
          {(show.better && p.better) || apps ? (
            <div className="hud-min-extra">
              {show.better && p.better && <BetterCard better={p.better} now={now} onPick={p.onBetter} />}
              {apps}
            </div>
          ) : null}
        </footer>
        {sheetEl}
        {reportEl}
      </div>
    );
  }

  const tiles = [show.drive, show.break, show.work].filter(Boolean).length;
  // Dolny rząd: kolumny tylko dla widocznych kafelków (szersze dla lepszego scenariusza i MOP-u).
  const info = [
    show.better && p.better && "1.6fr",
    show.parking && "1.3fr",
    show.friends && p.friends && "1.3fr",
    show.service && "1fr",
    apps && "auto",
  ].filter(Boolean) as string[];
  // Same przyciski (MOP, serwis i lepszy scenariusz ukryte) idą nad kafelki — kafelki zostają na dole ekranu.
  const appsOnly = !!apps && info.length === 1;

  return (
    <div className={`hud ${p.mirror ? "mirror" : ""}`}>
      {lanes}
      <header className="hud-top">
        <div className="hud-group">
          {show.clock && <Pill className="p-clock" icon="clock" value={fmtTime(now)} label={fmtDay(now)} below />}
          {show.dest && <Pill className="p-dest" icon="pin" label="Do celu" value={fmtKm(p.route.totalKm)} />}
        </div>

        {speedEl}

        <div className="hud-group right">
          {show.avg && (
            <div className="hud-pill p-avg" title="Średnia prędkość dzisiejszej jazdy">
              <span className="hud-avg-sign" aria-hidden>⌀</span>
              <span className="hud-pill-text">
                <b>{p.avgKmh !== undefined ? Math.round(p.avgKmh) : "—"} <i>km/h</i></b>
                <small className="accent">Średnia dziś</small>
              </span>
            </div>
          )}
          {show.weather && <WeatherPill weather={p.weather} gpsOn={p.gpsOn} located={p.live !== null} />}
          {menuEl}
        </div>
      </header>

      <section className="hud-mid">
        {/* My — na środkowym pasie animacji drogi, zawsze przodem (bez obracania wg kierunku), tuż nad kafelkami. */}
        {lanes && <svg className="hud-me" viewBox="-30 -34 60 64" aria-hidden><path d="M0 -30 L22 24 L0 12 L-22 24 Z" /></svg>}
        {notice}
          {show.route && <RouteLine {...p} now={now} parking={parking} />}
        {(show.stats || show.arrival) && <Stats {...p} now={now} />}
      </section>

      {sheetEl}
      {reportEl}

      <footer className="hud-foot">
        {appsOnly && <div className="hud-apps-row">{apps}</div>}
        {tiles > 0 && (
          <div className={`hud-tiles n${tiles}`} style={{ "--tiles": tiles } as CSSProperties}>
            {show.drive && <DriveTile status={p.status} driver={p.driver} />}
            {show.break && <BreakTile {...p} now={now} onOpen={openSheet} />}
            {show.work && <WorkTile work={p.work} now={now} />}
          </div>
        )}
        {info.length > 0 && !appsOnly && (
          <div className={`hud-info ${show.better && p.better ? "with-better" : ""} ${apps ? "with-apps" : ""}`} style={{ "--info": info.join(" ") } as CSSProperties}>
            {show.better && p.better && <BetterCard better={p.better} now={now} onPick={p.onBetter} />}
            {show.parking && <ParkingTile gpsOn={p.gpsOn} live={p.live} parkings={p.parkings} found={parking} />}
            {show.friends && p.friends && <FriendTile friends={p.friends} me={p.live} now={now} route={myRoute} />}
            {show.service && <ServiceTile service={p.service} />}
            {apps}
          </div>
        )}
      </footer>
    </div>
  );
}

interface Marker {
  icon: IconName;
  /** Km od bieżącej pozycji. */
  km: number;
  label: string;
  tone: "stop" | "parking" | "service";
}

/** Na osi zostają tylko znaczniki oddalone od siebie o tyle (część trasy) — inaczej podpisy nachodzą na siebie. */
const MARKER_GAP = 0.11;
/** …ale nie mniej niż tyle pikseli — na wąskim ekranie (pionowo) podpisy „za 355 km 17:47” muszą się zmieścić obok siebie. */
const MARKER_GAP_PX = 96;
const DASHES = 18;

/**
 * Oś trasy: Start → Cel, przejechana część na zielono, ciężarówka w miejscu, w którym jesteśmy.
 * Wszystkie znaczniki podpisujemy odległością od bieżącej pozycji („za 92 km”) — tak samo jak kafelki.
 */
function RouteLine(p: Props & { now: number; parking?: NearestStation<Parking> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(600);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setTrackW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const gap = Math.max(MARKER_GAP, MARKER_GAP_PX / trackW);
  const left = p.route.totalKm;
  const total = p.doneKm + left;
  const done = total > 0 ? Math.min(1, p.doneKm / total) : 0;

  // Kolejność = ważność: postoje z planu, potem parking, serwis.
  const candidates: Marker[] = [];
  for (const e of (p.plan?.events ?? []).filter(isStop).slice(0, 2)) {
    candidates.push({ icon: e.kind === "break" ? "coffee" : "bed", km: e.fromKm, label: fmtClock(e.start, p.now), tone: "stop" });
  }
  if (p.parking?.ahead) candidates.push({ icon: "parking", km: p.parking.km, label: "", tone: "parking" });
  if (p.service.kmLeft !== undefined && p.service.kmLeft > 0) candidates.push({ icon: "wrench", km: p.service.kmLeft, label: "serwis", tone: "service" });
  const markers: (Marker & { at: number })[] = [];
  for (const m of candidates) {
    if (m.km < 1 || m.km > left || total <= 0) continue;
    const at = (p.doneKm + m.km) / total;
    if (markers.every((o) => Math.abs(o.at - at) >= gap)) markers.push({ ...m, at });
  }

  return (
    <div className="hud-route" aria-label="Postęp trasy">
      <div className="hud-route-end start">
        <Icon name="play" />
        <b>Start</b>
        {p.origin && <small>{p.origin}</small>}
      </div>
      <div className="hud-track" ref={trackRef}>
        <div className="hud-dashes">
          {Array.from({ length: DASHES }, (_, i) => <i key={i} className={(i + 0.5) / DASHES <= done ? "on" : ""} />)}
        </div>
        <div className="hud-truck" style={{ "--p": done } as CSSProperties}>
          <b>{Math.round(done * 100)}%</b>
          <Icon name="truck" />
        </div>
        {markers.map((m) => (
          <div key={m.tone + m.km} className={`hud-marker m-${m.tone}`} style={{ left: `${Math.min(96, Math.max(4, m.at * 100))}%` }}>
            <Icon name={m.icon} />
            <b>za {fmtKm(m.km)}</b>
            {m.label && <small>{m.label}</small>}
          </div>
        ))}
      </div>
      <div className="hud-route-end">
        <Icon name="finish" />
        <b>Cel</b>
        {p.destination && <small>{p.destination}</small>}
      </div>
    </div>
  );
}

/** Pokonano / Pozostało / Szacowany czas dojazdu — przyjazd z planu, czyli z przerwami i odpoczynkami po drodze. */
/** Przyjazd z planu (z postojami) — ten sam w obu stylach. */
export function arrivalInfo(plan: Plan | undefined, deadline: DeadlinePlan | undefined, now: number) {
  if (!plan) {
    return {
      clock: deadline?.earliest !== undefined ? fmtClock(deadline.earliest, now) : "—",
      left: undefined,
      note: deadline ? `nie zdążysz na ${fmtClock(deadline.deadline, now)}` : "brak wykonalnego planu",
      bad: true,
    };
  }
  const stops = plan.events.filter(isStop);
  const stopMin = stops.reduce((a, e) => a + (e.end - e.start) / 60_000, 0);
  return {
    clock: fmtClock(plan.arrival, now),
    left: fmtDuration(Math.max(0, plan.arrival - now) / 60_000),
    note: [stops.length ? `z postojami ${fmtDuration(stopMin)}` : "bez postojów", deadline ? `rozładunek ${fmtClock(deadline.deadline, now)}` : ""].filter(Boolean).join(" · "),
    bad: false,
  };
}

function Stats({ plan, deadline, doneKm, route, now, items }: Props & { now: number }) {
  const a = arrivalInfo(plan, deadline, now);
  const cols = [items.stats && "1fr", items.stats && "1fr", items.arrival && "1.4fr"].filter(Boolean).join(" ");
  return (
    <div className="hud-stats" style={{ "--stats": cols } as CSSProperties}>
      {items.stats && <div><small>Pokonano</small><b>{fmtKm(doneKm)}</b></div>}
      {items.stats && <div><small>Pozostało</small><b>{fmtKm(route.totalKm)}</b></div>}
      {items.arrival && (
        <div className={a.bad ? "bad" : ""}>
          <small>Szacowany czas dojazdu</small>
          <b>{a.left !== undefined ? <>{a.left} <small>({a.clock})</small></> : a.clock}</b>
          <span>{a.note}</span>
        </div>
      )}
    </div>
  );
}

/** Komunikaty głosowe — osobny komponent, żeby hook działał tylko w stylu Nawigacja. */

/** Główne drogi trasy z opisów manewrów: „A1 · S7 · A4” (autostrady, ekspresówki, drogi krajowe) — max 3. */
export function routeRefs(list: NavInstruction[]) {
  // Polskie numery A / S; europejskie E tylko, gdy innych nie ma (E75 to ta sama A1).
  const collect = (re: RegExp) => {
    const refs: string[] = [];
    for (const i of list) {
      for (const m of `${i.street ?? ""} ${i.signpost ?? ""} ${i.text}`.matchAll(re)) {
        const r = m[1].replace(/\s/, "");
        if (!refs.includes(r)) refs.push(r);
      }
    }
    return refs;
  };
  const refs = collect(/\b([AS]\s?\d{1,2})\b/g);
  const all = refs.length ? refs : collect(/\b(E\s?\d{2,3})\b/g);
  return all.length ? all.slice(0, 3).join(" · ") : "drogi lokalne";
}

/** Styl minimalistyczny: pogoda jako zwykły tekst. */
function MinWeather({ weather }: { weather: Remote<Weather> }) {
  if (!weather.data) return null;
  const d = describeWeather(weather.data.code, weather.data.isDay);
  return <span className={isHazard(weather.data) ? "warn" : ""}><Icon name={d.icon} />{Math.round(weather.data.tempC)}°C</span>;
}

/** Styl minimalistyczny: cienka linia postępu zamiast osi ze znacznikami. */
function MinProgress({ done, left }: { done: number; left: number }) {
  const total = done + left;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="hud-min-progress" aria-label="Postęp trasy">
      <span style={{ width: `${pct * 100}%` }} />
      <i style={{ left: `${pct * 100}%` }} />
      <b>{Math.round(pct * 100)}%</b>
    </div>
  );
}

interface MinStat {
  key: string;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  onClick?: () => void;
}

/** Styl minimalistyczny: same liczby z podpisami, bez kafelków i pasków. */
function MinStats(p: Props & { now: number; parking?: NearestStation<Parking>; myRoute?: MyRoute; onBreak: () => void }) {
  const { items: show, now, status, driver, stopControls: sc } = p;
  const out: MinStat[] = [];
  if (show.dest) out.push({ key: "dest", label: "Do celu", value: fmtKm(p.route.totalKm) });
  if (show.arrival) {
    const a = arrivalInfo(p.plan, p.deadline, now);
    out.push({ key: "arrival", label: "Przyjazd", value: a.clock, sub: a.left !== undefined ? `za ${a.left}` : a.note, tone: a.bad ? "bad" : undefined });
  }
  if (show.break) {
    if (sc.stop) {
      out.push({ key: "break", label: sc.stop.dayEnd ? "Odpoczynek" : "Postój", value: fmtTimer(Math.max(0, (now - sc.stop.start) / 60_000)), sub: sc.stop.targetMin !== null ? `z ${fmtDuration(sc.stop.targetMin)}` : "do ruszenia", tone: "active", onClick: p.onBreak });
    } else {
      const stop = p.plan?.events.find(isStop);
      const inMin = stop ? (stop.start - now) / 60_000 : undefined;
      out.push(stop
        ? { key: "break", label: stop.kind === "break" ? "Przerwa za" : "Odpoczynek za", value: inMin! <= 1 ? "teraz" : fmtDuration(inMin!), sub: `${fmtDuration((stop.end - stop.start) / 60_000)} o ${fmtClock(stop.start, now)}`, tone: inMin! <= 0 && stop.kind === "break" ? "bad" : inMin! <= 30 ? "warn" : undefined, onClick: p.onBreak }
        : { key: "break", label: "Przerwa", value: "—", sub: "dojedziesz bez postoju", onClick: p.onBreak });
    }
  }
  if (show.drive) {
    const limit = driver.drivenTodayMin > RULES.dailyDrive ? RULES.dailyDriveExtended : RULES.dailyDrive;
    out.push({ key: "drive", label: "Jazda — zostało", value: fmtDuration(status.driveLeftToday), sub: `${fmtHm(driver.drivenTodayMin)} / ${fmtHm(limit)}`, tone: status.driveLeftToday <= 0 ? "bad" : status.driveLeftToday <= 30 ? "warn" : undefined });
  }
  if (show.work) {
    const w = p.work;
    const end = w && (w.phase === "extended" || w.phase === "extendedOver") && w.extendedEnd ? w.extendedEnd : w?.end;
    out.push(w
      ? { key: "work", label: "Koniec pracy", value: fmtClock(end!, now), sub: `praca ${fmtHm(w.elapsedMin)}`, tone: w.phase === "ok" ? undefined : w.phase === "soon" || w.phase === "extended" ? "warn" : "bad" }
      : { key: "work", label: "Praca", value: "—", sub: "odpoczynek dzienny" });
  }
  if (show.stats) out.push({ key: "done", label: "Pokonano", value: fmtKm(p.doneKm) });
  if (show.avg) out.push({ key: "avg", label: "Średnia", value: p.avgKmh !== undefined ? `${Math.round(p.avgKmh)} km/h` : "—" });
  if (show.parking) {
    const ok = p.parking && p.parking.ahead !== false ? p.parking : undefined;
    out.push({ key: "parking", label: ok ? PARKING_TITLE[ok.station.kind].replace("Najbliższy ", "") : "MOP", value: ok ? fmtStationKm(ok.km) : "—", sub: ok ? `${ok.station.name}${ok.onRoute ? " · po trasie" : ""}` : undefined });
  }
  if (show.friends && p.friends) {
    const n = nearestFriend(p.friends, p.live, p.myRoute);
    const info = n?.friend.presence ? describeFriend(n.friend.presence, p.live, now, p.myRoute) : undefined;
    out.push({ key: "friend", label: n ? n.friend.name : "Znajomi", value: info ? (info.km !== undefined ? fmtFriendDist(info.km) : info.status) : "—", sub: info ? [info.onRoute ? (info.ahead ? "przed Tobą" : "za Tobą") : "", info.km !== undefined ? info.status : "", info.duration].filter(Boolean).join(" · ") : "nikt nie nadaje", tone: info?.tone === "warn" ? "warn" : undefined });
  }
  if (show.service && p.service.level !== "none") {
    const km = p.service.kmLeft;
    out.push({ key: "service", label: "Serwis", value: km !== undefined ? (km > 0 ? `${fmtThousands(km)} km` : "po terminie") : p.service.daysLeft! >= 0 ? `${p.service.daysLeft} dni` : "po terminie", tone: p.service.level === "overdue" ? "bad" : p.service.level === "soon" ? "warn" : undefined });
  }
  if (!out.length) return null;
  return (
    <div className="hud-min-stats" style={{ "--n": Math.min(out.length, 6) } as CSSProperties}>
      {out.map((st) => {
        const body = (
          <>
            <small>{st.label}</small>
            <b>{st.value}</b>
            {st.sub && <span>{st.sub}</span>}
          </>
        );
        return st.onClick ? (
          <button key={st.key} className={`hud-min-stat ${st.tone ?? ""}`} onClick={st.onClick}>{body}</button>
        ) : (
          <div key={st.key} className={`hud-min-stat ${st.tone ?? ""}`}>{body}</div>
        );
      })}
    </div>
  );
}

function Bar({ value, tone }: { value: number; tone?: Tone }) {
  return <div className={`hud-bar ${tone ?? ""}`}><span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}

/** Jazda dziś wobec dziennego limitu (9 h, 10 h przy wydłużeniu). */
function DriveTile({ status, driver }: { status: DriverStatus; driver: DriverState }) {
  const limit = driver.drivenTodayMin > RULES.dailyDrive ? RULES.dailyDriveExtended : RULES.dailyDrive;
  const byWeek = status.weekLeft < limit - driver.drivenTodayMin;
  const tone: Tone = status.driveLeftToday <= 0 ? "bad" : status.driveLeftToday <= 30 ? "warn" : undefined;
  return (
    <Tile icon="wheel" label="Czas jazdy dziś" tone={tone} bar={driver.drivenTodayMin / limit}>
      <strong>{fmtHm(driver.drivenTodayMin)} <em>/ {fmtHm(limit)}</em></strong>
      <span>zostało {fmtDuration(status.driveLeftToday)}{byWeek ? " · limit tygodnia" : ""}</span>
    </Tile>
  );
}

/** Następny postój z planu; w trakcie postoju — jego licznik. Otwiera panel postoju. */
function BreakTile({ plan, status, driver, stopControls: sc, now, onOpen }: Props & { now: number; onOpen: () => void }) {
  // Segmenty po 30 min ciągłej jazdy — 9 segmentów = 4,5 h.
  const segments = Math.round(RULES.maxContinuousDrive / 30);
  const lit = Math.min(segments, Math.floor(driver.sinceBreakMin / 30 + 1e-6));
  let body: ReactNode;
  let tone: Tone;
  if (sc.stop) {
    const elapsed = Math.max(0, (now - sc.stop.start) / 60_000);
    tone = "active";
    body = (
      <>
        <span className="hud-tile-label">{sc.stop.dayEnd ? "Odpoczynek dzienny" : "Postój trwa"}</span>
        <strong>{fmtTimer(elapsed)}</strong>
        <span>{sc.stop.targetMin !== null ? `z ${fmtDuration(sc.stop.targetMin)}` : "do ruszenia"}</span>
      </>
    );
  } else {
    const stop = plan?.events.find(isStop);
    const inMin = stop ? (stop.start - now) / 60_000 : undefined;
    // Spóźniona przerwa to naruszenie; odpoczynek „teraz” to po prostu wybrany plan.
    tone = inMin === undefined ? undefined : inMin <= 0 && stop!.kind === "break" ? "bad" : inMin <= 30 ? "warn" : undefined;
    body = stop ? (
      <>
        <span className="hud-tile-label">{stop.kind === "break" ? "Następna przerwa" : "Odpoczynek dzienny"}</span>
        <strong>{inMin! <= 1 ? "teraz" : fmtDuration(inMin!)}</strong>
        <span>{fmtDuration((stop.end - stop.start) / 60_000)} o {fmtClock(stop.start, now)} · max {fmtDuration(RULES.maxContinuousDrive)} jazdy</span>
      </>
    ) : (
      <>
        <span className="hud-tile-label">Następna przerwa</span>
        <strong>{fmtDuration(status.untilBreak)}</strong>
        <span>dojedziesz bez postoju</span>
      </>
    );
  }
  return (
    <button className={`hud-tile hud-tile-btn ${tone ?? ""}`} onClick={onOpen} aria-label="Postój">
      <Icon name="coffee" className="hud-tile-ico" />
      <div className="hud-tile-body">{body}</div>
      <Icon name="chevron" className="hud-chevron" />
      <div className="hud-segments" aria-hidden>
        {Array.from({ length: segments }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)}
      </div>
    </button>
  );
}

/** Czas pracy (okres dnia pracy) wobec limitu — 13 h albo 15 h po wejściu w wydłużenie. */
function WorkTile({ work, now }: { work?: WorkStatus; now: number }) {
  if (!work) {
    return (
      <Tile icon="briefcase" label="Czas pracy" bar={0}>
        <strong className="dim">—</strong>
        <span>odpoczynek dzienny</span>
      </Tile>
    );
  }
  const extended = (work.phase === "extended" || work.phase === "extendedOver") && work.extendedEnd !== undefined;
  const limit = extended ? EXTENDED_WORK_MIN : work.elapsedMin + work.leftMin;
  const end = extended ? work.extendedEnd! : work.end;
  const tone: Tone = work.phase === "over" || work.phase === "extendedOver" ? "bad" : work.phase === "ok" ? undefined : "warn";
  return (
    <Tile icon="briefcase" label="Czas pracy" tone={tone} bar={work.elapsedMin / limit}>
      <strong>{fmtHm(work.elapsedMin)} <em>/ {fmtHm(limit)}</em></strong>
      <span>{end > now ? `koniec o ${fmtClock(end, now)}` : "limit minął"}{extended ? " · wydłużony" : ""}</span>
    </Tile>
  );
}

const SCENARIO_TEXT = { now: "Jedź teraz", rest9: "Odpocznij teraz 9 h", rest11: "Odpocznij teraz 11 h" } as const;

/** Szybszy wariant — pokazujemy tylko, gdy istnieje; dotknięcie przełącza plan (po potwierdzeniu). */
function BetterCard({ better, now, onPick }: { better: Better; now: number; onPick: (b: Better) => void }) {
  const lead = better.kind === "scenario" ? SCENARIO_TEXT[better.id] : `Dopuść ${better.label}`;
  const ask = better.kind === "scenario" ? `${lead} — przyjazd ${fmtClock(better.arrival, now)}. Przełączyć plan?` : `Dopuścić ${better.label}? Przyjazd o ${fmtClock(better.arrival, now)}.`;
  return (
    <button className="hud-better" onClick={() => confirm(ask) && onPick(better)}>
      <Icon name="clock" className="hud-tile-ico" />
      <span className="hud-better-text">
        <b>Lepszy scenariusz</b>
        <span>{lead}: przyjazd <em>{fmtDuration(better.savedMin)} wcześniej</em> ({fmtClock(better.arrival, now)})</span>
      </span>
      <Icon name="chevron" className="hud-chevron" />
    </button>
  );
}

const PARKING_TITLE: Record<Parking["kind"], string> = { mop: "Najbliższy MOP", services: "Najbliższy MOP", truck: "Parking TIR" };

function lookupText<T>(gpsOn: boolean, live: Live | null, data: Remote<T[]>, what: string) {
  if (!gpsOn) return "włącz GPS";
  if (!live) return "czekam na pozycję…";
  if (data.data) return `brak przed Tobą (${STATIONS.radiusM / 1000} km)`;
  if (data.error) return "nie udało się pobrać — ponowię";
  return `szukam ${what}…`;
}

/** Najbliższy MOP / parking dla ciężarówek przed nami. */
function ParkingTile({ gpsOn, live, parkings, found }: { gpsOn: boolean; live: Live | null; parkings: Remote<Parking[]>; found?: NearestStation<Parking> }) {
  const ok = found && found.ahead !== false ? found : undefined;
  return (
    <div className="hud-info-tile is-parking">
      <span className="hud-p" aria-hidden>P</span>
      <span className="hud-info-text">
        <small>{ok ? PARKING_TITLE[ok.station.kind] : "Najbliższy MOP"}</small>
        <b className="ellipsis">{ok ? ok.station.name : "—"}</b>
        <span>{ok ? `${ok.onRoute ? "za " : ""}${fmtStationKm(ok.km)}${ok.onRoute ? " po trasie" : ""}${ok.station.kind === "services" ? " · stacja paliw, bar" : ""}` : lookupText(gpsOn, live, parkings, "parkingów")}</span>
      </span>
    </div>
  );
}

function ServiceTile({ service }: { service: ServiceStatus }) {
  const tone = service.level === "overdue" ? "bad" : service.level === "soon" ? "warn" : "";
  const main =
    service.kmLeft !== undefined ? (service.kmLeft > 0 ? `za ${fmtThousands(service.kmLeft)} km` : "po terminie")
    : service.daysLeft !== undefined ? (service.daysLeft >= 0 ? `za ${service.daysLeft} dni` : "po terminie")
    : "—";
  const sub = service.level === "none" ? "ustaw w Ustawieniach" : service.kmLeft !== undefined && service.daysLeft !== undefined ? `lub za ${service.daysLeft} dni` : "";
  return (
    <div className={`hud-info-tile ${tone}`}>
      <Icon name="wrench" className="hud-info-ico" />
      <span className="hud-info-text">
        <small>Serwis</small>
        <b>{main}</b>
        {sub && <span>{sub}</span>}
      </span>
    </div>
  );
}

/** Muzyka, zgłoszenia i przycisk pływającego okienka — to, co kierowca włączył w Ustawieniach. */
function AppsTile({ musicApp, show, floatBtn, floating, onReport }: Props & { show: boolean; floatBtn: boolean; onReport?: () => void }) {
  const os = platform();
  const music = show ? musicLink(musicApp, os) : undefined;
  return (
    <div className="hud-apps">
      {onReport && (
        <button className="hud-app report" onClick={onReport} aria-label="Zgłoś na drodze">
          <Icon name="flag" />
          <span>Zgłoś</span>
        </button>
      )}
      {floatBtn && (
        <button className={`hud-app ${floating.active ? "on" : ""}`} onClick={floating.toggle} aria-label="Pływające okienko" aria-pressed={floating.active}>
          <Icon name="pip" />
          <span>Okienko</span>
        </button>
      )}
      {music && (
        <button className="hud-app music" onClick={() => launch(music, os)} aria-label={`Muzyka: ${MUSIC_APPS.find((a) => a.id === musicApp)!.label}`}>
          <Icon name="music" />
          <span>{MUSIC_APPS.find((a) => a.id === musicApp)!.label}</span>
        </button>
      )}
    </div>
  );
}

function WeatherPill({ weather: { data, loading, error }, gpsOn, located }: { weather: Remote<Weather>; gpsOn: boolean; located: boolean }) {
  if (!data) {
    // Pogoda potrzebuje pozycji — mówimy, na co czekamy, zamiast gołej kreski.
    const why = !gpsOn ? "włącz GPS" : !located ? "czekam na GPS" : loading ? "pobieram…" : error ? "brak sieci" : "pobieram…";
    return <Pill className="p-weather" icon="cloud" label="Pogoda" value={why} />;
  }
  const d = describeWeather(data.code, data.isDay);
  return <Pill className="p-weather" icon={d.icon} value={`${Math.round(data.tempC)}°C`} label={d.text} tone={isHazard(data) ? "warn" : undefined} below />;
}

type Tone = "warn" | "bad" | "active" | undefined;

/** `below` — podpis pod wartością (godzina / data, temperatura / opis), jak na wizualizacji. */
function Pill({ icon, label, value, tone, className = "", below }: { icon: IconName; label?: string; value: string; tone?: Tone; className?: string; below?: boolean }) {
  return (
    <div className={`hud-pill ${className} ${tone ?? ""}`}>
      <Icon name={icon} />
      <span className="hud-pill-text">
        {label && !below && <small>{label}</small>}
        <b>{value}</b>
        {label && below && <small>{label}</small>}
      </span>
    </div>
  );
}

/** `bar` — pasek postępu pod całym kafelkiem. */
function Tile({ icon, label, tone, bar, children }: { icon: IconName; label: string; tone?: Tone; bar: number; children: ReactNode }) {
  return (
    <div className={`hud-tile ${tone ?? ""}`}>
      <Icon name={icon} className="hud-tile-ico" />
      <div className="hud-tile-body">
        <span className="hud-tile-label">{label}</span>
        {children}
      </div>
      <Bar value={bar} tone={tone} />
    </div>
  );
}

export type IconName = "sound" | "mute" | "warning" | "road" | "clock" | "pin" | "coffee" | "dots" | "flag" | "wheel" | "parking" | "truck" | "play" | "finish" | "chevron" | "briefcase" | "wrench" | "bed" | "nav" | "music" | "pip" | "search" | WeatherIcon;

const CLOUD = "M7 17a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.3 9.6 3.8 3.8 0 0 1 18 17H7Z";
const ICONS: Record<IconName, string> = {
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  coffee: "M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9ZM17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3",
  dots: "M12 5h.01M12 12h.01M12 19h.01",
  flag: "M5 21V4M5 4h12l-2.5 4 2.5 4H5",
  wheel: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM3.5 10.5 10 12M14 12l6.5-1.5M12 14v7",
  parking: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM10 17V7h3.5a3 3 0 0 1 0 6H10",
  truck: "M2 6h12v10H2zM14 9h4l3 3.5V16h-7M6.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM17.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z",
  play: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM10 8.5v7l5.5-3.5-5.5-3.5Z",
  finish: "M5 21V4M5 4h14v9H5M9 4v9M13 4v9M17 4v9M5 8.5h14",
  chevron: "M9 5l7 7-7 7",
  briefcase: "M3 8h18v11H3zM8 8V5h8v3M3 13h18M10 13v2h4v-2",
  wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z",
  nav: "M3 11l18-8-8 18-2-8-8-2Z",
  sound: "M4 9h4l5-4v14l-5-4H4V9ZM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9h4l5-4v14l-5-4H4V9ZM17 9l5 6M22 9l-5 6",
  warning: "M12 3 2 21h20L12 3ZM12 10v5M12 18h.01",
  road: "M8 3 4 21M16 3l4 18M12 4v3M12 11v3M12 18v3",
  pip: "M3 5h18v14H3zM12 12h7v5h-7z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.3 15.3 21 21",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  bed: "M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 12a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 7 12Z",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  cloud: CLOUD,
  fog: "M4 8h16M2 12h20M5 16h14M8 20h8",
  rain: `${CLOUD}M8 20l-1 2M12 20l-1 2M16 20l-1 2`,
  snow: `${CLOUD}M8 20.5h.01M12 21.5h.01M16 20.5h.01`,
  storm: `${CLOUD}M12.5 17l-2 3h3l-2 3`,
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`hud-ico ${className}`} viewBox="0 0 24 24" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

/** „3 450” — tysiące ze spacją, jak w polskich liczbach. */
const fmtThousands = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function useTick(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const fmtStationKm = (km: number) => (km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km)} km`);

// Safari (macOS, iPadOS) i starsze WebView mają tylko wersje z prefiksem webkit. iPhone nie ma pełnego ekranu dla stron wcale.
type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const fsElement = () => document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null;

export function fullscreenSupported() {
  const el = document.documentElement as WebkitElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

/** Pełny ekran i poziomy obrót — gdy przeglądarka pozwala (wymaga kliknięcia). */
export function enterFullscreen() {
  const el = document.documentElement as WebkitElement;
  const done = () => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> } | undefined)?.lock?.("landscape")?.catch(() => {});
  try {
    // Obrót da się zablokować dopiero w pełnym ekranie — więc po nim, nie równolegle.
    const r = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    if (r instanceof Promise) r.then(done, () => {});
    else done();
  } catch {
    /* brak zgody przeglądarki — HUD działa dalej w oknie */
  }
}

export function exitFullscreen() {
  if (!fsElement()) return;
  const d = document as WebkitDocument;
  try {
    const r = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
    if (r instanceof Promise) r.catch(() => {});
  } catch {
    /* już poza pełnym ekranem */
  }
}

export function toggleFullscreen() {
  if (fsElement()) exitFullscreen();
  else enterFullscreen();
}

/** Czy jesteśmy w pełnym ekranie — kierowca może z niego wyjść gestem, więc słuchamy zmian. */
export function useFullscreen() {
  const [on, setOn] = useState(() => !!fsElement());
  useEffect(() => {
    const update = () => setOn(!!fsElement());
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);
  return on;
}
