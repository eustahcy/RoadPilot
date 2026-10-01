import { GlVector } from "./GlMap";
import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { fmtDuration, fmtKm, fmtTime } from "../format";
import { ParkingCard } from "./ParkingCard";
import { RouteCompare } from "./RouteCompare";
import { PlaceActions, PlaceShortcuts } from "./SavedPlaces";
import { SavedPlaces } from "../core/places";
import { currentPosition, fetchRoutes, isAlert, NavAccess, NavPlace, NavRoute, RouteType, RouteWarning, searchPlaces, TRAFFIC_ON, Vehicle, warningText } from "../nav";

export interface NavProps {
  access: NavAccess;
  routeType: RouteType;
  /** Token sesji — nawigacja idzie przez konto (Premium). */
  token: string | null;
  enabled: boolean;
  vehicle: Vehicle;
  dest: NavPlace | null;
  route: NavRoute | null;
  /** Świeża pozycja z GPS (gdy śledzenie jest włączone) — inaczej pytamy telefon jednorazowo. */
  position: { lat: number; lon: number } | null;
  onDest: (d: NavPlace | null) => void;
  onRoute: (r: NavRoute) => void;
  onClear: () => void;
  onSettings: () => void;
  /** Styl własnej mapy do porównania tras. */
  mapStyle?: GlVector;
  /** Dom, ulubione, ostatnie cele. */
  places: SavedPlaces;
  onPlaces: (p: SavedPlaces) => void;
}

