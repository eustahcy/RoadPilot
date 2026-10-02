import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeadlinePlan } from "../core/deadline";
import { Friend } from "../core/friends";
import { Live } from "../core/gps";
import { bearingAtKm, legalLimitAt, locate, milestoneAt, NAV, nextInstruction, pointAtKm, roadAt, speedTone } from "../core/navmatch";
import { Plan, timeAtKm } from "../core/plan";
import { Route } from "../core/route";
import { fmtDuration } from "../core/scenarios";
import { fmtClock, fmtKm } from "../format";
import { insertVia, isAhead, NO_AVOID, NavPlace, NavRoute, RoutePoi, RouteWarning, useLimitHere, useNearbyPois, viaAhead, warningText } from "../nav";
import { placesAhead } from "../core/stations";
import { AheadStrip } from "../state";
import { GpsStatus, useWakeLock } from "../tracking";
import { SectionVoice, useNavVoice } from "../voice";
import { AlertVote } from "./AlertVote";
import { GlVector } from "./GlMap";
import { fmtDist, HudNav, HudNavData, HudRouteMap, ManeuverIcon, MapBrowse, NavTrack, PinInfo, POI_TITLE, poiVisible, useNavTrack } from "./HudNav";
import { RULES } from "../core/rules";
import { LatLon, MAX_VIEW_ZOOM, MIN_VIEW_ZOOM, worldPx } from "./MapView";
import { HudPlanner, HudRoutePicker, PickerCategory, PickerStart } from "./HudRoutePicker";
import { MenuItem, MenuPage, NavMenu, NavPage } from "./NavMenu";
import { arrivalInfo, fullscreenSupported, Icon, isStop, RouteLine, routeRefs, STALE_MS, toggleFullscreen, useFullscreen, useTick } from "./HudView";
import { ReportKind, SnappedRoad } from "../collect";
import { ReportSheet } from "./ReportSheet";
import { ReportIcon } from "./ReportIcon";
import { GapSheet } from "./GapSheet";
import { GapAnswer, GapReview } from "../core/gapfix";
import { SectionLine, SectionPanel, sectionKey, sectionView, useSectionRun } from "./SectionControl";
import { sectionLimit } from "../core/section";
import { ActiveStopPanel, confirmStartDay, fmtTimer, StopControlsProps, StopPicker } from "./StopControls";
import { NavSettingsPage, SettingsSection } from "./NavSettings";
import { FuelGlyph, LetterGlyph, mergeStations, POI_COLOR, TollGlyph } from "./PoiIcons";
import { breakStopFor } from "../core/breakstop";
import { SupportContent } from "./Support";
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
  report?: { onSend: (kind: ReportKind, value: number | null, at?: SnappedRoad, note?: string) => Promise<{ id?: number } | void>; /** Koniec robót „zaznaczę koniec” w miejscu, w którym jesteśmy. */ onWorksEnd?: (id: number) => Promise<number>; onVote: (w: RouteWarning, vote: 1 | -1) => Promise<void>; onSnap: (at: LatLon) => Promise<SnappedRoad | null>; /** „Zły manewr”: punkt tuż za manewrem, kierunek wyjazdu i opis manewru. */ onBadTurn?: (t: { lat: number; lon: number; heading: number; note: string }) => Promise<void> };
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
  /** Licencja (menu ⋯ → Licencja): stan w podpisie i strona z wpisaniem klucza. */
  license?: { status: string; page: ReactNode };
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
  /** Roboty „zaznaczę koniec”: id zgłoszenia — na mapie przycisk „Koniec robót” (zapamiętany w tym urządzeniu). */
  const [worksOpen, setWorksOpenState] = useState<number | null>(() => { try { return Number(localStorage.getItem(WORKS_KEY)) || null; } catch { return null; } });
  const setWorksOpen = (id: number | null) => { setWorksOpenState(id); try { if (id) localStorage.setItem(WORKS_KEY, String(id)); else localStorage.removeItem(WORKS_KEY); } catch { /* tylko na tę sesję */ } };
  const [worksMsg, setWorksMsg] = useState<string | null>(null);
  /** Odrzucona propozycja miejsca na przerwę (klucz: przerwa z planu + miejsce) — nie wraca, dopóki plan nie przesunie przerwy. */
  const [breakDismissed, setBreakDismissed] = useState<string | null>(null);
  /** Kafelki „do celu / przyjazd” pokazują najbliższy punkt pośredni zamiast celu. */
  const [toVia, setToVia] = useState(false);
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
    if (!browse || !moving || browse.overview) return;
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
    ? mergeStations(route.pois ?? []).filter((x) => x.km > pos.km && x.km <= pos.km + p.ahead.km && poiVisible(route, x)).map((x) => ({ poi: x, km: x.km - pos.km, side: x.side, onRoute: true })) ?? []
    : nearby && fresh ? placesAhead(nearby, fresh, fresh.heading, p.ahead.km).map(({ item, km }) => ({ poi: item, km, onRoute: false })) : null;
  // Pod prędkością: najbliższy z każdego włączonego rodzaju (najwyżej 3).
  // MOP ze stacją to jedno miejsce: gdy najbliższa stacja jest w najbliższym MOP-ie, zostaje jeden wiersz „Krzyżanów · MOL”.
  const nearestOf = (k: (typeof AHEAD_STRIP)[number]) => aheadItems?.find((i) => k.kinds.includes(i.poi.kind));
  const mopItem = nearestOf(AHEAD_STRIP[0]);
  const placeRows: StripRow[] = stripOn && aheadItems ? AHEAD_STRIP.filter((k) => p.ahead.strip[k.id]).flatMap((k): StripRow[] => {
    const x = nearestOf(k);
    if (k.id === "fuel" && x && p.ahead.strip.mop && x === mopItem) return [];
    if (!x) return [];
    // MOP ze stacją: wiersz na zmianę co STRIP_SWAP_MS — „[dystrybutor] Orlen” i „[P] MOP Morawica”.
    if (x.poi.kind === "services" && (x.poi as RoutePoi).brand && k.id !== "toll") {
      const fuelPhase = Math.floor(now / STRIP_SWAP_MS) % 2 === 0;
      return [{ key: `${k.id}:${fuelPhase}`, icon: <AheadIcon kind={fuelPhase ? "fuel" : "mop"} />, label: fuelPhase ? stationLabel((x.poi as RoutePoi).brand) : (x.poi.name || "MOP"), km: x.km, tone: fuelPhase ? "swap fuel" : "swap" }];
    }
    return [{ key: k.id, icon: <AheadIcon kind={k.id === "fuel" ? "fuel" : x.poi.kind} />, label: stripLabel(k.id, x.poi), km: x.km, tone: k.id === "toll" ? "toll" : undefined }];
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
  // Dotknięcie dystansu / przyjazdu przy punkcie pośrednim przed nami: przełącza „do celu” ↔ „do punktu” (km i godzina z planu z przerwami).
  const viaNext = route && pos && !track.off
    ? viaAhead(route, fresh).map((v) => ({ v, km: locate(route.points, v)?.km, n: (route.via ?? []).indexOf(v) + 1 })).find((x): x is { v: NavPlace; km: number; n: number } => x.km !== undefined && x.km > pos.km)
    : undefined;
  const showVia = toVia && !!viaNext;
  const target = (() => {
    if (!showVia || !viaNext || !pos) return { label: "Do celu", arrLabel: "Przyjazd", km: p.route.totalKm, clock: arrival.clock, left: arrival.left, note: arrival.note };
    const km = Math.min(p.route.totalKm, viaNext.km - pos.km);
    const t = p.plan ? timeAtKm(p.plan, p.route, km) : undefined;
    const name = `punktu ${viaNext.n || 1}`;
    return { label: `Do ${name}`, arrLabel: `Przyjazd · pkt ${viaNext.n || 1}`, km, clock: t ? fmtClock(t, now) : "—", left: t ? fmtDuration(Math.max(0, t - now) / 60_000) : undefined, note: viaNext.v.label };
  })();
  // Nad paskiem: droga, którą jedziemy, i kilometr drogi (słupki z OSM), np. „S19 · Droga ekspresowa im. Lecha Kaczyńskiego · km 432”.
  // Droga z manewrów; gdy słupki przy trasie mówią o innej drodze (wjazd na A1 bez nazwy w manewrze) — numer ze słupków.
  const insRoad = onRoute ? roadAt(route.instructions, pos.km) : undefined;
  const msRef = onRoute ? route.milestones?.filter((m) => m.ref && Math.abs(m.km - pos.km) <= 2).sort((a, b) => Math.abs(a.km - pos.km) - Math.abs(b.km - pos.km))[0]?.ref : undefined;
  const road = msRef && insRoad?.ref?.replace(/^D[KW]\s?/, "") !== msRef.replace(/^([AS]\d{1,2})[a-z]$/i, "$1") ? { ref: msRef.replace(/^([AS]\d{1,2})[a-z]$/i, "$1") } as { ref?: string; name?: string } : insRoad;
  const roadKm = onRoute ? milestoneAt(route.milestones, pos.km, road?.ref) : undefined;
  const roadLine = road && (road.ref || road.name) ? (
    <div className="nm-roadline">
      {road.ref && <b className={`nm-roadref ${/^\d{3}$/.test(road.ref) ? "yellow" : /^E/.test(road.ref) ? "green" : ""}`}>{road.ref}</b>}
      {road.name && <span>{road.name}</span>}
      {roadKm !== undefined && (
        <em>
          {/* Słupek kilometrowy: biały słupek z dwoma czerwonymi paskami u góry. */}
          <svg viewBox="0 0 12 22" aria-hidden><rect x="2" y="1" width="8" height="20" rx="2.2" fill="#fff" stroke="#1b2229" strokeWidth="1" /><rect x="2.5" y="3.2" width="7" height="2.4" fill="#e8322c" /><rect x="2.5" y="7.2" width="7" height="2.4" fill="#e8322c" /></svg>
          {Math.round(roadKm)} km
        </em>
      )}
    </div>
  ) : null;
  // Propozycja miejsca na przerwę: najdalszy MOP / parking TIR, do którego dojedziemy z zapasem przed przerwą z planu.
  const bs = p.settings?.value.breakStop;
  const breakSuggest = (() => {
    if (!bs?.on || !onRoute || sc.stop || !p.plan || !p.nav?.onVia || !route.pois) return undefined;
    const evs = p.plan.events;
    const iStop = evs.findIndex(isStop);
    if (iStop < 0) return undefined;
    const driveLeftMin = evs.slice(0, iStop).filter((e) => e.kind === "drive").reduce((a, e) => a + (e.end - Math.max(e.start, now)) / 60_000, 0);
    const kmAfter = (min: number) => p.route.advance(0, min);
    // Postój dodany wcześniej z propozycji (punkt pośredni „Przerwa”) — czy wciąż zdążymy (korek, wolniejsza jazda)?
    const vias = viaAhead(route, fresh);
    const planned = vias.map((v) => ({ v, km: locate(route.points, v)?.km })).find((x) => x.v.sub === BREAK_VIA && x.km !== undefined && x.km > pos.km);
    if (planned) {
      const needMin = p.route.driveMinutes(0, Math.max(0, planned.km! - pos.km));
      if (needMin <= driveLeftMin) return undefined;
      // Nie zdążymy — szukamy bliższego miejsca (bez zapasu, gdy z zapasem już nic nie ma).
      const s2 = breakStopFor(route.pois.filter((x) => poiVisible(route, x) && x.km < planned.km! - 0.5), pos.km, driveLeftMin, bs.marginMin, kmAfter)
        ?? breakStopFor(route.pois.filter((x) => poiVisible(route, x) && x.km < planned.km! - 0.5), pos.km, driveLeftMin, 0, kmAfter);
      return s2 ? { ...s2, key: `late:${evs[iStop].start}:${s2.place.id}`, stop: evs[iStop], replace: planned.v } : undefined;
    }
    const s1 = breakStopFor(route.pois.filter((x) => poiVisible(route, x)), pos.km, driveLeftMin, bs.marginMin, kmAfter);
    if (!s1) return undefined;
    // Już jest punktem pośrednim (≤ 1 km) — nie proponujemy drugi raz.
    if ((route.via ?? []).some((v) => Math.abs((locate(route.points, v)?.km ?? -99) - s1.place.km) < 1)) return undefined;
    return { ...s1, key: `${evs[iStop].start}:${s1.place.id}`, stop: evs[iStop], replace: undefined as NavPlace | undefined };
  })();
  // Pod dystansem: czas jazdy do celu (albo punktu) — bez postojów; przyjazd z postojami jest na kafelku obok.
  const driveText = fmtDuration(p.route.driveMinutes(0, Math.min(p.route.totalKm, target.km)));
  const flip = viaNext ? () => setToVia((x) => !x) : undefined;
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
  /** Cała pozostała trasa z góry (jak w TomTom) — od nas do celu, z marginesem na przyciski i paski. */
  const showOverview = () => {
    if (!route) return;
    const pts = route.points.filter((x) => x[2] >= (pos?.km ?? 0));
    if (pts.length < 2) return;
    const w = window.innerWidth, h = window.innerHeight;
    const xs = pts.map((x) => worldPx({ lat: x[0], lon: x[1] }, 0));
    const [x0, x1] = [Math.min(...xs.map((q) => q[0])), Math.max(...xs.map((q) => q[0]))];
    const [y0, y1] = [Math.min(...xs.map((q) => q[1])), Math.max(...xs.map((q) => q[1]))];
    const zoom = Math.log2(Math.min((w * 0.62) / Math.max(1e-9, x1 - x0), (h * 0.5) / Math.max(1e-9, y1 - y0)));
    const lat = pts.reduce((a, x) => a + x[0], 0) / pts.length;
    // Środek prostokąta (nie średnia punktów): z worldPx odwrotnie przez szerokości skrajne.
    const lats = pts.map((x) => x[0]), lons = pts.map((x) => x[1]);
    setPin(null);
    const z = Math.max(MIN_VIEW_ZOOM, Math.min(15, zoom));
    // Panel przycisków po lewej zasłania ok. 70 px — środek widoku przesuwamy o połowę tego w lewo (trasa trochę w prawo).
    const shiftLon = (35 / (512 * 2 ** z)) * 360;
    setBrowse({ center: { lat: (Math.min(...lats) + Math.max(...lats)) / 2 || lat, lon: (Math.min(...lons) + Math.max(...lons)) / 2 - shiftLon }, zoom: z, bearing: 0, overview: true });
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
    ...(p.license ? [{ id: "license", icon: "license" as const, label: "Licencja", sub: p.license.status, onClick: () => setMenuPage("license") }] : []),
    { id: "support", icon: "support", label: "Wsparcie", onClick: () => setMenuPage("support") },
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
      p.settings!.onChange({ vehicle: { ...v, avoid: { ...NO_AVOID, ...v.avoid, tolls: !avoidTolls } } });
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
    if (k === "support") return { heading: "Wsparcie", content: <SupportContent /> };
    if (k === "license") return { heading: "Licencja", content: p.license?.page };
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
          : { label: "Przerwa", value: "Bez przerwy", sub: "dojedziesz bez postoju", tone: "" };
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
    <div className={`hud navmode ${p.mapVector?.theme === "day" ? "day" : ""} ${p.settings?.value.mapTheme === "glass" ? "glass" : ""}`}>
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

      {/* Menu ⋯ — prostokąt przy pasku na dole po prawej (zawsze widoczny, także przy zwiniętym panelu). */}
      <button className="nm-menu-btn" onClick={() => setMenu(true)} aria-label="Menu: cel, dom, przerwa, ustawienia, licencja">
        <Icon name="dots" />
      </button>

      {/* Kafelki: do celu, przyjazd, przerwa, trasa. Telefon pionowo: dwa pierwsze, reszta po dotknięciu uchwytu; poziomo: pasek na dole; tablet: 2×2 u góry. */}
      <div className={`nm-tiles ${tilesOpen ? "open" : ""}`}>
        {roadLine}
        {/* Uchwyt = dyskretna przerwa (telefon pionowo): filiżanka, za ile i cienki pasek 4,5 h jazdy; dotknięcie rozwija kafelki. */}
        <button className={`nm-tiles-handle ${stopItem.tone}`} onClick={() => setTilesOpen(!tilesOpen)} aria-expanded={tilesOpen} aria-label={tilesOpen ? "Zwiń" : `${stopItem.label} ${stopItem.value} — przerwa i trasa`}>
          {!tilesOpen && (
            <span className="nm-break-mini">
              <Icon name={sc.stop ? "bed" : "coffee"} />
              <b>{stopItem.value === "Bez przerwy" ? "bez przerwy" : sc.stop ? stopItem.value : `za ${stopItem.value}`}</b>
              <em aria-hidden><i style={{ width: `${Math.round(breakUsed * 100)}%` }} /></em>
            </span>
          )}
        </button>
        <button className={`nm-tile ${flip ? "flip" : ""} ${showVia ? "via" : ""}`} onClick={flip} disabled={!flip} aria-label={flip ? "Przełącz: do celu / do punktu pośredniego" : undefined}>
          <span className="nm-dest"><small>{target.label}</small><b>{fmtKm(target.km)}</b><i><Icon name="flag" />{driveText}</i></span>
        </button>
        <button className={`nm-tile ${!showVia && arrival.bad ? "bad" : ""} ${flip ? "flip" : ""} ${showVia ? "via" : ""}`} onClick={flip} disabled={!flip}>
          <Icon name="clock" />
          <span><small>{target.arrLabel}</small><b>{clockOnly(target.clock).time}</b><i>{[clockOnly(target.clock).day, target.left !== undefined ? `za ${target.left}` : target.note].filter(Boolean).join(" · ")}</i></span>
        </button>
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
        <div className="nm-side-col">
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
        </div>
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
        <button className={`nm-btn nm-recenter ${browse ? "on" : ""}`} onClick={() => (browse ? setBrowse(null) : showOverview())} aria-label={browse ? "Wróć do prowadzenia" : "Pokaż całą trasę"}>
          <Icon name={browse ? "nav" : "route"} />
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

      {strip.length > 0 && !browse?.overview && (
        <button className="nm-ahead" onClick={() => setAheadList(true)} aria-label="Po drodze — pokaż listę">
          {strip.map((r) => (
            <span key={r.key} className={r.alert ? "alert" : r.tone ?? ""}>
              {r.icon}
              <b><ScrollName text={r.label} /></b>
              <strong>{fmtAheadKm(r.km)}</strong>
              <Icon name="chevron" className="nm-ahead-go" />
            </span>
          ))}
        </button>
      )}
      {notice && <div className="nm-notice">{notice}</div>}
      {worksOpen && p.report?.onWorksEnd && (
        <div className="nm-works-end">
          <button className="end" onClick={async () => {
            try { const km = await p.report!.onWorksEnd!(worksOpen); setWorksMsg(`Dziękujemy — roboty na ${String(km).replace(".", ",")} km`); setWorksOpen(null); setTimeout(() => setWorksMsg(null), 4000); }
            catch (e) { setWorksMsg(e instanceof Error ? e.message : "Nie udało się wysłać."); }
          }}><ReportIcon kind="roadworks" />Koniec robót</button>
          <button className="x" aria-label="Anuluj zaznaczanie końca" onClick={() => setWorksOpen(null)}>×</button>
        </div>
      )}
      {worksMsg && <div className="nm-works-msg">{worksMsg}</div>}
      {breakSuggest && breakDismissed !== breakSuggest.key && !pin && !hold && !menu && (
        <div className="nm-break-suggest" role="dialog" aria-label="Propozycja miejsca na przerwę">
          <AheadIcon kind={breakSuggest.place.kind} />
          <div className="bs-text">
            <small className={breakSuggest.replace ? "late" : ""}>{breakSuggest.replace ? `Nie zdążysz do ${breakSuggest.replace.label} — zamiast tego` : `Przerwa ${breakSuggest.stop.kind === "break" ? "45 min" : "dzienna"} — proponuję`}</small>
            <b>{breakSuggest.place.name && !/^zgłoszenie/i.test(breakSuggest.place.name) ? breakSuggest.place.name : AHEAD_KIND[breakSuggest.place.kind]}</b>
            <span>za {fmtKm(breakSuggest.place.km - pos!.km)} · zapas ok. {fmtDuration(Math.max(0, breakSuggest.spareMin))} jazdy</span>
          </div>
          <div className="bs-actions">
            <button className="primary" onClick={() => {
              const pl = breakSuggest.place;
              const place = { label: pl.name || AHEAD_KIND[pl.kind], sub: BREAK_VIA, lat: pl.lat, lon: pl.lon };
              const keep = viaAhead(route!, fresh).filter((v) => v !== breakSuggest.replace);
              p.nav!.onVia!(insertVia(route!, keep, place)).catch((e) => setWorksMsg(e instanceof Error ? e.message : "Nie udało się dodać."));
              setBreakDismissed(breakSuggest.key);
            }}>{breakSuggest.replace ? "Zmień postój" : "Dodaj do trasy"}</button>
            <button className="ghost" onClick={() => setBreakDismissed(breakSuggest.key)}>Nie teraz</button>
          </div>
        </div>
      )}

      {/* Tablet: pasek na dole — do celu, przyjazd i postęp trasy (zielone = przejechane, kropki = punkty pośrednie i postoje). */}
      <div className="nm-progress">
        {roadLine}
        <button className={`nm-progress-item ${flip ? "flip" : ""} ${showVia ? "via" : ""}`} onClick={flip} disabled={!flip}><span className="nm-dest"><small>{showVia ? `Pkt ${viaNext!.n || 1}` : target.label}</small><b>{fmtKm(target.km)}</b><i><Icon name="flag" />{driveText}</i></span></button>
        <button className={`nm-progress-item ${!showVia && arrival.bad ? "bad" : ""} ${flip ? "flip" : ""} ${showVia ? "via" : ""}`} onClick={flip} disabled={!flip}><Icon name="clock" /><span><b>{target.clock}</b><small>{target.left !== undefined ? `${showVia ? "Pkt" : "Przyjazd"} za ${target.left}` : target.note}</small></span></button>
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
        <NavPage heading="Co robiłeś?" onBack={() => setGapOpen(false)} onRecenter={() => { setGapOpen(false); setBrowse(null); }}>
            <GapSheet review={p.gapReview} onAnswer={(a) => { p.onGapAnswer!(a); setGapOpen(false); }} onLater={() => setGapOpen(false)} />
        </NavPage>
      )}
      {maneuvers && route && (
        <NavPage heading="Wskazówki" onBack={() => setManeuvers(false)} onRecenter={() => { setManeuvers(false); setBrowse(null); }}>
            <ul className="nm-man-list">
              {route.instructions.filter((i) => i.km > (pos?.km ?? 0) + 0.01).slice(0, 20).map((i) => (
                <li key={i.km + i.maneuver}>
                  <ManeuverIcon ins={i} />
                  <span><b>{i.text}</b>{i.signpost && <small>→ {i.signpost}</small>}</span>
                  <strong>{fmtDist(Math.max(0, i.km - (pos?.km ?? 0)))}</strong>
                </li>
              ))}
            </ul>
        </NavPage>
      )}

      {warnList && (
        <NavPage heading="Ostrzeżenia na trasie" onBack={() => setWarnList(false)} onRecenter={() => { setWarnList(false); setBrowse(null); }}>
            {upcoming.length ? (
              <ul className="nm-warn-list">
                {upcoming.map((w) => (
                  <li key={w.source + w.id + w.kind} className={w.soft ? "soft" : ""}>
                    <i><ReportIcon kind={WARN_ICON[w.kind] ?? w.kind} /></i>
                    <span className="nwl-text"><b>{warningText(w)}</b>{(w.name || w.source === "report") && <small>{[w.name, w.source === "report" ? "zgłoszenie kierowcy" : ""].filter(Boolean).join(" · ")}</small>}</span>
                    <strong>{pos ? (w.toKm !== undefined && pos.km >= w.km ? `trwa · ${fmtKm(w.toKm - pos.km)}` : fmtKm(Math.max(0, w.km - pos.km))) : `km ${Math.round(w.km)}`}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Brak znanych ograniczeń, fotoradarów i kontroli (dane OpenStreetMap i zgłoszenia kierowców, Polska).</p>
            )}
        </NavPage>
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
        <NavPage heading={sc.stop ? (sc.stop.dayEnd ? "Odpoczynek" : "Postój") : "Przerwa"} onBack={() => setSheet(false)} onRecenter={() => { setSheet(false); setBrowse(null); }}>
            {sc.stop ? (
              <ActiveStopPanel stop={sc.stop} driver={sc.driver} onEnd={(t) => { sc.onEnd(t); setSheet(false); }} onCancel={() => { sc.onCancel(); setSheet(false); }} onTarget={sc.onTarget} onStartDay={() => { sc.onStartDay(); setSheet(false); }} />
            ) : (
              <>
                <StopPicker driver={sc.driver} now={now} onCancel={() => setSheet(false)} onStart={sc.onStart} />
                <button className="ghost day-btn" onClick={() => { if (endDay()) setSheet(false); }}>Zakończ dzień</button>
              </>
            )}
        </NavPage>
      )}
      {reporting && p.report && (
        <NavPage heading="Zgłoś" onBack={() => setReporting(false)} onRecenter={() => { setReporting(false); setBrowse(null); }}>
            {!reportAt && route && pos && p.report.onBadTurn && <BadTurn route={route} km={pos.km} onSend={p.report.onBadTurn} onDone={() => setReporting(false)} />}
            <ReportSheet onWorksStart={p.report.onWorksEnd ? (id) => setWorksOpen(id) : undefined} onSend={(kind, value, note) => p.report!.onSend(kind, value, reportAt ?? undefined, note)} onClose={() => setReporting(false)} located={reportAt !== null || p.live !== null} place={reportAt ? reportAt.name : undefined} />
        </NavPage>
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
type MenuKey = "main" | "route" | "settings" | "support" | "license" | SettingsSection;
const SETTINGS_PAGES: { id: SettingsSection; label: string; icon: MenuItem["icon"] }[] = [
  { id: "look", label: "Wygląd", icon: "look" },
  { id: "voice", label: "Głos", icon: "voice" },
  { id: "planning", label: "Planowanie trasy", icon: "planning" },
  { id: "vehicle", label: "Profil pojazdu", icon: "vehicle" },
  { id: "ahead", label: "Po drodze", icon: "ahead" },
];
/** Strona wyżej w menu (powrót); z głównej — mapa. */
const MENU_PARENT: Record<MenuKey, MenuKey | null> = { main: null, route: "main", settings: "main", support: "main", license: "main", look: "settings", voice: "settings", planning: "settings", vehicle: "settings", ahead: "settings" };

/** Rodzaj ostrzeżenia → piktogram ze zgłoszeń (ReportIcon). */
const WARN_ICON: Record<string, string> = { axle: "weight", hgv: "truck_ban", red_light: "camera", width: "height", length: "height", incline: "other", curve: "other" };

const WORKS_KEY = "roadpilot:worksOpen";
/** MOP ze stacją na pasku: co tyle ms zmiana „stacja (marka)” ↔ „parking (nazwa MOP-u)”. */
const STRIP_SWAP_MS = 3500;
/** Podpis punktu pośredniego dodanego z propozycji przerwy — po nim rozpoznajemy „nasz” postój do ponownego sprawdzenia. */
const BREAK_VIA = "Przerwa";

/** „jutro 02:52” → godzina na kafelek i dzień do drugiego wiersza (wąski kafelek na telefonie). */
function clockOnly(clock: string): { time: string; day: string } {
  const m = /^(.*?)\s*(\d{1,2}:\d{2})$/.exec(clock);
  return m && m[1] ? { time: m[2], day: m[1] } : { time: clock, day: "" };
}

/** Przedrostek, który zostaje na miejscu, gdy reszta nazwy się przewija („MOP” + „Skoszewy Zachód”). */
const NAME_PREFIX = /^(MOP|Parking(?: TIR)?|Stacja(?: paliw)?|PPO|Bramki)\s+/i;

/**
 * Nazwa za długa na pasek: przedrostek (MOP, Parking…) stoi, a reszta przewija się do końca, chwilę stoi i wraca.
 * Przesunięcie mierzymy po wyrenderowaniu (--shift); krótkie nazwy się nie ruszają.
 */
function ScrollName({ text }: { text: string }) {
  const m = NAME_PREFIX.exec(text);
  const prefix = m ? m[1] : "";
  const rest = m ? text.slice(m[0].length) : text;
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const b = box.current, i = inner.current;
      if (b && i) setShift(Math.max(0, Math.ceil(i.scrollWidth - b.clientWidth)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span className="scroll-name">
      {prefix && <span className="sn-prefix">{prefix}</span>}
      <span className="sn-box" ref={box}>
        <span ref={inner} className={shift > 2 ? "sn-move" : ""} style={shift > 2 ? ({ "--shift": `-${shift}px`, "--sn-dur": `${Math.max(5, 3 + shift / 18)}s` } as React.CSSProperties) : undefined}>{rest}</span>
      </span>
    </span>
  );
}

/** Zwinięty panel przycisków — wygoda jednego urządzenia (localStorage), nie stan synchronizowany. */
const SIDE_KEY = "roadpilot:navSide";
function readSideOpen() {
  try { return localStorage.getItem(SIDE_KEY) !== "0"; } catch { return true; }
}

interface StripRow { key: string; icon: ReactNode; label: string; km: number; alert?: boolean; tone?: string }

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
  { id: "toll", short: "Bramki", kinds: ["toll"] },
];

/** Nazwa na pasku: stacja — marka (Orlen, Shell…), parking i MOP — własna nazwa (bez „MOP ” na początku), inaczej rodzaj. */
function stripLabel(id: keyof AheadStrip, p: Pick<RoutePoi, "kind" | "name"> & { brand?: string }): string {
  const n = (p.name ?? "").trim();
  const generic = !n || /^(zgłoszenie kierowcy|parking|mop|miejsce obsługi podróżnych)$/i.test(n);
  if (id === "fuel") return stationLabel(p.brand ?? (p.kind === "fuel" ? n : ""));
  if (id === "mop") return generic ? "MOP" : n;
  if (id === "parking") return generic ? "Parking TIR" : n;
  if (id === "toll") return generic || /^(bramki|ppo)/i.test(n) ? "Bramki" : n.replace(/^PPO\s*/i, "Bramki ");
  return n || id;
}
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
  const c = POI_COLOR[kind];
  return (
    <i className={`nm-ahead-ico k-${kind}`} aria-hidden>
      <svg viewBox="-12 -12 24 24">
        {kind === "fuel" ? <FuelGlyph cut={c} scale={0.95} />
          : kind === "toll" ? <TollGlyph cut={c} scale={0.85} />
          : <LetterGlyph letter="P" size={15} />}
      </svg>
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
    <NavPage heading="Po drodze" onBack={onClose}>
        <p className="nmm-sub">{km} km przed Tobą{straight ? " — w linii prostej, bez trasy" : " — po trasie"}</p>
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
    </NavPage>
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
        {onSnap && <button className="primary" disabled={!road} onClick={() => road && onReport(road)}>Zgłoś tutaj</button>}
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
