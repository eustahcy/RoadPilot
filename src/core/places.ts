// Zapisane miejsca nawigacji: dom, ulubione i ostatnie cele (z długością i czasem ostatniej trasy).
// Czyste funkcje — czas przychodzi parametrem.

/** Miejsce jak z wyszukiwarki (NavPlace). */
export interface Place {
  label: string;
  sub: string;
  lat: number;
  lon: number;
}

/** Ostatni cel: dokąd, kiedy wybrano trasę i jaka była (do listy „Ostatnie”). */
export interface RecentTrip {
  to: Place;
  at: number;
  lengthKm?: number;
  travelMin?: number;
}

export interface SavedPlaces {
  home: Place | null;
  favorites: Place[];
  recent: RecentTrip[];
}

export const PLACES = {
  /** Tyle ostatnich celów pamiętamy. */
  recentMax: 12,
  favoritesMax: 30,
  /** Dwa punkty bliżej niż tyle metrów to to samo miejsce (wyszukiwarka zwraca ten sam adres z drobną różnicą). */
  sameM: 100,
} as const;

export const EMPTY_PLACES: SavedPlaces = { home: null, favorites: [], recent: [] };

/** Odległość w metrach (równoodległościowe przybliżenie — wystarcza do porównania bliskich punktów). */
function distM(a: Place, b: Place) {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * k);
}

export const samePlace = (a: Place | null | undefined, b: Place | null | undefined) => !!a && !!b && distM(a, b) < PLACES.sameM;

/** Tylko pola miejsca — bez dodatkowych pól z wyszukiwarki. */
const clean = (p: Place): Place => ({ label: p.label, sub: p.sub ?? "", lat: p.lat, lon: p.lon });

/** Nowy cel na początek listy „Ostatnie”; ten sam cel wcześniej — przeniesiony (z nowymi danymi trasy). */
export function addRecent(s: SavedPlaces, to: Place, at: number, route?: { lengthKm: number; travelMin: number }): SavedPlaces {
  const item: RecentTrip = { to: clean(to), at, ...(route ? { lengthKm: route.lengthKm, travelMin: route.travelMin } : {}) };
  return { ...s, recent: [item, ...s.recent.filter((r) => !samePlace(r.to, to))].slice(0, PLACES.recentMax) };
}

export const removeRecent = (s: SavedPlaces, p: Place): SavedPlaces => ({ ...s, recent: s.recent.filter((r) => !samePlace(r.to, p)) });

export const isFavorite = (s: SavedPlaces, p: Place) => s.favorites.some((f) => samePlace(f, p));

/** Dodaje do ulubionych albo usuwa, gdy już tam jest. */
export function toggleFavorite(s: SavedPlaces, p: Place): SavedPlaces {
  if (isFavorite(s, p)) return { ...s, favorites: s.favorites.filter((f) => !samePlace(f, p)) };
  return { ...s, favorites: [...s.favorites, clean(p)].slice(-PLACES.favoritesMax) };
}

/** Ustawia dom (null = usuwa). */
export const setHome = (s: SavedPlaces, p: Place | null): SavedPlaces => ({ ...s, home: p ? clean(p) : null });

/** Zapis z konta / starszej wersji → zawsze pełny obiekt z poprawnymi listami. */
export function normalizePlaces(p: Partial<SavedPlaces> | undefined): SavedPlaces {
  const ok = (x: unknown): x is Place => !!x && typeof (x as Place).lat === "number" && typeof (x as Place).lon === "number" && typeof (x as Place).label === "string";
  return {
    home: ok(p?.home) ? p!.home : null,
    favorites: Array.isArray(p?.favorites) ? p!.favorites.filter(ok) : [],
    recent: Array.isArray(p?.recent) ? p!.recent.filter((r) => ok(r?.to) && typeof r.at === "number") : [],
  };
}
