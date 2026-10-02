import { useState } from "react";
import { isFavorite, Place, removeRecent, samePlace, SavedPlaces, setHome, toggleFavorite } from "../core/places";
import { fmtDay, fmtDuration, fmtKm } from "../format";

// Dom, ulubione i ostatnie cele — pod pustą wyszukiwarką celu (Nawigacja i karta Trasa). Bez zapytań do TomTom:
// wybór stąd od razu liczy trasę.

export interface PlacesProps {
  places: SavedPlaces;
  onPlaces: (p: SavedPlaces) => void;
}

export type PlacesTab = "home" | "fav" | "recent";

const ICO = {
  home: <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3 2 12h3v9h5v-6h4v6h5v-9h3z" /></svg>,
  fav: <svg viewBox="0 0 24 24" aria-hidden><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>,
  recent: <svg viewBox="0 0 24 24" aria-hidden><path d="M12 4a8 8 0 1 1-7.4 5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /><path d="M2.5 4.5 4.8 10l5-2.6z" /><path d="M12 8v4.5l3 2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>,
};

/**
 * Skróty pod wyszukiwarką jak w TomTom GO: wiersze Dom / Ulubione / Ostatnie — Dom od razu wybiera cel,
 * Ulubione i Ostatnie rozwijają listę (dotknięcie = cel, „×” usuwa). `initialTab` — od razu rozwinięta lista (z menu Nawigacji).
 */
export function PlaceShortcuts({ places, onPlaces, onPick, initialTab }: PlacesProps & { onPick: (p: Place) => void; initialTab?: PlacesTab }) {
  const { home, favorites, recent } = places;
  const [open, setOpen] = useState<PlacesTab | null>(initialTab ?? null);
  const toggle = (t: PlacesTab) => setOpen((o) => (o === t ? null : t));
  return (
    <div className="places rows">
      <div className="place-line">
        <button className={`place-row ${open === "home" ? "open" : ""}`} onClick={() => (home ? onPick(home) : toggle("home"))}>
          <i>{ICO.home}</i>
          <span><strong>Dom</strong>{home && <small>{home.label}{home.sub ? ` · ${home.sub}` : ""}</small>}</span>
        </button>
        {home && <button className="place-x" aria-label="Usuń adres domu" onClick={() => onPlaces(setHome(places, null))}>×</button>}
      </div>
      {open === "home" && !home && <p className="places-empty">Brak adresu domu. Wyszukaj adres, wybierz go i dotknij „⌂ Ustaw jako dom”.</p>}

      <button className={`place-row ${open === "fav" ? "open" : ""}`} onClick={() => toggle("fav")} aria-expanded={open === "fav"}>
        <i>{ICO.fav}</i>
        <span><strong>Ulubione</strong></span>
        {favorites.length > 0 && <em>{favorites.length}</em>}
      </button>
      {open === "fav" && (favorites.length ? (
        <ul className="places-list">
          {favorites.map((f) => (
            <PlaceRow key={`${f.lat},${f.lon}`} icon="★" title={f.label} sub={f.sub} onPick={() => onPick(f)} onRemove={() => onPlaces(toggleFavorite(places, f))} removeLabel={`Usuń ${f.label} z ulubionych`} />
          ))}
        </ul>
      ) : (
        <p className="places-empty">Brak ulubionych. Wybierz cel i dotknij „☆ Do ulubionych”.</p>
      ))}

      <button className={`place-row ${open === "recent" ? "open" : ""}`} onClick={() => toggle("recent")} aria-expanded={open === "recent"}>
        <i>{ICO.recent}</i>
        <span><strong>Ostatnie</strong></span>
        {recent.length > 0 && <em>{recent.length}</em>}
      </button>
      {open === "recent" && (recent.length ? (
        <ul className="places-list">
          {recent.map((r) => (
            <PlaceRow
              key={`${r.to.lat},${r.to.lon}`}
              icon="↺"
              title={r.to.label}
              sub={[fmtDay(r.at), r.lengthKm !== undefined ? fmtKm(r.lengthKm) : "", r.travelMin !== undefined ? `${fmtDuration(r.travelMin)} jazdy` : "", r.to.sub ?? ""].filter(Boolean).join(" · ")}
              onPick={() => onPick(r.to)}
              onRemove={() => onPlaces(removeRecent(places, r.to))}
              removeLabel={`Usuń ${r.to.label} z ostatnich`}
            />
          ))}
        </ul>
      ) : (
        <p className="places-empty">Tu pojawią się ostatnie cele — każda wyznaczona trasa zapisuje się sama.</p>
      ))}
    </div>
  );
}

function PlaceRow({ icon, title, sub, onPick, onRemove, removeLabel }: { icon: string; title: string; sub?: string; onPick: () => void; onRemove: () => void; removeLabel: string }) {
  return (
    <li>
      <button className="place-go" onClick={onPick}>
        <i aria-hidden>{icon}</i>
        <span><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      </button>
      <button className="place-x" aria-label={removeLabel} onClick={onRemove}>×</button>
    </li>
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
