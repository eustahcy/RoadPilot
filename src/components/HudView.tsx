import { ReactNode, useEffect, useState } from "react";
import { DeadlinePlan } from "../core/deadline";
import { Live } from "../core/gps";
import { Plan } from "../core/plan";
import { Route } from "../core/route";
import { DriverStatus } from "../core/scenarios";
import { ServiceStatus } from "../core/service";
import { nearestStation, Station, STATIONS } from "../core/stations";
import { describeWeather, isHazard, Weather, WeatherIcon } from "../core/weather";
import { fmtClock, fmtDuration, fmtKm, fmtTime } from "../format";
import { Remote } from "../nearby";
import { GpsStatus, useWakeLock } from "../tracking";

interface Props {
  destination: string;
  route: Route;
  doneKm: number;
  /** Plan, według którego jedziemy: pod rozładunek albo najwcześniejszy przyjazd. */
  plan?: Plan;
  deadline?: DeadlinePlan;
  status: DriverStatus;
  gpsOn: boolean;
  gpsStatus: GpsStatus;
  live: Live | null;
  stations: Remote<Station[]>;
  weather: Remote<Weather>;
  service: ServiceStatus;
  serviceDate: number | null;
  mirror: boolean;
  onMirror: (on: boolean) => void;
  onEnableGps: () => void;
  onExit: () => void;
}

/** Po takim czasie bez odczytu prędkość jest nieaktualna. */
const STALE_MS = 10_000;

