// Konfiguracja HUD: styl (zwykły / minimalistyczny) i widoczne elementy — osobno dla każdego stylu.

export type HudStyle = "full" | "minimal" | "nav";

export type HudItem =
  | "clock" | "dest" | "avg" | "weather" | "road" | "route" | "stats" | "arrival"
  | "drive" | "break" | "work" | "better" | "parking" | "service" | "apps" | "floating" | "nav";

export type HudItems = Record<HudItem, boolean>;

/** Kolejność = kolejność w Ustawieniach. Prędkość jest zawsze widoczna. */
export const HUD_ITEMS: { id: HudItem; label: string; hint?: string }[] = [
  { id: "nav", label: "Nawigacja: manewr, pasy, ograniczenie", hint: "Premium — gdy wyznaczysz trasę; zastępuje animację drogi" },
  { id: "clock", label: "Godzina i data" },
  { id: "dest", label: "Do celu (km)" },
  { id: "arrival", label: "Przyjazd", hint: "z przerwami i odpoczynkami" },
  { id: "break", label: "Następna przerwa / odpoczynek" },
  { id: "drive", label: "Czas jazdy dziś" },
  { id: "work", label: "Czas pracy" },
  { id: "route", label: "Oś trasy" },
  { id: "stats", label: "Pokonano / Pozostało" },
  { id: "road", label: "Nazwa drogi i miejscowość", hint: "OpenStreetMap, przybliżona pozycja ~1 km" },
  { id: "avg", label: "Średnia prędkość" },
  { id: "weather", label: "Pogoda" },
  { id: "better", label: "Lepszy scenariusz" },
  { id: "parking", label: "Najbliższy MOP" },
  { id: "service", label: "Serwis" },
  { id: "apps", label: "Muzyka i zgłoszenia" },
  { id: "floating", label: "Przycisk pływającego okienka" },
];

const all = (on: boolean): HudItems => Object.fromEntries(HUD_ITEMS.map((i) => [i.id, on])) as HudItems;

export const DEFAULT_HUD_ITEMS: Record<HudStyle, HudItems> = {
  full: all(true),
  // Minimalistyczny: tylko to, co potrzebne w czasie jazdy.
  // Nawigacja: widok trasy zamiast osi i kafelków, na dole kilka liczb.
  nav: { ...all(false), nav: true, clock: true, dest: true, arrival: true, break: true, road: true, apps: true, floating: true },
  minimal: { ...all(false), nav: true, clock: true, dest: true, arrival: true, break: true, drive: true, road: true, route: true, apps: true, floating: true },
};

export const HUD_STYLES: { id: HudStyle; label: string; hint: string }[] = [
  { id: "full", label: "Zwykły", hint: "Kafelki z paskami, oś trasy ze znacznikami, wszystkie informacje." },
  { id: "minimal", label: "Minimalistyczny", hint: "Duża prędkość i kilka liczb bez ramek — mniej rozprasza." },
  { id: "nav", label: "Nawigacja", hint: "Widok trasy wokół Ciebie (zielona strzałka), manewr i pasy u góry. Premium." },
];
