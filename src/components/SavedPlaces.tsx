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
const PLACES_TABS: { id: PlacesTab; label: string; icon: string }[] = [
  { id: "home", label: "Dom", icon: "⌂" },
  { id: "fav", label: "Ulubione", icon: "★" },
  { id: "recent", label: "Historia", icon: "↺" },
];

/** Skróty pod wyszukiwarką — zakładki Dom / Ulubione / Historia (dotknięcie = cel, „×” usuwa). */
export function PlaceShortcuts({ places, onPlaces, onPick, initialTab }: PlacesProps & { onPick: (p: Place) => void; initialTab?: PlacesTab }) {
  const { home, favorites, recent } = places;
  const [tab, setTab] = useState<PlacesTab>(initialTab ?? (favorites.length ? "fav" : recent.length ? "recent" : "home"));
  const count: Record<PlacesTab, number> = { home: home ? 1 : 0, fav: favorites.length, recent: recent.length };
  return (
    <div className="places">
      <div className="places-tabs" role="tablist">
        {PLACES_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            <i aria-hidden>{t.icon}</i>{t.label}{count[t.id] > 0 && t.id !== "home" && <em>{count[t.id]}</em>}
          </button>
        ))}
      </div>
      {tab === "home" && (home ? (
        <ul className="places-list">
          <PlaceRow icon="⌂" title={home.label} sub={home.sub} onPick={() => onPick(home)} onRemove={() => onPlaces(setHome(places, null))} removeLabel="Usuń adres domu" />
        </ul>
      ) : (
        <p className="places-empty">Brak adresu domu. Wyszukaj adres, wybierz go i dotknij „⌂ Ustaw jako dom”.</p>
      ))}
      {tab === "fav" && (favorites.length ? (
        <ul className="places-list">
          {favorites.map((f) => (
            <PlaceRow key={`${f.lat},${f.lon}`} icon="★" title={f.label} sub={f.sub} onPick={() => onPick(f)} onRemove={() => onPlaces(toggleFavorite(places, f))} removeLabel={`Usuń ${f.label} z ulubionych`} />
          ))}
        </ul>
      ) : (
        <p className="places-empty">Brak ulubionych. Wybierz cel i dotknij „☆ Do ulubionych”.</p>
      ))}
      {tab === "recent" && (recent.length ? (
        <ul className="places-list">
          {recent.map((r) => (
            <PlaceRow
              key={`${r.to.lat},${r.to.lon}`}
              icon="↺"
              title={r.to.label}
              sub={[fmtDay(r.at), r.lengthKm !== undefined ? fmtKm(r.lengthKm) : "", r.travelMin !== undefined ? `${fmtDuration(r.travelMin)} jazdy` : "", r.to.sub ?? ""].filter(Boolean).join(" · ")}
              onPick={() => onPick(r.to)}
              onRemove={() => onPlaces(removeRecent(places, r.to))}
              removeLabel={`Usuń ${r.to.label} z historii`}
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
