import { applyGapAnswer, GapAnswer } from "./core/gapfix";
import { addRecent, SavedPlaces } from "./core/places";
import { TRUCK_SPEED } from "./core/rules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, Auth, isGuest, loadAuth, saveAuth, setGuest, User } from "./api";
import { AuthScreen, ResetPasswordScreen } from "./components/AuthScreen";
import { DriverView } from "./components/DriverView";
import { HistoryCard } from "./components/HistoryCard";
import { setWhere } from "./core/violations";
import { InstallButton } from "./components/InstallButton";
import { ConsentPrompt } from "./components/MapConsent";
import { endRoadworks, sendReport, snapRoad, useTraceCollector } from "./collect";
import { polishVoiceMissing, speak, voiceSupported } from "./voice";
import { GpsCard } from "./components/GpsCard";
import { enterFullscreen, exitFullscreen, HudView } from "./components/HudView";
import { NavView } from "./components/NavView";
import { LicensePanel, licenseStatus } from "./components/License";
import { PlanView } from "./components/PlanView";
import { RouteView } from "./components/RouteView";
import { SettingsCategory, SettingsView } from "./components/SettingsView";
import { ALERTS_REFRESH, POIS_VERSION, fetchRoute, LIVE_TRAFFIC, refreshLiveTraffic, refreshTraffic, TRAFFIC_ON, TRAFFIC_REFRESH, NavAccess, NavPlace, NavRoute, refreshWarnings, viaAhead, voteAlert, withWarnings } from "./nav";
import { locate } from "./core/navmatch";
import { planForDeadline } from "./core/deadline";
import { GPS, recentSpeed } from "./core/gps";
import { remainingSegments, Route, segmentsFromProfile, withLiveSpeed, withSlowStretches } from "./core/route";
import { Better, betterOption, compareScenarios, driverStatus, ScenarioId, whatIfs } from "./core/scenarios";
import { serviceStatus } from "./core/service";
import { planAfterStop } from "./core/stop";
import { fmtClock, fmtTime } from "./format";
import { AppState, defaultState, floorMinute, useNow, usePersistentState } from "./state";
import { useParkings, useRoads, useWeather } from "./nearby";
import { inVtiles, useVtiles } from "./vtiles";
import { dayKey, daySummary } from "./core/history";
import { ongoingInfo, useOngoingNotification } from "./ongoing";
import { resetSync, useSync } from "./sync";
import { changeStop, endDay, finishStop, startDay, startStop, useAutoStop, useGpsTracking } from "./tracking";
import { useWorkReminders } from "./components/Reminders";
import { workStatus } from "./core/workday";
import { FloatLine, useFloating } from "./floating";
import { HudStyle } from "./hudConfig";
import { useFriends } from "./friends";
import { MyRoute, presenceOf } from "./core/friends";
import { ON_ROUTE_M } from "./core/navmatch";
import { FriendsCard } from "./components/Friends";
import { autoTheme } from "./mapStyle";