/** Nawigacja dla ciężarówek (beta): cel z wyszukiwarki i trasa TomTom z danymi pojazdu. */
export function NavCard(p: NavProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NavPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!p.dest);
  /** Trasy z ostatniego wyznaczenia (główna + alternatywy) — do porównania i wyboru. */
  const [options, setOptions] = useState<NavRoute[]>([]);

  // Podpowiedzi po chwili przerwy w pisaniu i od 3 znaków — mniej zapytań do limitu TomTom.
  useEffect(() => {
    const q = query.trim();
    if (!p.enabled || !p.token || q.length < 3) return setResults([]);
    let alive = true;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchPlaces(p.token!, q, p.position);
        if (alive) setResults(r);
      } catch (e) {
        if (alive) setError(message(e));
      } finally {
        if (alive) setSearching(false);
      }
    }, 700);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, p.enabled]);

  if (p.access !== "premium") {
    return (
      <section className="card premium-card">
        <div className="eyebrow">Nawigacja dla ciężarówek · Premium</div>
        <h2>Trasa z wymiarami i masą pojazdu</h2>
        <p className="muted">
          Wyszukiwanie celu, trasa dla ciężarówki (TomTom) z omijaniem niskich wiaduktów, ograniczeń masy i tuneli ADR,
          a w HUD — następny manewr i pasy ruchu.
        </p>
        <p className="premium-note">
          {p.access === "guest" ? "Dostępne w RoadPilot Premium — zaloguj się na konto." : "Dostępne w RoadPilot Premium — wkrótce do kupienia."}
        </p>
      </section>
    );
  }

  const pick = (d: NavPlace) => {
    p.onDest(d);
    setEditing(false);
    setQuery("");
    setResults([]);
    setError(null);
  };

  const compute = async () => {
    if (!p.dest) return;
    setBusy(true);
    setError(null);
    try {
      const from = p.position ?? (await currentPosition());
      const all = await fetchRoutes(p.token!, from, p.dest, p.vehicle, Date.now(), p.routeType);
      setOptions(all);
      p.onRoute(all[0]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const r = p.route && p.dest && p.route.to.lat === p.dest.lat && p.route.to.lon === p.dest.lon ? p.route : null;
  const restrictions = r?.warnings?.filter((w) => !isAlert(w)) ?? [];
  const alerts = r?.warnings?.filter(isAlert) ?? [];
  const v = p.vehicle;

  return (
    <section className="card nav-card">
      <div className="eyebrow">Nawigacja dla ciężarówek · beta</div>
      {p.dest && !editing ? (
        <div className="nav-dest">
          <span>
            <strong>{p.dest.label}</strong>
            {p.dest.sub && <small>{p.dest.sub}</small>}
          </span>
          <button className="ghost" onClick={() => setEditing(true)}>Zmień</button>
        </div>
      ) : null}
      {p.dest && !editing && <PlaceActions place={p.dest} places={p.places} onPlaces={p.onPlaces} />}
      {(!p.dest || editing) && (
        <div className="nav-search">
          <label className="field wide">
            <span className="field-label">Cel — adres lub nazwa firmy</span>
            <input type="search" value={query} placeholder="np. BCT Gdańsk, Kontenerowa 7" autoFocus={editing && !!p.dest} onChange={(e) => { setQuery(e.target.value); setError(null); }} />
          </label>
          {searching && <p className="muted small">Szukam…</p>}
          {results.length > 0 && (
            <ul className="nav-results">
              {results.map((d, i) => (
                <li key={i}>
                  <button onClick={() => pick(d)}>
                    <strong>{d.label}</strong>
                    {d.sub && <small>{d.sub}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length < 3 && <PlaceShortcuts places={p.places} onPlaces={p.onPlaces} onPick={pick} />}
          {p.dest && <button className="text-btn" onClick={() => { setEditing(false); setQuery(""); }}>Anuluj</button>}
        </div>
      )}

      {r && (
        <div className="nav-summary">
          <b>{fmtKm(r.lengthKm)}</b>
          <span>
            {r.engine === "roadpilot" ? "RoadPilot (OSM)" : "TomTom"}: {fmtDuration(r.travelMin)} jazdy{TRAFFIC_ON && r.trafficMin >= 1 ? ` (korki +${fmtDuration(r.trafficMin)})` : ""} · wyznaczona {fmtTime(r.at)}
          </span>
          {r.fallback && <span className="warn-text small">TomTom niedostępny lub limit wyczerpany — trasa z silnika RoadPilot (bez pasów ruchu i korków).</span>}
          {r.ferry && <span className="warn-text">Trasa zawiera prom.</span>}
          {r.warnings && (restrictions.length ? (
            <div className="nav-warnings">
              <b className="warn-text">Na trasie: {restrictions.length} {restrictions.length === 1 ? "miejsce" : restrictions.length < 5 ? "miejsca" : "miejsc"} do sprawdzenia</b>
              <ul>
                {restrictions.slice(0, 8).map((w) => (
                  <li key={w.source + w.id + w.kind}>km {Math.round(w.km)} · {warningText(w)}{w.name ? ` · ${w.name}` : ""}</li>
                ))}
              </ul>
              <small className="muted">Z danych OpenStreetMap i zgłoszeń kierowców — sprawdź znaki; HUD ostrzeże przed każdym miejscem.</small>
            </div>
          ) : <span className="ok-text">Brak znanych ograniczeń dla Twojego pojazdu na trasie (dane OSM, Polska).</span>)}
          {alerts.length > 0 && <span className="muted small">{alertSummary(alerts)} — HUD ostrzeże głosem.</span>}
          <span className="muted small">Przerwy i przyjazd w Planie liczą się z tej trasy (odcinki autostrada / miasto / poza miastem).</span>
        </div>
      )}

      {r && p.token && options.length > 1 && options.some((o) => o.to.lat === r.to.lat && o.to.lon === r.to.lon) && (
        <>
          <div className="stop-label">Porównanie tras</div>
          <RouteCompare routes={options} selectedAt={r.at} token={p.token} onPick={p.onRoute} mapStyle={p.mapStyle} />
        </>
      )}

      {p.dest && !editing && p.token && <ParkingCard dest={p.dest} token={p.token} />}

      {error && <p className="auth-error">{error}</p>}

      <div className="row-buttons">
        <button className="primary" disabled={!p.dest || busy} onClick={compute}>
          {busy ? "Wyznaczam…" : r ? "Wyznacz ponownie" : "Wyznacz trasę dla ciężarówki"}
        </button>
        {r && <button className="ghost" onClick={p.onClear}>Usuń trasę</button>}
      </div>
      <p className="muted small">
        Pojazd: {fmtNum(v.heightM)} m wys. · {fmtNum(v.widthM)} m szer. · {fmtNum(v.lengthM)} m dł. · {fmtNum(v.weightKg / 1000)} t · {v.axles} osi
        {v.adr !== "none" ? ` · ADR ${v.adr}` : ""} — <button className="text-btn" onClick={p.onSettings}>zmień</button>
      </p>
      <p className="muted small">
        Start: Twoja pozycja z GPS. Trasa omija ograniczenia wysokości, masy i tuneli według danych TomTom — zawsze kieruj się
        znakami; RoadPilot nie zastępuje certyfikowanej nawigacji ciężarowej.
      </p>
    </section>
  );
}

const fmtNum = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** „Fotoradary: 4 · odcinkowe pomiary: 1 · kontrole: 2”. */
function alertSummary(alerts: RouteWarning[]) {
  const n = (kinds: string[]) => alerts.filter((w) => kinds.includes(w.kind)).length;
  return [
    ["Fotoradary", n(["camera", "red_light"])],
    ["odcinkowe pomiary", n(["section"])],
    ["kontrole", n(["police", "itd"])],
  ].filter(([, c]) => c).map(([l, c]) => `${l}: ${c}`).join(" · ").replace(/^./, (c) => c.toUpperCase());
}

function message(e: unknown) {
  if (e instanceof ApiError && e.status === 0) return "Brak internetu — nawigacja wymaga połączenia.";
  return e instanceof Error ? e.message : "Coś poszło nie tak.";
}
