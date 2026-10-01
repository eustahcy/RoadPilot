import { GlVector } from "./GlMap";
import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { currentPosition, fetchRoutes, NavPlace, NavRoute, RouteType, searchPlaces, Vehicle } from "../nav";
import { RouteCompare } from "./RouteCompare";
import { PlaceActions, PlaceShortcuts } from "./SavedPlaces";
import { SavedPlaces } from "../core/places";

/** Dane do wyznaczania trasy prosto z HUD (Premium). */
export interface HudPlanner {
  token: string;
  vehicle: Vehicle;
  routeType: RouteType;
  /** Pozycja z GPS HUD — inaczej pytamy telefon jednorazowo. */
  position: { lat: number; lon: number } | null;
  onRoute: (r: NavRoute) => void;
  /** Styl własnej mapy do porównania tras. */
  mapStyle?: GlVector;
  /** Dom, ulubione, ostatnie cele. */
  places: SavedPlaces;
  onPlaces: (p: SavedPlaces) => void;
}

const LETTERS = ["A", "B", "C"];

/**
 * Wyszukiwarka celu i porównanie do 3 tras w HUD: po wyborze celu od razu liczymy trasy (główna + alternatywy),
 * podgląd na mapie i zestawienie; „Jedź” ustawia wybraną trasę. Do tego czasu bieżąca nawigacja zostaje bez zmian.
 */
export function HudRoutePicker({ planner, dest: current, onClose }: { planner: HudPlanner; dest: NavPlace | null; onClose: () => void }) {
  const [dest, setDest] = useState<NavPlace | null>(current);
  const [editing, setEditing] = useState(!current);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NavPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<NavRoute[]>([]);
  const [selectedAt, setSelectedAt] = useState<number | undefined>(undefined);

  // Podpowiedzi po chwili przerwy w pisaniu i od 3 znaków — mniej zapytań do limitu TomTom.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return setResults([]);
    let alive = true;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchPlaces(planner.token, q, planner.position);
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
  }, [query]);

  const compute = async (to: NavPlace) => {
    setBusy(true);
    setError(null);
    setRoutes([]);
    try {
      const from = planner.position ?? (await currentPosition());
      const all = await fetchRoutes(planner.token, from, to, planner.vehicle, Date.now(), planner.routeType);
      setRoutes(all);
      setSelectedAt(all[0]?.at);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (d: NavPlace) => {
    setDest(d);
    setEditing(false);
    setQuery("");
    setResults([]);
    compute(d);
  };

  const idx = routes.findIndex((r) => r.at === selectedAt);
  const go = () => {
    if (idx < 0) return;
    planner.onRoute(routes[idx]);
    onClose();
  };

  return (
    <div className="hud-planner">
      <div className="stop-label">Cel i trasy</div>
      {dest && !editing ? (
        <div className="nav-dest">
          <span>
            <strong>{dest.label}</strong>
            {dest.sub && <small>{dest.sub}</small>}
          </span>
          <button className="ghost" onClick={() => setEditing(true)}>Zmień</button>
        </div>
      ) : null}
      {dest && !editing && <PlaceActions place={dest} places={planner.places} onPlaces={planner.onPlaces} />}
      {(!dest || editing) && (
        <div className="nav-search">
          <input type="search" value={query} placeholder="Adres lub nazwa firmy, np. BCT Gdańsk" autoFocus onChange={(e) => { setQuery(e.target.value); setError(null); }} />
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
          {query.trim().length < 3 && <PlaceShortcuts places={planner.places} onPlaces={planner.onPlaces} onPick={pick} />}
          {dest && <button className="text-btn" onClick={() => { setEditing(false); setQuery(""); }}>Anuluj</button>}
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}
      {busy && <p className="muted">Wyznaczam trasy…</p>}

      {routes.length > 0 && !editing && (
        <>
          {routes.length === 1 && <p className="muted small">Brak sensownych tras alternatywnych — jest tylko jedna.</p>}
          <RouteCompare routes={routes} selectedAt={selectedAt} token={planner.token} onPick={(r) => setSelectedAt(r.at)} mapStyle={planner.mapStyle} />
        </>
      )}

      {!editing && dest && (
        <div className="row-buttons">
          {routes.length > 0 ? (
            <button className="primary" onClick={go} disabled={idx < 0}>Jedź trasą {LETTERS[idx] ?? ""}</button>
          ) : (
            <button className="primary" disabled={busy} onClick={() => compute(dest)}>{busy ? "Wyznaczam…" : "Pokaż trasy (do 3)"}</button>
          )}
          {routes.length > 0 && <button className="ghost" disabled={busy} onClick={() => compute(dest)}>Odśwież</button>}
        </div>
      )}
    </div>
  );
}

function message(e: unknown) {
  if (e instanceof ApiError && e.status === 0) return "Brak internetu — nawigacja wymaga połączenia.";
  return e instanceof Error ? e.message : "Coś poszło nie tak.";
}