type Tab = "plan" | "route" | "nav" | "driver" | "history" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "plan", label: "Plan", icon: "M4 12h4l3-8 4 16 3-8h2" },
  { id: "route", label: "Trasa", icon: "M6 20c0-6 12-4 12-10a4 4 0 0 0-8 0M6 20h.01M18 10h.01" },
  { id: "nav", label: "Nawigacja", icon: "M3 11l18-8-8 18-2-8-8-2Z" },
  { id: "driver", label: "Tachograf", icon: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
  { id: "history", label: "Historia", icon: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" },
  { id: "settings", label: "Ustawienia", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4" },
];
/** Tachograf nie ma własnej zakładki na pasku — jest w Trasie (przełącznik Trasa / Tachograf). */
const BAR_TABS = TABS.filter((t) => t.id !== "driver");
const BAR_NAV_AT = BAR_TABS.findIndex((t) => t.id === "nav");
const barActive = (bar: Tab, tab: Tab) => bar === tab || (bar === "route" && tab === "driver");

function App() {
  const [state, setState] = usePersistentState();
  const [tab, setTab] = useState<Tab>("plan");
  // Kategoria Ustawień do otwarcia z innego ekranu (np. „zmień dane pojazdu” w Trasie).
  const [settingsCat, setSettingsCat] = useState<SettingsCategory | null>(null);
  const now = useNow();
  const viewNow = state.planTime ?? floorMinute(now);
  const { trip, settings } = state;
  // W trakcie postoju plan liczymy od jego planowanego końca, ze stanem po zaliczeniu postoju.
  const afterStop = useMemo(() => (state.stop ? planAfterStop(state.driver, state.stop, viewNow) : undefined), [state.driver, state.stop, viewNow]);
  const driver = afterStop?.driver ?? state.driver;
  const planNow = afterStop?.from ?? viewNow;

  const [auth, setAuth] = useState(loadAuth);
  const [guest, setGuestMode] = useState(isGuest);
  // Link z e-maila „zmiana hasła”: ?reset=<token>.
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(location.search).get("reset"));
  const closeReset = () => {
    history.replaceState(null, "", location.pathname);
    setResetToken(null);
  };
  // Sesja wygasła lub konto usunięte: wylogowanie tylko lokalnie, dane w telefonie zostają.
  const dropAuth = useCallback(() => {
    saveAuth(null);
    resetSync();
    setAuth(null);
  }, []);
  const sync = useSync(auth, state, setState, dropAuth);
  // Dane konta (Premium, administrator) odświeżane przy starcie i powrocie do aplikacji — nadane Premium działa bez ponownego logowania.
  const token = auth?.token;
  useEffect(() => {
    if (!token) return;
    const refresh = () =>
      api<{ user: User }>("GET", "/me", undefined, token)
        .then(({ user }) => setAuth((a) => {
          if (!a || a.token !== token || JSON.stringify(a.user) === JSON.stringify(user)) return a;
          const next = { ...a, user };
          saveAuth(next);
          return next;
        }))
        .catch((e) => e instanceof ApiError && e.status === 401 && dropAuth());
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [token, dropAuth]);
  const navAccess: NavAccess = !auth ? "guest" : auth.user.premium ? "premium" : "noPremium";
  // Mapa RoadPilot: ślad i zgłoszenia tylko ze zgodą (zapisaną na koncie).
  const consent = !!auth?.user.dataConsent;
  const setConsentLocal = (dataConsent: boolean) =>
    setAuth((a) => {
      if (!a) return a;
      const next = { ...a, user: { ...a.user, dataConsent } };
      saveAuth(next);
      return next;
    });
  // Poza trasą (albo gdy w tym urządzeniu nie ma trasy, a konto ma cel) HUD prosi o trasę od bieżącej pozycji.
  const [rerouting, setRerouting] = useState(false);
  const navDest = state.navRoute?.to ?? trip.dest;
  /** Nowa trasa od pozycji; `addAvoid` — „Omiń blokadę drogi” (punkty dopisane do omijanych na tej trasie). */
  const reroute = async (addAvoid: { lat: number; lon: number }[] = []) => {
    if (!auth || !navDest || !live || rerouting) return;
    setRerouting(true);
    try {
      // Punkty pośrednie, których jeszcze nie minęliśmy, i omijane blokady zostają na nowej trasie.
      const via = state.navRoute ? viaAhead(state.navRoute, live) : [];
      const avoid = [...(state.navRoute?.avoid ?? []), ...addAvoid].slice(-12);
      const next = await fetchRoute(auth.token, { lat: live.lat, lon: live.lon }, navDest, settings.vehicle, Date.now(), settings.routeType, via, avoid);
      setState((s) => ({ ...s, navRoute: next, trip: tripFromRoute(s.trip, next) }));
    } catch {
      /* brak sieci lub limit — HUD spróbuje ponownie za minutę */
    } finally {
      setRerouting(false);
    }
  };
  /** Odpowiedź „co robiłem bez aplikacji” — tachograf i historia przeliczone od stanu sprzed luki (core/gapfix). */
  const answerGap = (a: GapAnswer) =>
    setState((s) => {
      if (!s.gapReview) return s;
      const r = applyGapAnswer(s.gapReview, a, s.history, Date.now(), s.stop?.start ?? null);
      return { ...s, driver: r.driver, history: r.history, gapReview: { ...s.gapReview, answer: a } };
    });
  /** Wybrana trasa (z wyszukiwarki, ulubionych, ostatnich) — cel trafia na początek „Ostatnich tras”. */
  const chooseRoute = (r: NavRoute) =>
    setState((s) => ({ ...s, navRoute: r, trip: tripFromRoute(s.trip, r), settings: { ...s.settings, places: addRecent(s.settings.places, r.to, Date.now(), r) } }));
  const setPlaces = (places: SavedPlaces) => setState((s) => ({ ...s, settings: { ...s.settings, places } }));
  /** Koniec nawigacji: bez trasy i bez celu — sama trasa bez celu wyznaczyłaby się od razu od nowa (useNavTrack). */
  const endNav = () => setState((s) => ({ ...s, navRoute: null, trip: { ...s.trip, dest: null } }));
  /** Zmiana punktów pośrednich (dodanie z mapy / usunięcie) — trasa od razu od nowa; błąd idzie do ekranu nawigacji. */
  const setVia = async (via: NavPlace[]) => {
    if (!auth || !navDest) return;
    const from = live ? { lat: live.lat, lon: live.lon } : state.navRoute?.from;
    if (!from) throw new Error("Brak pozycji startu — włącz GPS.");
    setRerouting(true);
    try {
      const next = await fetchRoute(auth.token, from, navDest, settings.vehicle, Date.now(), settings.routeType, via, state.navRoute?.avoid);
      setState((s) => ({ ...s, navRoute: next, trip: tripFromRoute(s.trip, next) }));
    } finally {
      setRerouting(false);
    }
  };
  // Trasa sprzed ostrzeżeń (albo z innej wersji) — dociągamy ostrzeżenia raz, bez nowej trasy z TomTom.
  const navRouteAt = state.navRoute?.at;
  const needWarnings = navAccess === "premium" && !!state.navRoute && (!state.navRoute.warnings || !state.navRoute.pois || state.navRoute.poisV !== POIS_VERSION);
  useEffect(() => {
    if (!needWarnings || !auth || !state.navRoute) return;
    const r = state.navRoute;
    withWarnings(auth.token, r, settings.vehicle).then((w) => w.warnings && setState((s) => (s.navRoute?.at === r.at ? { ...s, navRoute: w } : s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needWarnings, navRouteAt]);
  // Nawigacja jest zawsze włączona dla Premium (bez przełącznika w Ustawieniach); cel można wybrać też w HUD.
  const navOn = navAccess === "premium";
  // Własne kafelki mapy (OSM, Polska): czy serwer je ma i czy jesteśmy w ich zasięgu — inaczej kafelki TomTom.
  const vtiles = useVtiles(navOn ? auth?.token : null);
  const dayOff = state.stop?.dayEnd === true;
  const work = workStatus(state.driver.shiftStart, now, settings.work, state.driver.reducedRestsLeft);
  useWorkReminders(settings.work, state.driver.shiftStart, state.driver.reducedRestsLeft, dayOff);

  const { status: gpsStatus, live } = useGpsTracking(settings.gps, setState, auth?.token ?? null, state.pendingGap, !sync.ready);
  useTraceCollector(auth?.token ?? null, consent && settings.gps, live);
  // W czasie jazdy co kilka minut dociągamy ostrzeżenia na odcinek przed nami — świeże zgłoszenia kontroli.
  const liveRef = useRef(live);
  liveRef.current = live;
  const routeRef = useRef(state.navRoute);
  routeRef.current = state.navRoute;
  const hasWarnings = !!state.navRoute?.warnings;
  useEffect(() => {
    if (!navOn || !auth || !hasWarnings) return;
    const id = setInterval(() => {
      const r = routeRef.current;
      const pos = liveRef.current && r ? locate(r.points, liveRef.current) : undefined;
      if (!r || !pos || pos.offM > 200) return;
      refreshWarnings(auth.token, r, pos.km, settings.vehicle).then((w) => w && setState((s) => (s.navRoute?.at === r.at ? { ...s, navRoute: { ...s.navRoute, warnings: w } } : s)));
    }, ALERTS_REFRESH.everyMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navOn, auth?.token, navRouteAt, hasWarnings]);
  // Korki z jazdy kierowców RoadPilot (bez TomTom) co LIVE_TRAFFIC.everyMs — także odcinek, na którym sami stoimy.
  useEffect(() => {
    if (!navOn || !auth || TRAFFIC_ON) return;
    const tick = () => {
      const r = routeRef.current;
      if (!r || document.visibilityState !== "visible") return;
      const pos = liveRef.current ? locate(r.points, liveRef.current) : undefined;
      if (pos && pos.offM > 200) return;
      refreshLiveTraffic(auth.token, r, pos?.km ?? 0).then((t) => t && setState((s) => (s.navRoute?.at === r.at ? { ...s, navRoute: { ...s.navRoute, ...t } } : s)));
    };
    tick();
    const id = setInterval(tick, LIVE_TRAFFIC.everyMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navOn, auth?.token, navRouteAt]);
  // Korki przed nami co TRAFFIC_REFRESH.everyMs (oba silniki); trasa z własnego silnika od razu — sama korków nie ma.
  useEffect(() => {
    if (!navOn || !auth || !TRAFFIC_ON) return;
    const tick = () => {
      const r = routeRef.current;
      if (!r || document.visibilityState !== "visible") return;
      const pos = liveRef.current ? locate(r.points, liveRef.current) : undefined;
      if (pos && pos.offM > 200) return;
      refreshTraffic(auth.token, r, pos?.km ?? 0).then((t) => t && setState((s) => (s.navRoute?.at === r.at ? { ...s, navRoute: { ...s.navRoute, ...t } } : s)));
    };
    if (routeRef.current && routeRef.current.engine !== "tomtom") tick();
    const id = setInterval(tick, TRAFFIC_REFRESH.everyMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navOn, auth?.token, navRouteAt]);
  useAutoStop(settings.gps && settings.autoStop, live, state.stop !== null, setState);
  // Parkingi, drogi i pogoda tylko w HUD — poza nim pozycja nie wychodzi z telefonu.
  const online = state.hud && settings.gps;
  const parkings = useParkings(live, online, now);
  const weather = useWeather(live, online, now);
  const hudItems = settings.hudItems[settings.hudStyle];
  const inVtilesNow = inVtiles(vtiles, live);
  /** Styl własnej mapy (dzień / noc, pojazd do zakazów) — Nawigacja i porównanie tras. */
  const mapStyle = { theme: settings.mapTheme === "auto" || settings.mapTheme === "glass" ? autoTheme(weather.data?.isDay, now) : settings.mapTheme, vehicle: settings.vehicle };
  const roads = useRoads(live, online && hudItems.road, now);
  const today = state.history.find((d) => d.date === dayKey(now));
  const avgKmh = today ? daySummary(today).avgKmh : undefined;
  const recentKmh = settings.gps ? recentSpeed(state.track, now) : undefined;
  // Przyjazd z aktualnego tempa tylko wtedy, gdy auto faktycznie jedzie — na postoju i w korku zwykłe prędkości.
  const liveKmh = settings.liveEta && recentKmh !== undefined && recentKmh >= GPS.minLiveKmh ? Math.round(recentKmh) : undefined;

  const route = useMemo(() => {
    const full = trip.profile === "custom" ? trip.segments : segmentsFromProfile(trip.distance, trip.profile);
    // Korki przed nami (z jazdy kierowców) — wolniej na ich odcinkach; km trasy nawigacji → km pozostałej trasy (od trip.doneKm).
    const jams = (state.navRoute?.traffic ?? []).filter((t) => t.live && t.kmh !== undefined && t.toKm > trip.doneKm).map((t) => ({ fromKm: t.km - trip.doneKm, toKm: t.toKm - trip.doneKm, kmh: t.kmh! }));
    const segments = withSlowStretches(remainingSegments(full, trip.doneKm), jams);
    return new Route(liveKmh ? withLiveSpeed(segments, liveKmh, GPS.liveEtaMin) : segments, settings.speeds, trip.trafficPct);
  }, [trip, settings.speeds, liveKmh, state.navRoute?.traffic]);

  const options = { allowExtension: settings.allowExtension, allowReducedRest: settings.allowReducedRest };
  const comparison = useMemo(() => compareScenarios(route, driver, planNow, options), [route, driver, planNow, options.allowExtension, options.allowReducedRest]);
  const hints = useMemo(() => whatIfs(route, driver, planNow, options), [route, driver, planNow, options.allowExtension, options.allowReducedRest]);
  const status = driverStatus(driver, planNow);
  // Jedziemy (średnia z GPS z ostatnich minut, bez ręcznego postoju) — plan pod awizację nie każe wtedy stawać ani „wyjeżdżać później”.
  const moving = settings.gps && recentKmh !== undefined && recentKmh >= GPS.minLiveKmh && !(state.stop && !state.stop.auto) && state.planTime === null;
  const deadline = useMemo(
    () => (trip.unloadAt !== null ? planForDeadline(route, driver, planNow, options, trip.unloadAt, trip.unloadBufferMin, moving) : undefined),
    [route, driver, planNow, trip.unloadAt, trip.unloadBufferMin, options.allowExtension, options.allowReducedRest, moving],
  );

  const best = comparison.scenarios.find((s) => s.id === comparison.bestId);
  // Wybór kierowcy wygrywa z zaleceniem (także z planem pod rozładunek), o ile scenariusz jest wykonalny.
  const chosen = comparison.scenarios.find((s) => s.id === state.choice && s.plan.feasible);
  const activePlan = chosen?.plan ?? deadline?.plan ?? best?.plan;
  const choose = (choice: ScenarioId | null) => setState((s) => ({ ...s, choice }));
  // Pod rozładunek wcześniejszy przyjazd nic nie daje — wtedy nie podpowiadamy szybszego wariantu.
  const better = activePlan && activePlan !== deadline?.plan ? betterOption(comparison, activePlan, hints) : undefined;
  const pickBetter = (b: Better) =>
    b.kind === "scenario" ? choose(b.id) : setState((s) => ({ ...s, settings: { ...s.settings, [b.option]: true } }));
  const service = serviceStatus(settings.service, state.odoKm, now);
  // Znajomi: nasza obecność (pozycja, postój, cel, tachograf) tylko z kontem, przy włączonym GPS i udostępnianiu.
  const presence = useMemo(() => presenceOf(live, state.stop, state.driver.shiftStart, status, activePlan, trip.destination, route.totalKm), [live, state.stop, state.driver.shiftStart, status, activePlan, trip.destination, route.totalKm]);
  const friends = useFriends(auth?.token ?? null, settings.friendsShare && settings.gps, presence);
  const me = live ? { lat: live.lat, lon: live.lon } : null;
  // Nasza pozycja na trasie z nawigacji — karta znajomych liczy wtedy km po trasie.
  const myRoute = useMemo<MyRoute | undefined>(() => {
    if (!state.navRoute || !live) return undefined;
    const pos = locate(state.navRoute.points, live);
    return pos && pos.offM <= ON_ROUTE_M ? { points: state.navRoute.points, km: pos.km } : undefined;
  }, [state.navRoute, live]);

  // Pływające okienko: przyjazd i na zmianę przerwa / odpoczynek / koniec pracy — z tych samych danych co HUD.
  const floatLines: FloatLine[] = [];
  if (state.stop?.targetMin != null) floatLines.push({ label: "Koniec postoju", at: state.stop.start + state.stop.targetMin * 60_000, kind: "clock" });
  const nextBreak = activePlan?.events.find((e) => e.kind === "break");
  const nextRest = activePlan?.events.find((e) => e.kind === "rest" || e.kind === "weeklyRest");
  if (nextBreak && (!nextRest || nextBreak.start < nextRest.start)) floatLines.push({ label: "Do przerwy", at: nextBreak.start, kind: "until" });
  if (nextRest) floatLines.push({ label: "Do odpoczynku", at: nextRest.start, kind: "until" });
  if (!dayOff) floatLines.push({ label: "Koniec pracy", at: work.phase === "extended" && work.extendedEnd ? work.extendedEnd : work.end, kind: "clock" });
  const floating = useFloating({ kmh: live?.kmh ?? null, kmhAt: live?.t ?? 0, arrival: activePlan?.arrival, lines: floatLines }, state.hud && hudItems.floating);

  const setOngoing = (ongoing: boolean) => setState((s) => ({ ...s, settings: { ...s.settings, ongoing } }));
  useOngoingNotification(settings.ongoing, ongoingInfo(activePlan, status, state.stop, now), () => setOngoing(false));

  const go = (t: Tab) => {
    // Nawigacja to osobny ekran na cały ekran (jak HUD), nie zakładka w powłoce.
    if (t === "nav") {
      enterFullscreen();
      setState((s) => ({ ...s, navOpen: true, planTime: null }));
      return;
    }
    setTab(t);
    setSettingsCat(null);
    window.scrollTo({ top: 0 });
  };
  const tabButton = (t: (typeof TABS)[number]) => (
    <button key={t.id} className={barActive(t.id, tab) ? "active" : ""} onClick={() => go(t.id)} aria-current={barActive(t.id, tab) ? "page" : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden><path d={t.icon} /></svg>
      <span>{t.label}</span>
    </button>
  );
  const exitNav = () => {
    exitFullscreen();
    setState((s) => ({ ...s, navOpen: false }));
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
    onStart: (start: number, targetMin: number | null) => setState((s) => startStop(s, start, targetMin)),
    onEnd: (end: number) => setState((s) => finishStop(s, end)),
    onCancel: () => setState((s) => ({ ...s, stop: null })),
    onTarget: (targetMin: number | null) => setState((s) => changeStop(s, { targetMin })),
    onEndDay: () => setState((s) => endDay(s, Date.now())),
    onStartDay: () => setState((s) => startDay(s, Date.now())),
  };
  const exitHud = () => {
    exitFullscreen();
    setState((s) => ({ ...s, hud: false }));
  };

  const signIn = (a: Auth) => {
    saveAuth(a);
    resetSync();
    setGuest(false);
    setGuestMode(false);
    setAuth(a);
  };
  const continueAsGuest = () => {
    setGuest(true);
    setGuestMode(true);
  };
  // Wylogowanie: najpierw wysyłamy zaległe zmiany, potem czyścimy telefon — dane zostają na koncie.
  /** Konto po zmianie na serwerze (np. licencja z klucza) — zapisane w telefonie. */
  const setUser = (user: User) =>
    setAuth((a) => {
      if (!a) return a;
      const next = { ...a, user };
      saveAuth(next);
      return next;
    });
  const signOut = async () => {
    if (auth) {
      await sync.push();
      await api("POST", "/logout", undefined, auth.token).catch(() => {});
    }
    dropAuth();
    setState(defaultState());
    setGuest(false);
    setGuestMode(false);
  };
  const deleteAccount = async (password: string) => {
    if (!auth) return;
    await api("DELETE", "/account", { password }, auth.token);
    dropAuth();
    setGuest(false);
    setGuestMode(false);
  };

  if (resetToken) return <ResetPasswordScreen token={resetToken} onAuth={(a) => { closeReset(); signIn(a); }} onCancel={closeReset} />;
  if (!auth && !guest) return <AuthScreen onAuth={signIn} onGuest={continueAsGuest} />;


  if (state.navOpen) {
    return (
      <NavView
        gapReview={state.gapReview}
        onGapAnswer={answerGap}
        license={{ status: licenseStatus(auth?.user), page: <LicensePanel token={auth?.token ?? null} user={auth?.user ?? null} onUser={setUser} /> }}
        settings={{ value: settings, onChange: (patch) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })) }}
        mapMode={settings.navMap}
        onMapMode={(navMap) => setState((s) => ({ ...s, settings: { ...s.settings, navMap } }))}
        nav={navOn ? { route: state.navRoute, dest: navDest, rerouting, onReroute: () => reroute(), onAvoid: reroute, onVia: setVia, onEnd: endNav } : undefined}
        planner={navOn && auth ? {
          token: auth.token,
          vehicle: settings.vehicle,
          routeType: settings.routeType,
          position: live ? { lat: live.lat, lon: live.lon } : null,
          onRoute: chooseRoute,
          mapStyle,
          places: settings.places,
          onPlaces: setPlaces,
        } : undefined}
        voice={{
          supported: voiceSupported(),
          on: settings.navVoice,
          toggle: () => {
            const on = !settings.navVoice;
            // iPhone odblokowuje mowę tylko w dotknięciu — od razu mówimy potwierdzenie.
            if (on) speak("Komunikaty głosowe włączone.");
            if (on && polishVoiceMissing()) {
              alert("Telefon nie ma polskiego głosu, więc komunikaty mogą być po angielsku.\n\nSamsung: Ustawienia → Zarządzanie ogólne → Zamiana tekstu na mowę → wybierz „Usługi Google” (Mowa Google) i pobierz język polski. Potem uruchom RoadPilot ponownie.");
            }
            else if (voiceSupported()) speechSynthesis.cancel();
            setState((s) => ({ ...s, settings: { ...s.settings, navVoice: on } }));
          },
        }}
        mapToken={navOn ? auth?.token : undefined}
        mapVector={navOn && inVtilesNow ? mapStyle : undefined}
        report={consent && auth ? {
          onSend: async (kind, value, at, note) => {
            // Z mapy: punkt na osi drogi, bez kierunku (nie wiemy, którą stroną jedzie się przez ograniczenie). Roboty: rodzaj w note.
            if (at) return await sendReport(auth.token, { kind, lat: at.lat, lon: at.lon, heading: null, value, note: note ?? `mapa${at.name ? `: ${at.name}` : ""}` });
            if (!live) throw new Error("Brak pozycji GPS.");
            return await sendReport(auth.token, { kind, lat: live.lat, lon: live.lon, heading: live.heading, value, note: note ?? "" });
          },
          onWorksEnd: async (id) => {
            if (!live) throw new Error("Brak pozycji GPS.");
            return (await endRoadworks(auth.token, id, live)).km;
          },
          onVote: async (w, vote) => {
            await voteAlert(auth.token, w, vote);
          },
          onSnap: (at) => snapRoad(auth.token, at),
          onBadTurn: async (t) => {
            await sendReport(auth.token, { kind: "bad_turn", lat: t.lat, lon: t.lon, heading: t.heading, value: null, note: t.note });
          },
        } : undefined}
        friends={auth ? friends.friends : undefined}
        live={live}
        gpsOn={settings.gps}
        gpsStatus={gpsStatus}
        onEnableGps={() => setGps(true)}
        route={route}
        plan={activePlan}
        deadline={deadline}
        stopControls={stopProps}
        vehicleMaxKmh={settings.vehicle.maxKmh}
        truck={settings.vehicle.weightKg > TRUCK_SPEED.minWeightKg}
        ahead={{ km: settings.aheadKm, strip: settings.aheadStrip }}
        onExit={exitNav}
      />
    );
  }

  if (state.hud) {
    return (
      <HudView
        origin={trip.origin}
        destination={trip.destination}
        route={route}
        doneKm={trip.doneKm}
        plan={activePlan}
        deadline={deadline}
        status={status}
        driver={driver}
        gpsOn={settings.gps}
        gpsStatus={gpsStatus}
        live={live}
        weather={weather}
        parkings={parkings}
        mirror={settings.hudMirror}
        roads={hudItems.road ? roads.data : undefined}
        hudStyle={settings.hudStyle}
        items={hudItems}
        onStyle={(hudStyle: HudStyle) => setState((s) => ({ ...s, settings: { ...s.settings, hudStyle } }))}
        floating={floating}
        avgKmh={avgKmh}
        animation={settings.hudAnimation}
        onAnimation={(hudAnimation) => setState((s) => ({ ...s, settings: { ...s.settings, hudAnimation } }))}
        onMirror={(hudMirror) => setState((s) => ({ ...s, settings: { ...s.settings, hudMirror } }))}
        onEnableGps={() => setGps(true)}
        onExit={exitHud}
        stopControls={stopProps}
        work={dayOff ? undefined : work}
        service={service}
        musicApp={settings.musicApp}
        better={better}
        onBetter={pickBetter}
        report={consent && auth ? {
          onSend: async (kind, value) => {
            if (!live) throw new Error("Brak pozycji GPS.");
            await sendReport(auth.token, { kind, lat: live.lat, lon: live.lon, heading: live.heading, value, note: "" });
          },
          onVote: async (w, vote) => {
            await voteAlert(auth.token, w, vote);
          },
        } : undefined}
        friends={auth ? friends.friends : undefined}
        navRoute={state.navRoute}
        limitToken={navOn ? auth?.token : undefined}
        vehicleMaxKmh={settings.vehicle.maxKmh}
        truck={settings.vehicle.weightKg > TRUCK_SPEED.minWeightKg}
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
        <InstallButton />
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
        {tab === "plan" && auth && !consent && <ConsentPrompt token={auth.token} onChange={setConsentLocal} />}
        {tab === "plan" && (
          <PlanView
            state={state}
            route={route}
            comparison={comparison}
            hints={hints}
            status={status}
            planNow={viewNow}
            deadline={deadline}
            chosen={chosen}
            activePlan={activePlan}
            onChoose={choose}
            ongoing={settings.ongoing}
            work={dayOff ? undefined : work}
            service={service}
            onOngoing={setOngoing}
            liveKmh={liveKmh}
            stopControls={stopProps}
            friends={auth ? <FriendsCard api={friends} me={me} route={myRoute} now={now} onManage={() => { go("settings"); setSettingsCat("friends"); }} /> : null}
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
        {(tab === "route" || tab === "driver") && (
          <div className="subtabs" role="tablist">
            <button role="tab" aria-selected={tab === "route"} className={tab === "route" ? "active" : ""} onClick={() => go("route")}>Trasa</button>
            <button role="tab" aria-selected={tab === "driver"} className={tab === "driver" ? "active" : ""} onClick={() => go("driver")}>Tachograf</button>
          </div>
        )}
        {tab === "route" && (
          <RouteView
            trip={trip}
            route={route}
            onChange={(t) => setState((s) => ({ ...s, trip: t }))}
            nav={{
              access: navAccess,
              routeType: settings.routeType,
              token: auth?.token ?? null,
              enabled: navAccess === "premium",
              vehicle: settings.vehicle,
              dest: trip.dest,
              route: state.navRoute,
              position: settings.gps && live ? { lat: live.lat, lon: live.lon } : null,
              onDest: (dest) => setState((s) => ({ ...s, trip: { ...s.trip, dest, destination: dest ? dest.label : s.trip.destination } })),
              onRoute: chooseRoute,
              places: settings.places,
              onPlaces: setPlaces,
              onClear: endNav,
              onSettings: () => { go("settings"); setSettingsCat("vehicle"); },
              mapStyle,
            }}
          />
        )}
        {tab === "driver" && <DriverView driver={state.driver} planNow={viewNow} onChange={(d) => setState((s) => ({ ...s, driver: d }))} />}
        {tab === "history" && <HistoryCard history={state.history} now={now} gpsOn={settings.gps} onClear={() => setState((s) => ({ ...s, history: [] }))} token={auth?.token ?? null} onWhere={(id, where) => setState((s) => ({ ...s, history: setWhere(s.history, id, where) }))} gapReview={state.gapReview} onGapAnswer={answerGap} />}
        {tab === "settings" && (
          <SettingsView
            key={settingsCat ?? "none"}
            initialCategory={settingsCat}
            state={state}
            now={now}
            onSettings={(st) => setState((s) => ({ ...s, settings: st }))}
            onPlanTime={(t) => setState((s) => ({ ...s, planTime: t }))}
            onReset={() => setState(defaultState())}
            navAccess={navAccess}
            friends={{ api: auth ? friends : null, gpsOn: settings.gps, me }}
            account={{
              user: auth?.user ?? null,
              token: auth?.token ?? null,
              onConsent: setConsentLocal,
              sync: sync.status,
              onLogin: () => {
                setGuest(false);
                setGuestMode(false);
              },
              onLogout: signOut,
              onSyncNow: sync.push,
              onDelete: deleteAccount,
              onUser: setUser,
            }}
          />
        )}

        {tab !== "plan" && (
          <button className="primary full" onClick={() => go("plan")}>Pokaż plan</button>
        )}

        <button className="support-link" onClick={() => { go("settings"); setSettingsCat("support"); }}>♥ Wesprzyj rozwój RoadPilot</button>
        <p className="disclaimer">
          RoadPilot jest asystentem planowania. Nie zastępuje homologowanego tachografu ani oficjalnej rejestracji czasu pracy — dane
          i zgodność z przepisami zawsze weryfikuj z tachografem. Limity wg rozporządzenia (WE) 561/2006.
        </p>
      </main>

      <nav className="tabbar">
        {/* Nawigacja na środku w zielonej bańce — po bokach pozostałe zakładki. */}
        <div className="tabbar-side">{BAR_TABS.slice(0, BAR_NAV_AT).map(tabButton)}</div>
        <button className="tabbar-nav" onClick={() => go("nav")}>
          <i><svg viewBox="0 0 24 24" aria-hidden><path d={BAR_TABS[BAR_NAV_AT].icon} /></svg></i>
          <span>{BAR_TABS[BAR_NAV_AT].label}</span>
        </button>
        <div className="tabbar-side">{BAR_TABS.slice(BAR_NAV_AT + 1).map(tabButton)}</div>
      </nav>
    </div>
  );
}

/** Trasa z nawigacji zasila silnik przerw: odcinki wg typu drogi (zaokrąglone do 0,1 km), licznik GPS od zera. */
function tripFromRoute(trip: AppState["trip"], r: NavRoute): AppState["trip"] {
  const segments = r.segments.map((x) => ({ type: x.type, km: Math.round(x.km * 10) / 10, ...(x.kmh ? { kmh: x.kmh } : {}) })).filter((x) => x.km > 0);
  return { ...trip, dest: r.to, destination: r.to.label, profile: "custom", segments, distance: Math.round(r.lengthKm * 10) / 10, doneKm: 0 };
}

export default App;