export function HudView(p: Props) {
  const now = useTick(1000);
  const [menu, setMenu] = useState(false);
  useWakeLock(true);

  const fresh = p.live && now - p.live.t <= STALE_MS ? p.live : null;
  const speed = fresh?.kmh != null ? Math.round(fresh.kmh) : null;
  const stop = p.plan?.events.find((e) => e.kind === "break" || e.kind === "rest" || e.kind === "weeklyRest");
  const stopIn = stop ? (stop.start - now) / 60_000 : undefined;
  const totalKm = p.doneKm + p.route.totalKm;

  return (
    <div className={`hud ${p.mirror ? "mirror" : ""}`}>
      <header className="hud-top">
        <div className="hud-group">
          <Pill className="p-clock" icon="clock" value={fmtTime(now)} />
          <Pill className="p-dest" icon="pin" label={p.destination || "Do celu"} value={fmtKm(p.route.totalKm)} />
        </div>

        <div className="hud-speed" aria-label="Prędkość">
          <strong className={speed === null ? "none" : ""}>{speed ?? "—"}</strong>
          <span>km/h</span>
        </div>

        <div className="hud-group right">
          <Pill
            className="p-stop"
            icon="coffee"
            label={stop ? (stop.kind === "break" ? "Przerwa" : "Odpoczynek") : "Do celu"}
            value={stop ? (stopIn! <= 1 ? "teraz" : `za ${fmtDuration(stopIn!)}`) : "bez postoju"}
            tone={stop && stopIn! <= 0 ? "bad" : stop && stopIn! <= 30 ? "warn" : undefined}
          />
          <WeatherPill weather={p.weather.data} />
          <div className="hud-menu-wrap">
            <button className="hud-pill hud-icon-btn" aria-label="Menu HUD" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <Icon name="dots" />
            </button>
            {menu && (
              <div className="hud-menu" role="menu">
                <button role="menuitemcheckbox" aria-checked={p.mirror} onClick={() => { p.onMirror(!p.mirror); setMenu(false); }}>
                  {p.mirror ? "✓ " : ""}Odbicie na szybę
                </button>
                <button role="menuitem" onClick={() => { toggleFullscreen(); setMenu(false); }}>Pełny ekran</button>
                <button role="menuitem" onClick={p.onExit}>Wyjdź z HUD</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="hud-mid">
        {!p.gpsOn ? (
          <div className="hud-notice">
            <span>Włącz GPS, żeby widzieć prędkość, najbliższą stację i odliczać kilometry.</span>
            <button className="primary" onClick={p.onEnableGps}>Włącz GPS</button>
          </div>
        ) : p.gpsStatus === "denied" || p.gpsStatus === "unavailable" ? (
          <div className="hud-notice warn">{p.gpsStatus === "denied" ? "Brak zgody na lokalizację — zezwól na nią w przeglądarce." : "GPS niedostępny — wymaga HTTPS."}</div>
        ) : (
          <div className="hud-route">
            <div className="hud-route-labels">
              <span>{p.doneKm > 0 ? `przejechane ${fmtKm(p.doneKm)}` : "start"}</span>
              <span>{stop ? `${stop.kind === "break" ? "przerwa" : "odpoczynek"} ${fmtDuration((stop.end - stop.start) / 60_000)} o ${fmtClock(stop.start, now)} · ok. ${fmtKm(p.doneKm + stop.fromKm)}` : ""}</span>
              <span>{p.destination || "cel"} · {fmtKm(totalKm)}</span>
            </div>
            <div className="hud-progress" aria-label="Postęp trasy">
              <span style={{ width: `${totalKm > 0 ? Math.min(100, (p.doneKm / totalKm) * 100) : 0}%` }} />
              {stop && totalKm > 0 && <i style={{ left: `${Math.min(100, ((p.doneKm + stop.fromKm) / totalKm) * 100)}%` }} title="Postój" />}
            </div>
          </div>
        )}
      </section>

      <footer className="hud-tiles">
        <ArrivalTile plan={p.plan} deadline={p.deadline} now={now} />
        <Tile icon="wheel" label="Jazda dziś — zostało" tone={p.status.driveLeftToday <= 30 ? "warn" : undefined}>
          <strong>{fmtDuration(p.status.driveLeftToday)}</strong>
          <span>do przerwy {fmtDuration(Math.min(p.status.untilBreak, p.status.driveLeftToday))}</span>
        </Tile>
        <StationTile {...p} />
        <ServiceTile s={p.service} date={p.serviceDate} now={now} />
      </footer>
    </div>
  );
}

function ArrivalTile({ plan, deadline, now }: { plan?: Plan; deadline?: DeadlinePlan; now: number }) {
  if (!plan) {
    return (
      <Tile icon="flag" label="Przyjazd" tone={deadline ? "bad" : undefined}>
        <strong>{deadline?.earliest !== undefined ? fmtClock(deadline.earliest, now) : "—"}</strong>
        <span>{deadline ? `nie zdążysz na ${fmtClock(deadline.deadline, now)}` : "brak wykonalnego planu"}</span>
      </Tile>
    );
  }
  return (
    <Tile icon="flag" label="Przyjazd">
      <strong>{fmtClock(plan.arrival, now)}</strong>
      <span>{deadline ? `rozładunek ${fmtClock(deadline.deadline, now)}` : `za ${fmtDuration(Math.max(0, plan.arrival - now) / 60_000)}`}</span>
    </Tile>
  );
}

function StationTile({ gpsOn, live, stations }: Props) {
  let main = "—";
  let sub: string;
  let truck = false;
  const found = live && stations.data ? nearestStation(stations.data, live, live.heading) : undefined;
  if (!gpsOn) sub = "włącz GPS";
  else if (!live) sub = "czekam na pozycję…";
  else if (found) {
    main = found.station.name;
    truck = found.station.truck;
    const where = found.ahead === null ? "w pobliżu" : found.ahead ? "przed Tobą" : "za Tobą";
    sub = `${fmtStationKm(found.km)} · ${where}`;
  } else if (stations.data) sub = `brak w promieniu ${STATIONS.radiusM / 1000} km`;
  else if (stations.error) sub = "nie udało się pobrać — ponowię za chwilę";
  else sub = "szukam stacji…";
  return (
    <Tile icon="fuel" label="Najbliższa stacja">
      <strong className="ellipsis">{main}{truck && <em className="hud-badge">TIR</em>}</strong>
      <span>{sub}</span>
    </Tile>
  );
}

function ServiceTile({ s, date, now }: { s: ServiceStatus; date: number | null; now: number }) {
  if (s.level === "none") {
    return (
      <Tile icon="wrench" label="Serwis">
        <strong className="dim">—</strong>
        <span>ustaw w Ustawieniach</span>
      </Tile>
    );
  }
  const km = s.kmLeft === undefined ? undefined : s.kmLeft > 0 ? `za ${fmtNum(s.kmLeft)} km` : `${fmtNum(-s.kmLeft)} km po`;
  const day =
    s.daysLeft === undefined || date === null
      ? undefined
      : s.daysLeft === 0 ? "dziś" : s.daysLeft === 1 ? "jutro" : s.daysLeft > 0 ? `${fmtDate(date)} · za ${s.daysLeft} dni` : `${fmtDate(date)} · ${-s.daysLeft} dni po`;
  return (
    <Tile icon="wrench" label={s.level === "overdue" ? "Serwis — po terminie" : "Serwis"} tone={s.level === "overdue" ? "bad" : s.level === "soon" ? "warn" : undefined}>
      <strong>{km ?? day}</strong>
      <span>{km ? day ?? "przebieg z GPS" : "termin"}</span>
    </Tile>
  );
}

function WeatherPill({ weather }: { weather?: Weather }) {
  if (!weather) return <Pill className="p-weather" icon="cloud" value="—" />;
  const d = describeWeather(weather.code, weather.isDay);
  return <Pill className="p-weather" icon={d.icon} value={`${Math.round(weather.tempC)}°C`} label={d.text} tone={isHazard(weather) ? "warn" : undefined} />;
}

type Tone = "warn" | "bad" | undefined;

function Pill({ icon, label, value, tone, className = "" }: { icon: IconName; label?: string; value: string; tone?: Tone; className?: string }) {
  return (
    <div className={`hud-pill ${className} ${tone ?? ""}`}>
      <Icon name={icon} />
      <span className="hud-pill-text">
        {label && <small>{label}</small>}
        <b>{value}</b>
      </span>
    </div>
  );
}

function Tile({ icon, label, tone, children }: { icon: IconName; label: string; tone?: Tone; children: ReactNode }) {
  return (
    <div className={`hud-tile ${tone ?? ""}`}>
      <span className="hud-tile-label"><Icon name={icon} />{label}</span>
      {children}
    </div>
  );
}

type IconName = "clock" | "pin" | "coffee" | "dots" | "flag" | "wheel" | "fuel" | "wrench" | WeatherIcon;

const CLOUD = "M7 17a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.3 9.6 3.8 3.8 0 0 1 18 17H7Z";
const ICONS: Record<IconName, string> = {
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  coffee: "M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9ZM17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3",
  dots: "M12 5h.01M12 12h.01M12 19h.01",
  flag: "M5 21V4M5 4h12l-2.5 4 2.5 4H5",
  wheel: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM3.5 10.5 10 12M14 12l6.5-1.5M12 14v7",
  fuel: "M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 3v6.5a1.5 1.5 0 0 0 3 0V9l-3-3",
  wrench: "M14.7 6.3a4 4 0 0 0-5.3 5.2L3.5 17.4a1.5 1.5 0 0 0 0 2.1l1 1a1.5 1.5 0 0 0 2.1 0l5.9-5.9a4 4 0 0 0 5.2-5.3l-2.4 2.4-2.6-.5-.5-2.6 2.5-2.3Z",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  cloud: CLOUD,
  fog: "M4 8h16M2 12h20M5 16h14M8 20h8",
  rain: `${CLOUD}M8 20l-1 2M12 20l-1 2M16 20l-1 2`,
  snow: `${CLOUD}M8 20.5h.01M12 21.5h.01M16 20.5h.01`,
  storm: `${CLOUD}M12.5 17l-2 3h3l-2 3`,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="hud-ico" viewBox="0 0 24 24" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

function useTick(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const fmtNum = (n: number) => Math.round(n).toLocaleString("pl-PL");
const fmtStationKm = (km: number) => (km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km)} km`);
const fmtDate = (t: number) => new Date(t).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

/** Pełny ekran i poziomy obrót — gdy przeglądarka pozwala (wymaga kliknięcia). */
export function enterFullscreen() {
  document.documentElement.requestFullscreen?.()?.catch(() => {});
  (screen.orientation as unknown as { lock?: (o: string) => Promise<void> } | undefined)?.lock?.("landscape")?.catch(() => {});
}

export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function toggleFullscreen() {
  if (document.fullscreenElement) exitFullscreen();
  else enterFullscreen();
}
