import { ReactNode, useEffect, useState } from "react";
import { DeadlinePlan } from "../core/deadline";
import { Friend } from "../core/friends";
import { Live } from "../core/gps";
import { bearingAtKm, legalLimitAt, locate, NAV, nextInstruction, pointAtKm, speedTone } from "../core/navmatch";
import { Plan } from "../core/plan";
import { Route } from "../core/route";
import { fmtDuration } from "../core/scenarios";
import { fmtClock, fmtKm } from "../format";
import { insertVia, isAhead, NavPlace, NavRoute, RoutePoi, RouteWarning, useLimitHere, useNearbyPois, viaAhead, warningText } from "../nav";
import { placesAhead } from "../core/stations";
import { AheadStrip } from "../state";
import { GpsStatus, useWakeLock } from "../tracking";
import { SectionVoice, useNavVoice } from "../voice";
import { AlertVote } from "./AlertVote";
import { GlVector } from "./GlMap";
import { fmtDist, HudNav, HudNavData, HudRouteMap, ManeuverIcon, MapBrowse, NavTrack, PinInfo, POI_TITLE, poiVisible, useNavTrack } from "./HudNav";
import { RULES } from "../core/rules";
import { LatLon, MAX_VIEW_ZOOM, MIN_VIEW_ZOOM } from "./MapView";
import { HudPlanner, HudRoutePicker, PickerCategory, PickerStart } from "./HudRoutePicker";
import { MenuItem, MenuPage, NavMenu } from "./NavMenu";
import { arrivalInfo, fullscreenSupported, Icon, isStop, RouteLine, routeRefs, STALE_MS, toggleFullscreen, useFullscreen, useTick } from "./HudView";
import { ReportKind, SnappedRoad } from "../collect";
import { ReportSheet } from "./ReportSheet";
import { GapSheet } from "./GapSheet";
import { GapAnswer, GapReview } from "../core/gapfix";
import { SectionLine, SectionPanel, sectionKey, sectionView, useSectionRun } from "./SectionControl";
import { sectionLimit } from "../core/section";
import { ActiveStopPanel, confirmStartDay, fmtTimer, StopControlsProps, StopPicker } from "./StopControls";
import { NavSettingsPage, SettingsSection } from "./NavSettings";
import { isFavorite, toggleFavorite } from "../core/places";
import { Settings } from "../state";

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
  /** Zgłoszenia: `at` = miejsce przytrzymane na mapie (przyklejone do drogi przez onSnap), bez niego — nasza pozycja. */
  report?: { onSend: (kind: ReportKind, value: number | null, at?: SnappedRoad) => Promise<void>; onVote: (w: RouteWarning, vote: 1 | -1) => Promise<void>; onSnap: (at: LatLon) => Promise<SnappedRoad | null>; /** „Zły manewr”: punkt tuż za manewrem, kierunek wyjazdu i opis manewru. */ onBadTurn?: (t: { lat: number; lon: number; heading: number; note: string }) => Promise<void> };
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
  /** Pojazd > 3,5 t: limity ciężarówki (50 / 70 / 80) — wyższy znak go nie dotyczy. */
  truck: boolean;
  /** „Po drodze”: zasięg listy (km) i najbliższe miejsca pod prędkością (Ustawienia → Pojazd i nawigacja). */
  ahead: { km: number; strip: AheadStrip };
  onExit: () => void;
  /** Mapa 3D (pochylona) / 2D (płaska, oddalona) — zapamiętywane w ustawieniach. */
  mapMode: "3d" | "2d";
  onMapMode: (m: "3d" | "2d") => void;
  /** Luka do wyjaśnienia (aplikacja była zamknięta) i zapis odpowiedzi — przelicza tachograf. */
  gapReview?: GapReview | null;
  onGapAnswer?: (a: GapAnswer) => void;
  /** Ustawienia prosto z menu ⋯ (pojazd, drogi, mapa, „po drodze”). */
  settings?: { value: Settings; onChange: (patch: Partial<Settings>) => void };
}

function NavVoice({ nav, track, kmh, enabled, section }: { nav?: HudNavData; track: NavTrack; kmh: number | null; enabled: boolean; section: SectionVoice }) {
  const route = nav?.route ?? null;
  const pos = track.pos;
  const next = route && pos && !track.off ? nextInstruction(route.instructions, pos.km) : undefined;
  useNavVoice(enabled && !!route, next, pos?.km, route?.warnings, kmh, section, route?.lanes, route?.pois);
  return null;
}

const NO_NAV: HudNavData = { route: null, dest: null, rerouting: false, onReroute: () => {} };

