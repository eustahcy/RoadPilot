import { GlVector } from "./GlMap";
import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { currentPosition, fetchRoutes, NavPlace, NavRoute, RouteType, searchPlaces, Vehicle } from "../nav";
import { RouteCompare } from "./RouteCompare";
import { PlaceActions, PlacesTab, PlaceShortcuts } from "./SavedPlaces";
import { SavedPlaces } from "../core/places";
import { distanceM } from "../core/gps";

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
/** Skąd zaczynamy (menu Nawigacji): `go` = od razu trasy do tego miejsca (Jedź do domu), `tab` = wyszukiwarka z otwartą zakładką. */
export interface PickerStart { go?: NavPlace; tab?: PlacesTab; /** „Szukaj” — od razu pole wyszukiwania, także gdy jest cel. */ search?: boolean }

/** Kółka kategorii pod wyszukiwarką (jak w TomTom): otwierają listę „Po drodze” z filtrem. */
export type PickerCategory = "parking" | "mop" | "fuel" | "all";
const CATEGORIES: { id: PickerCategory; label: string; cls: string; icon: React.ReactNode }[] = [
  { id: "parking", label: "Parking TIR", cls: "c-truck", icon: <svg viewBox="0 0 24 24" aria-hidden><path d="M3 4h9v9H3zM5.5 11V6h2.2a1.6 1.6 0 0 1 0 3.2H5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M3 14h11v4H3zM14 10h4l3 3.5V18h-7z" /><circle cx="7" cy="19.5" r="1.8" /><circle cx="17.5" cy="19.5" r="1.8" /></svg> },
  { id: "mop", label: "MOP", cls: "c-mop", icon: <b>P</b> },
  { id: "fuel", label: "Stacja", cls: "c-fuel", icon: <svg viewBox="0 0 24 24" aria-hidden><path d="M4 21V4h10v17zM6.5 6.5v4.5h5V6.5zM14 9h2.5l2 2v6.5a1.5 1.5 0 0 0 3 0V8l-3-3" fill="currentColor" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg> },
  { id: "all", label: "Po drodze", cls: "c-more", icon: <svg viewBox="0 0 24 24" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg> },
];

export function HudRoutePicker({ planner, dest: current, onClose, start, full, onCategory }: { planner: HudPlanner; dest: NavPlace | null; onClose: () => void; start?: PickerStart; /** Pełny ekran w stylu TomTom (Nawigacja). */ full?: boolean; onCategory?: (c: PickerCategory) => void }) {
  const [dest, setDest] = useState<NavPlace | null>(start?.go ?? current);
  const [editing, setEditing] = useState(start?.go ? false : !current || !!start?.tab || !!start?.search);
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

  // „Jedź do domu”: trasy liczymy od razu po otwarciu.
  useEffect(() => {
    if (start?.go) compute(start.go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const searchBox = (
    <input type="search" value={query} placeholder={full ? "Adres lub nazwa" : "Adres lub nazwa firmy, np. BCT Gdańsk"} autoFocus onChange={(e) => { setQuery(e.target.value); setError(null); }} />
  );
  const destBox = dest && (
    <div className="nav-dest">
      <span>
        <strong>{dest.label}</strong>
        {dest.sub && <small>{dest.sub}</small>}
      </span>
      <button className="ghost" onClick={() => setEditing(true)}>Zmień</button>
    </div>
  );
  const searching_ = !dest || editing;
  // Odległość w linii prostej od nas (jak „381 km” w TomTom) — przy wynikach i bez trasy.
  const away = (d: NavPlace) => planner.position ? fmtAway(distanceM(planner.position, d) / 1000) : null;

  return (
    <div className={`hud-planner ${full ? "full" : ""}`}>
      {full ? (
        <div className="nmp-head">
          <button className="nmm-back" onClick={onClose} aria-label="Wróć do mapy">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M16 4 6 12l10 8-3-8z" /></svg>
          </button>
          {searching_ ? <div className="nmp-search">{searchBox}</div> : destBox}
        </div>
      ) : (
        <div className="stop-label">Cel i trasy</div>
      )}
      {!full && dest && !editing ? destBox : null}
      {dest && !editing && <PlaceActions place={dest} places={planner.places} onPlaces={planner.onPlaces} />}
      {/* W trakcie jazdy (cel już jest, tras jeszcze nie liczymy) — Dom / Ulubione / Ostatnie od razu, bez „Zmień”. */}
      {dest && !editing && !busy && routes.length === 0 && <PlaceShortcuts places={planner.places} onPlaces={planner.onPlaces} onPick={pick} />}
      {searching_ && (
        <div className="nav-search">
          {!full && searchBox}
          {full && onCategory && query.trim().length < 3 && (
            <div className="nmp-cats">
              {CATEGORIES.map((c) => (
                <button key={c.id} className={c.cls} onClick={() => onCategory(c.id)}><i>{c.icon}</i><span>{c.label}</span></button>
              ))}
            </div>
          )}
          {searching && <p className="muted small">Szukam…</p>}
          {results.length > 0 && (
            <ul className="nav-results">
              {results.map((d, i) => (
                <li key={i}>
                  <button onClick={() => pick(d)}>
                    <span className="nr-text"><strong>{d.label}</strong>{d.sub && <small>{d.sub}</small>}</span>
                    {away(d) && <span className="nr-km">{away(d)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length < 3 && <PlaceShortcuts places={planner.places} onPlaces={planner.onPlaces} onPick={pick} initialTab={start?.tab} />}
          {dest && <button className="text-btn" onClick={() => { setEditing(false); setQuery(""); }}>Anuluj</button>}
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}
      {busy && <p className="muted">Wyznaczam trasy…</p>}

      {routes.length > 0 && !editing && (
        <>
          {routes.length === 1 && <p className="muted small">Brak sensownych tras alternatywnych — jest tylko jedna.</p>}
          {routes[0]?.gate && <p className="gate-note">Trasa prowadzi do wjazdu dla ciężarówek zgłoszonego przez kierowcę.</p>}
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

/** „381 km”, „12 km”, „800 m”. */
function fmtAway(km: number) {
  return km < 1 ? `${Math.round(km * 10) * 100} m` : `${Math.round(km)} km`;
}

function message(e: unknown) {
  if (e instanceof ApiError && e.status === 0) return "Brak internetu — nawigacja wymaga połączenia.";
  return e instanceof Error ? e.message : "Coś poszło nie tak.";
}
