import { isFavorite, Place, removeRecent, samePlace, SavedPlaces, setHome, toggleFavorite } from "../core/places";
import { fmtDay, fmtDuration, fmtKm } from "../format";

// Dom, ulubione i ostatnie cele — pod pustą wyszukiwarką celu (Nawigacja i karta Trasa). Bez zapytań do TomTom:
// wybór stąd od razu liczy trasę.

export interface PlacesProps {
  places: SavedPlaces;
  onPlaces: (p: SavedPlaces) => void;
}

/** Skróty pod wyszukiwarką: dom, ulubione, ostatnie (dotknięcie = cel). */
export function PlaceShortcuts({ places, onPlaces, onPick }: PlacesProps & { onPick: (p: Place) => void }) {
  const { home, favorites, recent } = places;
  return (
    <div className="places">
      {home ? (
        <button className="place-home" onClick={() => onPick(home)}>
          <i aria-hidden>⌂</i>
          <span><strong>Dom</strong><small>{home.label}{home.sub ? ` · ${home.sub}` : ""}</small></span>
        </button>
      ) : (
        <p className="muted small">Dom: wyszukaj adres, wybierz go i dotknij „Ustaw jako dom”.</p>
      )}
      {favorites.length > 0 && (
        <>
          <div className="places-head">Ulubione</div>
          <ul className="nav-results places-list">
            {favorites.map((f) => (
              <li key={`${f.lat},${f.lon}`}>
                <button onClick={() => onPick(f)}>
                  <strong>★ {f.label}</strong>
                  {f.sub && <small>{f.sub}</small>}
                </button>
                <button className="place-x" aria-label={`Usuń ${f.label} z ulubionych`} onClick={() => onPlaces(toggleFavorite(places, f))}>×</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className="places-head">Ostatnie trasy</div>
          <ul className="nav-results places-list">
            {recent.map((r) => (
              <li key={`${r.to.lat},${r.to.lon}`}>
                <button onClick={() => onPick(r.to)}>
                  <strong>{r.to.label}</strong>
                  <small>
                    {fmtDay(r.at)}
                    {r.lengthKm !== undefined ? ` · ${fmtKm(r.lengthKm)}` : ""}
                    {r.travelMin !== undefined ? ` · ${fmtDuration(r.travelMin)} jazdy` : ""}
                    {r.to.sub ? ` · ${r.to.sub}` : ""}
                  </small>
                </button>
                <button className="place-x" aria-label={`Usuń ${r.to.label} z ostatnich`} onClick={() => onPlaces(removeRecent(places, r.to))}>×</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Przy wybranym celu: do ulubionych / ustaw jako dom (drugie dotknięcie cofa). */
export function PlaceActions({ place, places, onPlaces }: PlacesProps & { place: Place }) {
  const fav = isFavorite(places, place);
  const home = samePlace(places.home, place);
  return (
    <div className="place-actions">
      <button className={`place-chip ${fav ? "on" : ""}`} aria-pressed={fav} onClick={() => onPlaces(toggleFavorite(places, place))}>{fav ? "★ W ulubionych" : "☆ Do ulubionych"}</button>
      <button className={`place-chip ${home ? "on" : ""}`} aria-pressed={home} onClick={() => onPlaces(setHome(places, home ? null : place))}>{home ? "⌂ To jest dom" : "⌂ Ustaw jako dom"}</button>
    </div>
  );
}
