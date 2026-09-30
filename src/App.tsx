import { useMemo, useState } from "react";
import { DriverView } from "./components/DriverView";
import { GpsCard } from "./components/GpsCard";
import { enterFullscreen, exitFullscreen, HudView } from "./components/HudView";
import { PlanView } from "./components/PlanView";
import { RouteView } from "./components/RouteView";
import { SettingsView } from "./components/SettingsView";
import { planForDeadline } from "./core/deadline";
import { GPS, recentSpeed, uniformSpeeds } from "./core/gps";
import { remainingSegments, Route, segmentsFromProfile } from "./core/route";
import { compareScenarios, driverStatus, whatIfs } from "./core/scenarios";
import { serviceStatus } from "./core/service";
import { planAfterStop } from "./core/stop";
import { fmtClock, fmtTime } from "./format";
import { defaultState, floorMinute, useNow, usePersistentState } from "./state";
import { useStations, useWeather } from "./nearby";
import { changeStop, finishStop, startStop, useGpsTracking } from "./tracking";

type Tab = "plan" | "route" | "driver" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "plan", label: "Plan", icon: "M4 12h4l3-8 4 16 3-8h2" },
  { id: "route", label: "Trasa", icon: "M6 20c0-6 12-4 12-10a4 4 0 0 0-8 0M6 20h.01M18 10h.01" },
  { id: "driver", label: "Tachograf", icon: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
  { id: "settings", label: "Ustawienia", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4" },
];

function App() {
  const [state, setState] = usePersistentState();
  const [tab, setTab] = useState<Tab>("plan");
  const now = useNow();
  const viewNow = state.planTime ?? floorMinute(now);
  const { trip, settings } = state;
  // W trakcie postoju plan liczymy od jego planowanego końca, ze stanem po zaliczeniu postoju.
  const afterStop = useMemo(() => (state.stop ? planAfterStop(state.driver, state.stop, viewNow) : undefined), [state.driver, state.stop, viewNow]);
  const driver = afterStop?.driver ?? state.driver;
  const planNow = afterStop?.from ?? viewNow;

  const { status: gpsStatus, live } = useGpsTracking(settings.gps, setState);
  // Stacje i pogoda tylko w HUD — poza nim pozycja nie wychodzi z telefonu.
  const online = state.hud && settings.gps;
  const stations = useStations(live, online, now);
  const weather = useWeather(live, online, now);
  const recentKmh = settings.gps ? recentSpeed(state.track, now) : undefined;
  // Przyjazd z aktualnego tempa tylko wtedy, gdy auto faktycznie jedzie — na postoju i w korku zwykłe prędkości.
  const liveKmh = settings.liveEta && recentKmh !== undefined && recentKmh >= GPS.minLiveKmh ? Math.round(recentKmh) : undefined;

  const route = useMemo(() => {
    const full = trip.profile === "custom" ? trip.segments : segmentsFromProfile(trip.distance, trip.profile);
    const segments = remainingSegments(full, trip.doneKm);
    return liveKmh ? new Route(segments, uniformSpeeds(liveKmh)) : new Route(segments, settings.speeds, trip.trafficPct);
  }, [trip, settings.speeds, liveKmh]);

  const options = { allowExtension: settings.allowExtension, allowReducedRest: settings.allowReducedRest };
  const comparison = useMemo(() => compareScenarios(route, driver, planNow, options), [route, driver, planNow, options.allowExtension, options.allowReducedRest]);
  const hints = useMemo(() => whatIfs(route, driver, planNow, options), [route, driver, planNow, options.allowExtension, options.allowReducedRest]);
  const status = driverStatus(driver, planNow);
  const deadline = useMemo(
    () => (trip.unloadAt !== null ? planForDeadline(route, driver, planNow, options, trip.unloadAt, trip.unloadBufferMin) : undefined),
    [route, driver, planNow, trip.unloadAt, trip.unloadBufferMin, options.allowExtension, options.allowReducedRest],
  );

  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const setGps = (on: boolean) => setState((s) => ({ ...s, settings: { ...s.settings, gps: on }, track: on ? s.track : null }));
  // HUD pokazuje jazdę na żywo — zawsze od teraz, nie od godziny wybranej do planowania.
  const enterHud = () => {
    enterFullscreen();
    setState((s) => ({ ...s, hud: true, planTime: null }));
  };
  const stopProps = {
    stop: state.stop,
    driver: state.driver,
    now,
    onStart: (start: number, targetMin: number) => setState((s) => startStop(s, start, targetMin)),
    onEnd: (end: number) => setState((s) => finishStop(s, end)),
    onCancel: () => setState((s) => ({ ...s, stop: null })),
    onTarget: (targetMin: number) => setState((s) => changeStop(s, { targetMin })),
  };
  const exitHud = () => {
    exitFullscreen();
    setState((s) => ({ ...s, hud: false }));
  };

  if (state.hud) {
    const best = comparison.scenarios.find((s) => s.id === comparison.bestId);
    return (
      <HudView
        destination={trip.destination}
        route={route}
        doneKm={trip.doneKm}
        plan={deadline ? deadline.plan : best?.plan}
        deadline={deadline}
        status={status}
        gpsOn={settings.gps}
        gpsStatus={gpsStatus}
        live={live}
        stations={stations}
        weather={weather}
        service={serviceStatus(settings.service, state.odoKm, now)}
        serviceDate={settings.service.date}
        mirror={settings.hudMirror}
        onMirror={(hudMirror) => setState((s) => ({ ...s, settings: { ...s.settings, hudMirror } }))}
        onEnableGps={() => setGps(true)}
        onExit={exitHud}
        stopControls={stopProps}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">Road<span>Pilot</span></div>
          <div className="eyebrow">Asystent planowania jazdy</div>
        </div>
        <button className="hud-btn" onClick={enterHud} title="Tryb HUD — widok do jazdy">HUD</button>
        <div className="clock" title={state.planTime ? "Planowanie na wybraną godzinę" : "Aktualna godzina"}>
          {state.planTime ? (
            <button className="clock-custom" onClick={() => setState((s) => ({ ...s, planTime: null }))}>
              <strong>{fmtClock(state.planTime, now)}</strong>
              <span>plan · wróć do teraz</span>
            </button>
          ) : (
            <>
              <strong>{fmtTime(now)}</strong>
              <span>teraz</span>
            </>
          )}
        </div>
      </header>

      <main className="content">
        {tab === "plan" && (
          <PlanView
            state={state}
            route={route}
            comparison={comparison}
            hints={hints}
            status={status}
            planNow={viewNow}
            deadline={deadline}
            liveKmh={liveKmh}
            stopControls={stopProps}
            gps={
              <GpsCard
                on={settings.gps}
                status={gpsStatus}
                doneKm={trip.doneKm}
                leftKm={route.totalKm}
                recentKmh={recentKmh}
                liveEta={settings.liveEta}
                liveUsed={liveKmh !== undefined}
                // Wyłączenie zapomina ostatnią pozycję — po ponownym włączeniu nie doliczamy drogi z przerwy.
                onToggle={setGps}
                onLiveEta={(liveEta) => setState((s) => ({ ...s, settings: { ...s.settings, liveEta } }))}
              />
            }
            goTo={go}
            onOptions={(o) => setState((s) => ({ ...s, settings: { ...s.settings, ...o } }))}
            onOption={(option, value) => setState((s) => ({ ...s, settings: { ...s.settings, [option]: value } }))}
          />
        )}
        {tab === "route" && <RouteView trip={trip} route={route} onChange={(t) => setState((s) => ({ ...s, trip: t }))} />}
        {tab === "driver" && <DriverView driver={state.driver} planNow={viewNow} onChange={(d) => setState((s) => ({ ...s, driver: d }))} />}
        {tab === "settings" && (
          <SettingsView
            state={state}
            now={now}
            onSettings={(st) => setState((s) => ({ ...s, settings: st }))}
            onPlanTime={(t) => setState((s) => ({ ...s, planTime: t }))}
            onReset={() => setState(defaultState())}
          />
        )}

        {tab !== "plan" && (
          <button className="primary full" onClick={() => go("plan")}>Pokaż plan</button>
        )}

        <p className="disclaimer">
          RoadPilot jest asystentem planowania. Nie zastępuje homologowanego tachografu ani oficjalnej rejestracji czasu pracy — dane
          i zgodność z przepisami zawsze weryfikuj z tachografem. Limity wg rozporządzenia (WE) 561/2006.
        </p>
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => go(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden><path d={t.icon} /></svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