export function NavView(p: NavViewProps) {
  const now = useTick(1000);
  /** Menu „więcej” (zgłoszenie, postój, dzień, pełny ekran, koniec nawigacji). */
  const [menuPage, setMenuPage] = useState<MenuKey | null>(null);
  const menu = menuPage !== null;
  const setMenu = (open: boolean) => setMenuPage(open ? "main" : null);
  /** Telefon pionowo: kafelki „przerwa” i „trasa” rozwinięte pod przyjazdem. */
  const [tilesOpen, setTilesOpen] = useState(false);
  /** Lista najbliższych manewrów (przycisk „›” na karcie). */
  const [maneuvers, setManeuvers] = useState(false);
  /** Pytanie „co robiłeś, gdy aplikacja była zamknięta” — samo przy niewyjaśnionej luce (także nowej, po powrocie z tła). */
  const [gapOpen, setGapOpen] = useState(false);
  const gapKey = p.gapReview && !p.gapReview.answer ? p.gapReview.gap.start : null;
  useEffect(() => {
    if (gapKey !== null) setGapOpen(true);
  }, [gapKey]);
  const [sheet, setSheet] = useState(false);
  const [reporting, setReporting] = useState(false);
  /** Zgłoszenie z mapy: droga przy przytrzymanym miejscu — null = zgłoszenie z naszej pozycji. */
  const [reportAt, setReportAt] = useState<SnappedRoad | null>(null);
  const [warnList, setWarnList] = useState(false);
  const [aheadList, setAheadList] = useState(false);
  /** Filtr listy „Po drodze” przy otwarciu (kategoria z wyszukiwarki). */
  const [aheadFilter, setAheadFilter] = useState<PickerCategory>("all");
  /** Wyszukiwarka celu: null = zamknięta; start = od czego zaczynamy (zakładka, od razu dom). */
  const [planning, setPlanning] = useState<PickerStart | null>(null);
  const [sideOpen, setSideOpen] = useState(() => readSideOpen());
  const setSide = (open: boolean) => { setSideOpen(open); try { localStorage.setItem(SIDE_KEY, open ? "1" : "0"); } catch { /* bez pamięci — tylko na tę sesję */ } };
  const [zoomOffset, setZoomOffset] = useState(0);
  /** Mapa przesunięta palcem — null = prowadzenie (mapa jedzie za nami). */
  const [browse, setBrowse] = useState<MapBrowse | null>(null);
  /** Dotknięta pinezka albo miejsce przytrzymane na mapie (propozycja punktu pośredniego). */
  const [pin, setPin] = useState<PinInfo | null>(null);
  const [hold, setHold] = useState<LatLon | null>(null);
  const fullscreen = useFullscreen();
  useWakeLock(true);
  const sc = p.stopControls;

  const fresh = p.live && now - p.live.t <= STALE_MS ? p.live : null;
  const speed = fresh?.kmh != null ? Math.round(fresh.kmh) : null;
  // Mapa i dopasowanie do trasy: ostatni odczyt do NAV.deadReckonS — w tunelu / bez sygnału przewidujemy ruch po trasie.
  const lastLive = p.live && now - p.live.t <= NAV.deadReckonS * 1000 ? p.live : null;
  const weakGps = !!lastLive && now - lastLive.t > NAV.weakGpsS * 1000 && (lastLive.kmh ?? 0) > 5;
  const track = useNavTrack(p.nav ?? NO_NAV, lastLive);
  const zoomBrowse = (d: number) => browse && setBrowse({ ...browse, zoom: Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, browse.zoom + d)) });
  // W trakcie jazdy przeglądanie samo wraca do prowadzenia po 20 s bez dotykania mapy (jak w nawigacjach).
  const moving = (speed ?? 0) >= 10;
  useEffect(() => {
    if (!browse || !moving) return;
    const id = setTimeout(() => setBrowse(null), 20_000);
    return () => clearTimeout(id);
  }, [browse, moving]);
  const nav = p.nav && p.planner ? { ...p.nav, onPlan: () => { setPlanning({}); setMenu(false); } } : p.nav;
  const route = p.nav?.route ?? null;
  const pos = track.pos;
  const next = route && pos && !track.off ? nextInstruction(route.instructions, pos.km) : undefined;
  // Ograniczenie z trasy; bez trasy albo poza nią — z drogi, którą jedziemy (ślad GPS dopasowany na serwerze).
  const onRoute = !!route && !!pos && !track.off;
  // Ograniczenie z trasy; gdy trasa nie ma danych w tym miejscu (luka, starsza trasa) — też z drogi pod kołami, jak bez trasy.
  const routeLimit = onRoute ? legalLimitAt(route, pos.km, p.truck) : undefined;
  const here = useLimitHere(p.mapToken, fresh, !routeLimit);
  // „Po drodze” bez trasy: miejsca wokół pobieramy, gdy lista jest otwarta albo pasek pod prędkością włączony.
  const stripOn = !!p.mapToken && AHEAD_STRIP.some((k) => p.ahead.strip[k.id]);
  const nearby = useNearbyPois(p.mapToken, fresh, (aheadList || stripOn) && !onRoute, p.ahead.km);
  const aheadItems: AheadItem[] | null = onRoute
    ? route.pois?.filter((x) => x.km > pos.km && x.km <= pos.km + p.ahead.km && poiVisible(route, x)).map((x) => ({ poi: x, km: x.km - pos.km, side: x.side, onRoute: true })) ?? []
    : nearby && fresh ? placesAhead(nearby, fresh, fresh.heading, p.ahead.km).map(({ item, km }) => ({ poi: item, km, onRoute: false })) : null;
  // Pod prędkością: najbliższy z każdego włączonego rodzaju (najwyżej 3).
  const placeRows: StripRow[] = stripOn && aheadItems ? AHEAD_STRIP.filter((k) => p.ahead.strip[k.id]).flatMap((k) => {
    const x = aheadItems.find((i) => k.kinds.includes(i.poi.kind));
    return x ? [{ key: k.id, icon: <AheadIcon kind={k.id === "fuel" ? "fuel" : x.poi.kind} />, label: k.id === "fuel" ? stationLabel(x.poi.name) : k.short, km: x.km }] : [];
  }) : [];
  // Fotoradar i początek odcinkowego pomiaru — z ostrzeżeń trasy, w czerwonej ramce (przejazd przez odcinek pokazuje karta / oś).
  const alertRows: StripRow[] = p.mapToken && p.ahead.strip.camera !== false && onRoute ? ALERT_STRIP.flatMap((a) => {
    const w = route.warnings?.filter((x) => x.kind === a.kind && !x.soft && x.km > pos.km && x.km - pos.km <= p.ahead.km).sort((x, y) => x.km - y.km)[0];
    return w ? [{ key: a.kind, icon: <AlertIcon kind={a.kind} />, label: a.label, km: w.km - pos.km, alert: true }] : [];
  }) : [];
  const strip = [...placeRows, ...alertRows].sort((a, b) => a.km - b.km);
  const limit = routeLimit?.kmh ?? (here ? legalLimitAt(here, Math.max(0, here.km - 0.005), p.truck)?.kmh : undefined);
  const legal = limit !== undefined && p.vehicleMaxKmh !== undefined ? Math.min(limit, p.vehicleMaxKmh) : limit ?? p.vehicleMaxKmh;
  const tone = speedTone(speed, legal);
  const sectionRun = useSectionRun(route, pos, track.off, fresh?.t, p.truck).run;
  const section = route && !track.off ? sectionView(route, pos?.km, sectionRun, now, p.truck) : null;
  const sectionVoice: SectionVoice = (w) => {
    const run = sectionRun?.id === sectionKey(w) ? sectionRun : undefined;
    return { limit: run?.limit ?? (route ? sectionLimit(route, { id: "", km: w.km, toKm: w.toKm ?? w.km, value: w.value }, p.truck) : undefined), avgKmh: run?.avgKmh };
  };
  const upcoming = route?.warnings?.filter((w) => !pos || isAhead(w, pos.km)) ?? [];
  const arrival = arrivalInfo(p.plan, p.deadline, now);
  const endDay = () => confirm("Zakończyć dzień pracy? Zacznie się odpoczynek dzienny.") && sc.onEndDay();
  const openSheet = () => { setSheet(true); setMenu(false); };
  // Kafelek przerwy: w jeździe — ile z 4,5 h jazdy bez przerwy już za nami; na postoju — ile z zaplanowanego postoju minęło.
  const breakUsed = sc.stop
    ? sc.stop.targetMin ? Math.min(1, (now - sc.stop.start) / 60_000 / sc.stop.targetMin) : 1
    : Math.min(1, Math.max(0, sc.driver.sinceBreakMin / RULES.maxContinuousDrive));
  const refs = route ? routeRefs(route.instructions) : "";
  const endNav = () => {
    if (!p.nav?.onEnd || !confirm("Zakończyć nawigację? Trasa i cel zostaną usunięte.")) return;
    p.nav.onEnd();
    setPin(null);
    setHold(null);
    setBrowse(null);
  };
  const go = (f: () => void) => () => { setMenu(false); f(); };
  const home = p.planner?.places.home;
  const menuItems: MenuItem[] = [
    ...(p.planner ? [
      { id: "search", icon: "search" as const, label: "Szukaj", onClick: go(() => setPlanning({ search: true })) },
      { id: "home", icon: "home" as const, label: "Jedź do domu", onClick: go(() => setPlanning(home ? { go: home } : { tab: "home" })) },
      { id: "recent", icon: "recent" as const, label: "Ostatnie cele", onClick: go(() => setPlanning({ tab: "recent" })) },
    ] : []),
    ...(route ? [{ id: "route", icon: "route" as const, label: "Aktualna trasa", onClick: () => setMenuPage("route") }] : []),
    ...(p.planner ? [{ id: "places", icon: "places" as const, label: "Moje miejsca", onClick: go(() => setPlanning({ tab: "fav" })) }] : []),
    { id: "break", icon: "break", label: sc.stop ? (sc.stop.dayEnd ? "Odpoczynek" : "Trwający postój") : "Przerwa", dot: !!sc.stop, onClick: go(() => setSheet(true)) },
    sc.stop?.dayEnd
      ? { id: "day", icon: "dayStart", label: "Rozpocznij dzień", onClick: go(() => { if (confirmStartDay(sc.stop, now)) sc.onStartDay(); }) }
      : { id: "day", icon: "dayEnd", label: "Zakończ dzień", onClick: go(() => { endDay(); }) },
    ...(p.report ? [{ id: "report", icon: "report" as const, label: "Zgłoś", onClick: go(() => { setReportAt(null); setReporting(true); }) }] : []),
    ...(p.gapReview && p.onGapAnswer ? [{ id: "gap", icon: "gap" as const, label: "Co robiłem bez aplikacji", dot: !p.gapReview.answer, onClick: go(() => setGapOpen(true)) }] : []),
    ...(p.settings ? [{ id: "settings", icon: "settings" as const, label: "Ustawienia", onClick: () => setMenuPage("settings") }] : []),
    ...(fullscreenSupported() ? [{ id: "fs", icon: "fullscreen" as const, label: fullscreen ? "Zamknij pełny ekran" : "Pełny ekran", onClick: go(toggleFullscreen) }] : []),
    ...(p.nav?.onEnd && (p.nav.route || p.nav.dest) ? [{ id: "end", icon: "endNav" as const, label: "Zakończ nawigację", tone: "danger" as const, onClick: go(endNav) }] : []),
    { id: "exit", icon: "exit", label: "Wyjdź z nawigacji", onClick: p.onExit },
  ];
  // Aktualna trasa (jak w TomTom): pomiń postój, inna trasa, omiń blokadę, płatne, ulubione, wskazówki.
  const viaLeft = route && p.nav?.onVia ? viaAhead(route, fresh) : [];
  const avoidTolls = !!p.settings?.value.vehicle.avoid?.tolls;
  const dest = p.nav?.dest;
  const fav = !!dest && !!p.planner && isFavorite(p.planner.places, dest);
  const routeItems: MenuItem[] = [
    { id: "skip", icon: "skipStop", label: "Pomiń następny postój", sub: viaLeft[0]?.label, disabled: !viaLeft.length, onClick: go(() => { p.nav?.onVia?.(viaLeft.slice(1)).catch((e) => alert(e instanceof Error ? e.message : "Nie udało się wyznaczyć trasy.")); }) },
    ...(p.planner && dest ? [{ id: "alt", icon: "altRoute" as const, label: "Znajdź inną trasę", onClick: go(() => setPlanning({ go: dest })) }] : []),
    { id: "block", icon: "roadblock", label: "Omiń blokadę drogi", sub: "droga przez najbliższe ~2 km", disabled: !p.nav?.onAvoid || !pos || track.off, onClick: go(() => {
      // Punkty na trasie 0,4–2 km przed nami — silnik szuka objazdu; zostają omijane przy kolejnych przeliczeniach.
      const pts = [0.4, 0.8, 1.2, 1.6, 2].map((d) => pointAtKm(route!.points, pos!.km + d)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ lat: x.lat, lon: x.lon }));
      p.nav!.onAvoid!(pts);
    }) },
    ...(p.settings ? [{ id: "tolls", icon: "avoidTolls" as const, label: avoidTolls ? "Nie omijaj dróg płatnych" : "Omijaj drogi płatne", sub: avoidTolls ? "teraz omijane" : undefined, onClick: go(() => {
      const v = p.settings!.value.vehicle;
      p.settings!.onChange({ vehicle: { ...v, avoid: { tolls: !avoidTolls, motorways: !!v.avoid?.motorways, ferries: !!v.avoid?.ferries } } });
      // Przeliczenie po zapisie ustawień (nowy pojazd trafia do App w następnym renderze).
      setTimeout(() => p.nav?.onReroute(), 50);
    }) }] : []),
    ...(p.planner && dest ? [{ id: "fav", icon: "favRoute" as const, label: fav ? "Usuń cel z ulubionych" : "Dodaj cel do ulubionych", sub: dest.label, onClick: go(() => p.planner!.onPlaces(toggleFavorite(p.planner!.places, dest))) }] : []),
    { id: "dirs", icon: "directions", label: "Pokaż wskazówki", onClick: go(() => setManeuvers(true)) },
    ...(p.nav?.onEnd ? [{ id: "end", icon: "endNav" as const, label: "Zakończ nawigację", tone: "danger" as const, onClick: go(endNav) }] : []),
  ];
  const settingsItems: MenuItem[] = SETTINGS_PAGES.map((x) => ({ id: x.id, icon: x.icon, label: x.label, onClick: () => setMenuPage(x.id) }));
  const menuPages = (k: MenuKey): MenuPage => {
    if (k === "main") return { title: p.nav?.dest ? `${refs ? `${refs} · ` : ""}${route ? fmtKm(route.lengthKm) : ""} → ${p.nav.dest.label}` : undefined, items: menuItems };
    if (k === "route") return { heading: "Aktualna trasa", items: routeItems };
    if (k === "settings") return { heading: "Ustawienia", items: settingsItems };
    const sec = SETTINGS_PAGES.find((x) => x.id === k)!;
    return {
      heading: sec.label,
      content: p.settings && <NavSettingsPage section={k} settings={p.settings.value} onChange={p.settings.onChange} voice={p.voice} onReroute={p.nav?.dest ? () => { p.nav!.onReroute(); setMenu(false); } : undefined} />,
    };
  };

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
      <NavVoice nav={p.nav} track={track} kmh={fresh?.kmh ?? null} enabled={p.voice.on} section={sectionVoice} />
      <div className={`nm-map ${browse ? "browsing" : ""} ${p.mapMode === "2d" ? "flat" : ""}`}>
        {p.nav && p.mapToken ? <HudRouteMap nav={p.nav} track={track} live={lastLive} token={p.mapToken} anchorY={p.mapMode === "2d" ? 0.62 : 0.7} zoomOffset={zoomOffset} flat={p.mapMode === "2d"} friends={p.friends} vector={p.mapVector} browse={browse} onBrowse={setBrowse} onPin={(x) => { setPin(x); setHold(null); }} onHold={(x) => { setHold(x); setPin(null); }} /> : <div className="hud-map empty" />}
      </div>

      <header className="nm-top">
        {nav ? <HudNav nav={nav} track={track} card section={section && <div className="nm-section-card"><SectionPanel v={section} now={now} /></div>} onManeuvers={() => setManeuvers(true)} /> : (
          <div className="hud-nav card off">
            <span className="hud-nav-msg">Nawigacja jest dostępna w RoadPilot Premium.</span>
          </div>
        )}
        {route && pos && !track.off && <button className="nm-card-more" onClick={() => setManeuvers(true)} aria-label="Najbliższe manewry"><Icon name="chevron" /></button>}
      </header>

      {/* Kafelki: do celu, przyjazd, przerwa, trasa. Telefon pionowo: dwa pierwsze, reszta po dotknięciu uchwytu; poziomo: pasek na dole; tablet: 2×2 u góry. */}
      <div className={`nm-tiles ${tilesOpen ? "open" : ""}`}>
        <button className="nm-tiles-handle" onClick={() => setTilesOpen(!tilesOpen)} aria-expanded={tilesOpen} aria-label={tilesOpen ? "Zwiń" : "Przerwa i trasa"} />
        <div className="nm-tile">
          <Icon name="flag" />
          <span><small>Do celu</small><b>{fmtKm(p.route.totalKm)}</b></span>
        </div>
        <div className={`nm-tile ${arrival.bad ? "bad" : ""}`}>
          <Icon name="clock" />
          <span><small>Przyjazd</small><b>{arrival.clock}</b><i>{arrival.left !== undefined ? `za ${arrival.left}` : arrival.note}</i></span>
        </div>
        <button className={`nm-tile extra ${stopItem.tone}`} onClick={openSheet}>
          <Icon name="coffee" />
          <span><small>{stopItem.label}</small><b>{stopItem.value}</b><i>{stopItem.sub}</i></span>
          <em className="nm-tile-bar" aria-hidden><i style={{ width: `${Math.round(breakUsed * 100)}%` }} /></em>
        </button>
        <div className="nm-tile extra">
          <Icon name="road" />
          <span><small>Trasa</small><b>{refs || (route ? "Drogi lokalne" : "Brak trasy")}</b><i>{route ? `${fmtKm(route.lengthKm)}${route.engine === "roadpilot" ? " · RoadPilot" : ""}` : ""}</i></span>
        </div>
      </div>

      {/* Panel przycisków po lewej — zwijany do lewej krawędzi (stan zapamiętany w tym urządzeniu); „⋯” zostaje zawsze. */}
      <div className={`nm-side ${sideOpen ? "" : "folded"}`}>
        <div className="nm-side-btns">
        {p.voice.supported && (
          <button className={`nm-btn ${p.voice.on ? "" : "off"}`} onClick={p.voice.toggle} aria-label={p.voice.on ? "Wycisz komunikaty" : "Włącz komunikaty głosowe"} aria-pressed={p.voice.on}>
            <Icon name={p.voice.on ? "sound" : "mute"} />
          </button>
        )}
        {p.planner && (
          <button className="nm-btn" onClick={() => setPlanning({ search: true })} aria-label="Szukaj celu">
            <Icon name="search" />
          </button>
        )}
        <button className={`nm-btn ${upcoming.length ? "warn" : ""}`} onClick={() => setWarnList(true)} aria-label="Ostrzeżenia na trasie">
          <Icon name="warning" />
          {upcoming.length > 0 && <em>{upcoming.length}</em>}
        </button>
        <button className="nm-btn" onClick={() => setAheadList(true)} aria-label="Po drodze: MOP-y, parkingi i stacje">
          <Icon name="parking" />
        </button>
        {p.report && (
          <button className="nm-btn report" onClick={() => { setReportAt(null); setReporting(true); }} aria-label="Zgłoś: fotoradar, kontrola, brakujący parking / MOP / stacja">
            <Icon name="flag" />
          </button>
        )}
        </div>
        <button className="nm-btn nm-more" onClick={() => setMenu(true)} aria-label="Menu: cel, dom, przerwa, ustawienia">
          <Icon name="dots" className="more-dots" />
          <Icon name="chevron" className="more-chevron" />
        </button>
        <button className="nm-fold" onClick={() => setSide(!sideOpen)} aria-expanded={sideOpen} aria-label={sideOpen ? "Zwiń przyciski" : "Rozwiń przyciski"}>
          <Icon name="chevron" />
        </button>
      </div>

      <div className="nm-ctl">
        <button className="nm-btn nm-mode" onClick={() => p.onMapMode(p.mapMode === "2d" ? "3d" : "2d")} aria-label={p.mapMode === "2d" ? "Mapa 3D (pochylona)" : "Mapa 2D (z góry, oddalona)"}>
          {p.mapMode === "2d" ? "3D" : "2D"}
        </button>
        <div className="nm-zoom">
          <button onClick={() => (browse ? zoomBrowse(1) : setZoomOffset((z) => Math.min(2, z + 0.5)))} aria-label="Przybliż">+</button>
          <button onClick={() => (browse ? zoomBrowse(-1) : setZoomOffset((z) => Math.max(-5, z - 0.5)))} aria-label="Oddal">−</button>
        </div>
        <button className={`nm-btn nm-recenter ${browse ? "on" : ""}`} onClick={() => setBrowse(null)} aria-label="Wróć do mojej pozycji">
          <Icon name="nav" />
        </button>
      </div>

      {/* Nasza prędkość i obok ograniczenie — jedno spojrzenie, jak w nawigacjach. */}
      <div className="nm-speed">
        <div className="nm-speed-val">
          <strong className={speed === null ? "none" : tone ?? ""}>{speed ?? "—"}</strong>
          <span>{weakGps ? "GPS słaby" : "km/h"}</span>
        </div>
        {limit !== undefined && <span className="hud-limit nm-limit" aria-label={`Ograniczenie ${limit} km/h`}>{limit}</span>}
        {legal !== undefined && speed !== null && <em className={`nm-speed-bar ${tone ?? ""}`} aria-hidden><i style={{ width: `${Math.min(100, Math.round((speed / legal) * 100))}%` }} /></em>}
      </div>

      {strip.length > 0 && (
        <button className="nm-ahead" onClick={() => setAheadList(true)} aria-label="Po drodze — pokaż listę">
          {strip.map((r) => (
            <span key={r.key} className={r.alert ? "alert" : ""}>
              {r.icon}
              <b>{r.label}</b>
              <strong>{fmtAheadKm(r.km)}</strong>
              <Icon name="chevron" className="nm-ahead-go" />
            </span>
          ))}
        </button>
      )}
      {notice && <div className="nm-notice">{notice}</div>}

      {/* Tablet: pasek na dole — do celu, przyjazd i postęp trasy (zielone = przejechane, kropki = punkty pośrednie i postoje). */}
      <div className="nm-progress">
        <span className="nm-progress-item"><Icon name="flag" /><span><b>{fmtKm(p.route.totalKm)}</b><small>Do celu</small></span></span>
        <span className={`nm-progress-item ${arrival.bad ? "bad" : ""}`}><Icon name="clock" /><span><b>{arrival.clock}</b><small>{arrival.left !== undefined ? `Przyjazd za ${arrival.left}` : arrival.note}</small></span></span>
        <button className={`nm-progress-item ${stopItem.tone}`} onClick={openSheet}><Icon name="coffee" /><span><b>{stopItem.value}</b><small>{stopItem.label}</small></span></button>
        <span className="nm-progress-item"><Icon name="road" /><span><b>{refs || (route ? "Drogi lokalne" : "Brak trasy")}</b><small>{route ? `Trasa · ${fmtKm(route.lengthKm)}` : "Trasa"}</small></span></span>
        {/* Oś trasy jak w HUD: Start → Cel, przejechane na zielono, ciężarówka z %, kubek przy planowanej przerwie („za 269 km 12:01”). */}
        {/* Odcinkowy pomiar (zapowiedź, w trakcie, podsumowanie) zajmuje miejsce osi — na tablecie nie w karcie manewru. */}
        <span className="nm-progress-track">
          {section ? <SectionLine v={section} now={now} /> : <RouteLine route={p.route} doneKm={pos?.km ?? 0} plan={p.plan} now={now} destination={p.nav?.dest?.label} />}
        </span>
      </div>

      <footer className="nm-bottom">
        {pin && route && p.nav?.onVia && (
          <PinCard key={pin.key} pin={pin} route={route} myKm={pos?.km} live={fresh} onVia={p.nav.onVia} onClose={() => setPin(null)} />
        )}
        {hold && (route && p.nav?.onVia || p.report) && (
          <HoldCard
            key={`${hold.lat},${hold.lon}`}
            hold={hold}
            route={route}
            myKm={pos?.km}
            live={fresh}
            onVia={p.nav?.onVia}
            onSnap={p.report?.onSnap}
            onReport={(road) => { setReportAt(road); setReporting(true); setHold(null); }}
            onClose={() => setHold(null)}
          />
        )}
      </footer>

      {menuPage && <NavMenu page={menuPages(menuPage)} voice={p.voice} onBack={() => setMenuPage(MENU_PARENT[menuPage])} onRecenter={() => { setMenu(false); setBrowse(null); }} />}
      {gapOpen && p.gapReview && p.onGapAnswer && (
        <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && setGapOpen(false)}>
          <div className="hud-sheet-body">
            <button className="hud-sheet-close" aria-label="Później" onClick={() => setGapOpen(false)}>×</button>
            <GapSheet review={p.gapReview} onAnswer={(a) => { p.onGapAnswer!(a); setGapOpen(false); }} onLater={() => setGapOpen(false)} />
          </div>
        </div>
      )}
      {maneuvers && route && (
        <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && setManeuvers(false)}>
          <div className="hud-sheet-body">
            <button className="hud-sheet-close" aria-label="Zamknij" onClick={() => setManeuvers(false)}>×</button>
            <div className="stop-label">Najbliższe manewry</div>
            <ul className="nm-man-list">
              {route.instructions.filter((i) => i.km > (pos?.km ?? 0) + 0.01).slice(0, 20).map((i) => (
                <li key={i.km + i.maneuver}>
                  <ManeuverIcon ins={i} />
                  <span><b>{i.text}</b>{i.signpost && <small>→ {i.signpost}</small>}</span>
                  <strong>{fmtDist(Math.max(0, i.km - (pos?.km ?? 0)))}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

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
      {aheadList && (
        <AheadSheet
          items={aheadItems}
          km={p.ahead.km}
          premium={!!p.mapToken}
          gps={!!fresh}
          onShow={onRoute ? (x) => {
            const poi = x as RoutePoi;
            setPin({ key: `p${poi.id}`, kind: poi.kind, title: POI_TITLE[poi.kind], name: poi.name, details: [`${poi.side === "right" ? "Po prawej" : "Po lewej"} stronie, ok. ${Math.round(poi.offM / 10) * 10} m od trasy`], km: poi.km, lat: poi.lat, lon: poi.lon });
            setHold(null);
            setBrowse({ center: { lat: poi.lat, lon: poi.lon }, zoom: 15, bearing: 0 });
            setAheadList(false);
          } : undefined}
          initialFilter={aheadFilter}
          onClose={() => { setAheadList(false); setAheadFilter("all"); }}
        />
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
            {!reportAt && route && pos && p.report.onBadTurn && <BadTurn route={route} km={pos.km} onSend={p.report.onBadTurn} onDone={() => setReporting(false)} />}
            <ReportSheet onSend={(kind, value) => p.report!.onSend(kind, value, reportAt ?? undefined)} onClose={() => setReporting(false)} located={reportAt !== null || p.live !== null} place={reportAt ? reportAt.name : undefined} />
          </div>
        </div>
      )}
      {planning && p.planner && (
        <div className="nmp">
          <HudRoutePicker full planner={p.planner} dest={p.nav?.dest ?? null} onClose={() => setPlanning(null)} start={planning} onCategory={(c) => { setPlanning(null); setAheadFilter(c); setAheadList(true); }} />
        </div>
      )}
    </div>
  );
}

/** „za 12 km · ok. 11 min” — km po trasie od nas; czas ze średniej prędkości tej trasy. */
function aheadText(route: NavRoute, km: number, myKm: number | undefined) {
  const d = km - (myKm ?? 0);
  if (d < -0.05) return `za Tobą · ${fmtKm(-d)} temu`;
  if (d < 0.1) return "tutaj";
  const kmh = route.travelMin > 0 ? route.lengthKm / (route.travelMin / 60) : 70;
  return `${myKm === undefined ? "od startu trasy " : "za "}${d < 10 ? `${d.toFixed(1).replace(".", ",")} km` : fmtKm(d)} · ok. ${fmtDuration((d / kmh) * 60)}`;
}

const MAX_VIA = 5;

/**
 * Karta nad mapą: co to za pinezka i jak daleko — albo propozycja punktu pośredniego po przytrzymaniu mapy.
 * Miejsce z pinezki (stacja, MOP) też można dodać do trasy; punkt pośredni — usunąć.
 */
/** Najwięcej pozycji na liście (stacji bywa kilkadziesiąt). */
const AHEAD_MAX = 40;

type AheadFilter = "all" | "mop" | "parking" | "fuel";
const AHEAD_FILTERS: { id: AheadFilter; label: string; kinds: RoutePoi["kind"][] }[] = [
  { id: "all", label: "Wszystko", kinds: ["services", "mop", "parking", "fuel", "toll"] },
  { id: "mop", label: "MOP", kinds: ["services", "mop"] },
  { id: "parking", label: "Parkingi", kinds: ["parking"] },
  { id: "fuel", label: "Stacje", kinds: ["fuel", "services"] },
];
/** Pasek pod prędkością: rodzaje w kolejności wyświetlania (MOP ze stacją liczy się jako MOP i jako stacja). */
type MenuKey = "main" | "route" | "settings" | SettingsSection;
const SETTINGS_PAGES: { id: SettingsSection; label: string; icon: MenuItem["icon"] }[] = [
  { id: "look", label: "Wygląd", icon: "look" },
  { id: "voice", label: "Głos", icon: "voice" },
  { id: "planning", label: "Planowanie trasy", icon: "planning" },
  { id: "vehicle", label: "Profil pojazdu", icon: "vehicle" },
  { id: "ahead", label: "Po drodze", icon: "ahead" },
];
/** Strona wyżej w menu (powrót); z głównej — mapa. */
const MENU_PARENT: Record<MenuKey, MenuKey | null> = { main: null, route: "main", settings: "main", look: "settings", voice: "settings", planning: "settings", vehicle: "settings", ahead: "settings" };

/** Zwinięty panel przycisków — wygoda jednego urządzenia (localStorage), nie stan synchronizowany. */
const SIDE_KEY = "roadpilot:navSide";
function readSideOpen() {
  try { return localStorage.getItem(SIDE_KEY) !== "0"; } catch { return true; }
}

interface StripRow { key: string; icon: ReactNode; label: string; km: number; alert?: boolean }

const ALERT_STRIP: { kind: "camera" | "section"; label: string }[] = [
  { kind: "camera", label: "Fotoradar" },
  { kind: "section", label: "Odcinkowy" },
];

/** Fotoradar / odcinkowy pomiar: biała tarcza w czerwonej obwódce (jak znak). */
function AlertIcon({ kind }: { kind: "camera" | "section" }) {
  return (
    <i className={`nm-ahead-ico k-${kind}`} aria-hidden>
      {kind === "camera"
        ? <svg viewBox="-12 -12 24 24"><path d="M-8 -4h10v8H-8zM2 -1l6-3v8l-6-3" fill="#1b1f24" /><circle cx="-3" cy="0" r="2.2" fill="#fff" /></svg>
        : <svg viewBox="-12 -12 24 24"><path d="M-8 4a8 8 0 0 1 16 0" fill="none" stroke="#1b1f24" strokeWidth="2.6" strokeLinecap="round" /><path d="M0 4 4.5-3" stroke="#e5484d" strokeWidth="2.4" strokeLinecap="round" /><circle cx="0" cy="4" r="2" fill="#1b1f24" /></svg>}
    </i>
  );
}

/** Stacja na pasku „po drodze”: marka (Orlen, Shell, BP…) — z OSM brand/name; ogólne nazwy i zgłoszenia kierowców → „Stacja”. */
const GENERIC_STATION = /^(stacja( paliw| lpg)?|independent|zgłoszenie kierowcy|mop\b|miejsce obsługi)/i;
const stationLabel = (name: string | undefined) => {
  const n = (name ?? "").trim();
  return !n || GENERIC_STATION.test(n) ? "Stacja" : n;
};

const AHEAD_STRIP: { id: keyof AheadStrip; short: string; kinds: RoutePoi["kind"][] }[] = [
  { id: "mop", short: "MOP", kinds: ["services", "mop"] },
  { id: "parking", short: "Parking", kinds: ["parking"] },
  { id: "fuel", short: "Stacja", kinds: ["fuel", "services"] },
];
const AHEAD_KIND: Record<RoutePoi["kind"], string> = { services: "MOP ze stacją", mop: "MOP", parking: "Parking TIR", fuel: "Stacja paliw", toll: "Bramki" };

/** Blisko z dokładnością do 0,1 km („1,4 km”), dalej pełne km. */
const fmtAheadKm = (km: number) => (km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : fmtKm(km));

interface AheadItem {
  poi: Pick<RoutePoi, "id" | "kind" | "name" | "truck" | "lat" | "lon">;
  /** Po trasie albo (bez trasy) w linii prostej. */
  km: number;
  side?: "left" | "right";
  onRoute: boolean;
}

function AheadIcon({ kind }: { kind: RoutePoi["kind"] }) {
  return (
    <i className={`nm-ahead-ico k-${kind}`} aria-hidden>
      {kind === "fuel" ? <svg viewBox="-12 -12 24 24"><path d="M-7 8V-8h9v16zM-5 -6v5h5v-5zM2 -3h2.5l2 2v7a1.5 1.5 0 0 0 3 0V-5l-3-3" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        : kind === "toll" ? <svg viewBox="-12 -12 24 24"><path d="M-8 8V-6" stroke="#fff" strokeWidth="3" strokeLinecap="round" /><rect x="-8" y="-8" width="17" height="5" rx="1.5" fill="#fff" /></svg> : "P"}
    </i>
  );
}

/** MOP-y, parkingi TIR i stacje do `km` przed nami — po trasie, a bez niej w kierunku jazdy (w linii prostej). */
function AheadSheet({ items, km, premium, gps, onShow, onClose, initialFilter = "all" }: { items: AheadItem[] | null; km: number; premium: boolean; gps: boolean; onShow?: (p: AheadItem["poi"]) => void; onClose: () => void; initialFilter?: AheadFilter }) {
  const [filter, setFilter] = useState<AheadFilter>(initialFilter);
  const kinds = AHEAD_FILTERS.find((f) => f.id === filter)!.kinds;
  const shown = items?.filter((x) => kinds.includes(x.poi.kind)).slice(0, AHEAD_MAX);
  const straight = items?.some((x) => !x.onRoute);
  return (
    <div className="hud-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hud-sheet-body">
        <button className="hud-sheet-close" aria-label="Zamknij" onClick={onClose}>×</button>
        <div className="stop-label">Po drodze — {km} km przed Tobą{straight ? " (w linii prostej, bez trasy)" : ""}</div>
        <div className="nm-ahead-filters" role="radiogroup" aria-label="Rodzaj miejsc">
          {AHEAD_FILTERS.map((f) => (
            <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        {!premium ? (
          <p className="muted">Lista miejsc po drodze jest dostępna w RoadPilot Premium.</p>
        ) : shown === undefined ? (
          <p className="muted">{gps ? "Wczytuję miejsca w pobliżu…" : "Czekam na pozycję GPS…"}</p>
        ) : shown.length ? (
          <ul className="nm-ahead-list">
            {shown.map((x) => {
              const sub = [x.poi.name ? AHEAD_KIND[x.poi.kind] : "", x.side ? (x.side === "right" ? "po prawej" : "po lewej") : "", x.poi.truck && x.poi.kind !== "parking" ? "dla TIR" : ""].filter(Boolean).join(" · ");
              const body = (
                <>
                  <AheadIcon kind={x.poi.kind} />
                  <span className="nm-ahead-name">
                    <b>{x.poi.name || AHEAD_KIND[x.poi.kind]}</b>
                    {sub && <small>{sub}</small>}
                  </span>
                  <strong className="nm-ahead-km">{fmtAheadKm(x.km)}</strong>
                </>
              );
              return <li key={x.poi.id}>{onShow ? <button onClick={() => onShow(x.poi)}>{body}</button> : <div>{body}</div>}</li>;
            })}
          </ul>
        ) : (
          <p className="muted">Brak takich miejsc w ciągu {km} km (dane OpenStreetMap, Polska).</p>
        )}
      </div>
    </div>
  );
}

function PinCard({ pin, route, myKm, live, onVia, onClose }: { pin: PinInfo; route: NavRoute; myKm: number | undefined; live: Live | null; onVia: (via: NavPlace[]) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ahead = viaAhead(route, live);
  const run = async (via: NavPlace[]) => {
    setBusy(true);
    setError(null);
    try {
      await onVia(via);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się wyznaczyć trasy.");
    } finally {
      setBusy(false);
    }
  };
  const add = (place: NavPlace) => run(insertVia(route, ahead, place));

  const title = pin.title;
  const sub = [pin.name, aheadText(route, pin.km, myKm), ...pin.details].filter(Boolean);
  let action: React.ReactNode;
  if (pin.kind === "via") {
    action = <button className="ghost" disabled={busy} onClick={() => run(viaAhead({ ...route, via: (route.via ?? []).filter((_, i) => i !== pin.viaIndex) }, live))}>{busy ? "Wyznaczam…" : "Usuń z trasy"}</button>;
  } else if (["fuel", "services", "mop", "parking"].includes(pin.kind)) {
    action = <button className="primary" disabled={busy || ahead.length >= MAX_VIA} onClick={() => add({ label: pin.name || pin.title, sub: pin.title, lat: pin.lat, lon: pin.lon })}>{busy ? "Wyznaczam…" : "Jedź przez to miejsce"}</button>;
  }
  return (
    <div className="nm-pin-card" role="dialog" aria-label={title}>
      <button className="hud-sheet-close" aria-label="Zamknij" onClick={onClose}>×</button>
      <b>{title}</b>
      {sub.map((t) => <span key={t}>{t}</span>)}
      {ahead.length >= MAX_VIA && pin.kind !== "via" && <span className="warn-text">Najwyżej {MAX_VIA} punktów pośrednich.</span>}
      {error && <span className="bad-text">{error}</span>}
      {action && <div className="row-buttons">{action}</div>}
    </div>
  );
}

/**
 * Miejsce przytrzymane na mapie: najbliższa droga (z serwera) i co można z nim zrobić — zgłosić ograniczenie na tej drodze
 * (tonaż, zakaz dla ciężarówek, wiadukt…) albo poprowadzić przez nie trasę.
 */
function HoldCard({ hold, route, myKm, live, onVia, onSnap, onReport, onClose }: { hold: LatLon; route: NavRoute | null; myKm: number | undefined; live: Live | null; onVia?: (via: NavPlace[]) => Promise<void>; onSnap?: (at: LatLon) => Promise<SnappedRoad | null>; onReport: (road: SnappedRoad) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** undefined = szukam drogi, null = brak drogi w pobliżu / błąd. */
  const [road, setRoad] = useState<SnappedRoad | null | undefined>(onSnap ? undefined : null);
  useEffect(() => {
    if (!onSnap) return;
    let on = true;
    onSnap(hold).then((r) => on && setRoad(r)).catch(() => on && setRoad(null));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold.lat, hold.lon]);
  const ahead = route ? viaAhead(route, live) : [];
  const addVia = async () => {
    if (!route || !onVia) return;
    setBusy(true);
    setError(null);
    try {
      await onVia(insertVia(route, ahead, { label: "Punkt na mapie", sub: `${hold.lat.toFixed(4)}, ${hold.lon.toFixed(4)}`, lat: hold.lat, lon: hold.lon }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się wyznaczyć trasy.");
    } finally {
      setBusy(false);
    }
  };
  const at = route ? locate(route.points, hold) : undefined;
  const sub = [
    onSnap ? (road === undefined ? "Szukam drogi…" : road ? `${road.name || "Droga bez nazwy"}${road.offM > 15 ? ` · ${road.offM} m od palca` : ""}` : "Brak drogi w pobliżu — przytrzymaj bliżej drogi") : "",
    route && at ? (at.offM < 150 ? `Na trasie · ${aheadText(route, at.km, myKm)}` : `ok. ${fmtKm(at.offM / 1000)} od obecnej trasy`) : "",
  ].filter(Boolean);
  return (
    <div className="nm-pin-card" role="dialog" aria-label="Miejsce na mapie">
      <button className="hud-sheet-close" aria-label="Zamknij" onClick={onClose}>×</button>
      <b>Miejsce na mapie</b>
      {sub.map((t) => <span key={t}>{t}</span>)}
      {route && onVia && ahead.length >= MAX_VIA && <span className="warn-text">Najwyżej {MAX_VIA} punktów pośrednich.</span>}
      {error && <span className="bad-text">{error}</span>}
      <div className="row-buttons">
        {onSnap && <button className="primary" disabled={!road} onClick={() => road && onReport(road)}>Zgłoś ograniczenie</button>}
        {route && onVia && <button className={onSnap ? "ghost" : "primary"} disabled={busy || ahead.length >= MAX_VIA} onClick={addVia}>{busy ? "Wyznaczam…" : "Jedź przez ten punkt"}</button>}
      </div>
    </div>
  );
}

/** „Zły manewr”: manewr tuż przed nami albo właśnie minięty (−300 m … +500 m) — jednym dotknięciem „tu nie da się skręcić”. */
function BadTurn({ route, km, onSend, onDone }: { route: NavRoute; km: number; onSend: (t: { lat: number; lon: number; heading: number; note: string }) => Promise<void>; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const ins = route.instructions
    .filter((i) => i.maneuver !== "DEPART" && !i.maneuver.startsWith("ARRIVE") && i.km >= km - 0.3 && i.km <= km + 0.5)
    .sort((a, b) => Math.abs(a.km - km) - Math.abs(b.km - km))[0];
  if (!ins) return null;
  const send = async () => {
    // Punkt 30 m za manewrem na trasie i kierunek wyjazdu — tam silnik nie poprowadzi, gdy zgłosi to kilku kierowców.
    const at = pointAtKm(route.points, ins.km + 0.03);
    if (!at) return;
    setState("sending");
    try {
      await onSend({ lat: at.lat, lon: at.lon, heading: Math.round(bearingAtKm(route.points, ins.km + 0.03, 0.03) ?? 0), note: ins.text.slice(0, 180) });
      setState("sent");
      setTimeout(onDone, 1200);
    } catch {
      setState("error");
    }
  };
  return (
    <button className="bad-turn" disabled={state === "sending" || state === "sent"} onClick={send}>
      <b>{state === "sent" ? "Dziękujemy — zgłoszone" : state === "error" ? "Nie udało się — spróbuj ponownie" : "Tu nie da się skręcić"}</b>
      <small>{ins.text}</small>
    </button>
  );
}
