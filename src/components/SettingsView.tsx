import { autoTheme } from "../mapStyle";
import { useEffect, useState } from "react";
import { AdminUser, api, ApiError, User } from "../api";
import { DEFAULT_SPEEDS, ROAD_LABELS, ROAD_TYPES } from "../core/route";
import { SERVICE, ServiceInfo, serviceStatus } from "../core/service";
import { fmtHm, fromLocalInput, toLocalInput } from "../format";
import { AppState, floorMinute, Settings } from "../state";
import { SyncStatus } from "../sync";
import { DurationField, NumberField, OptionalNumberField, Toggle } from "./fields";
import { askNotifications, notificationsState } from "./Reminders";
import { EXTENDED_WORK_MIN, WorkSettings } from "../core/workday";
import { MUSIC_APPS, MusicApp } from "../core/apps";
import { DEFAULT_HUD_ITEMS, HUD_ITEMS, HUD_STYLES, HudItems } from "../hudConfig";
import { floatingSupported } from "../floating";
import { DEFAULT_VEHICLE, NavAccess, ROUTE_TYPES, Vehicle } from "../nav";
import { MapDataSection } from "./MapConsent";
import { AdminMap } from "./AdminMap";
import { REPORT_KINDS } from "../collect";
import { FriendsApi } from "../friends";
import { FriendsSettings } from "./Friends";

interface Props {
  navAccess: NavAccess;
  /** Kategoria otwarta od razu (np. z karty nawigacji w Trasie). */
  initialCategory?: SettingsCategory | null;
  state: AppState;
  now: number;
  onSettings: (s: Settings) => void;
  onPlanTime: (t: number | null) => void;
  onReset: () => void;
  account: AccountProps;
  /** Znajomi: API z konta (null bez konta) i czy GPS jest włączony (wysyłka obecności). */
  friends: { api: FriendsApi | null; gpsOn: boolean; me: { lat: number; lon: number } | null };
}

interface AccountProps {
  user: User | null;
  token: string | null;
  onConsent: (on: boolean) => void;
  sync: SyncStatus;
  onLogin: () => void;
  onLogout: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onDelete: (password: string) => Promise<void>;
  /** Dane konta po zmianie na serwerze (np. Premium z klucza). */
  onUser: (u: User) => void;
}

export type SettingsCategory = "account" | "friends" | "planning" | "work" | "service" | "vehicle" | "gps" | "hud" | "apps" | "data" | "admin";
type Category = SettingsCategory;

/** Zasięg listy „Po drodze” do wyboru (km). */
const AHEAD_KM_OPTIONS = [20, 30, 50, 80];

export function SettingsView({ initialCategory, navAccess, state, now, onSettings, onPlanTime, onReset, account, friends }: Props) {
  const { settings, driver } = state;
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  const [confirmReset, setConfirmReset] = useState(false);
  // Na szerokim ekranie lista jest obok treści, więc od razu otwieramy pierwszą kategorię zamiast pustej prawej strony.
  const [cat, setCat] = useState<Category | null>(initialCategory ?? (window.matchMedia("(min-width: 760px)").matches ? "account" : null));
  const open = (c: Category | null) => {
    setCat(c);
    window.scrollTo({ top: 0 });
  };

  const categories: { id: Category; label: string; sub: string; icon: string }[] = [
    { id: "account", label: "Konto", sub: account.user ? `${account.user.email}${account.user.premium ? " · Premium" : ""}` : "Bez konta — dane tylko w tym telefonie", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" },
    { id: "friends", label: "Znajomi", sub: friends.api ? (() => { const n = friends.api.friends.filter((f) => f.relation === "accepted").length; const p = friends.api.friends.filter((f) => f.relation === "pending").length; return `${n ? `${n} ${n === 1 ? "znajomy" : n < 5 ? "znajomych" : "znajomych"}` : "Nikogo jeszcze nie ma"}${p ? ` · ${p} do akceptacji` : ""}${settings.friendsShare ? "" : " · pozycja ukryta"}`; })() : "Kto gdzie jedzie — wymaga konta", icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-5-6.7" },
    { id: "planning", label: "Planowanie", sub: "Wydłużenia, godzina planowania, prędkości", icon: "M4 12h4l3-8 4 16 3-8h2" },
    { id: "work", label: "Czas pracy", sub: `Limit ${fmtHm(settings.work.limitMin)} · przypomnienia ${settings.work.remind ? "włączone" : "wyłączone"}`, icon: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
    { id: "service", label: "Serwis pojazdu", sub: "Termin i kilometry do przeglądu", icon: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z" },
    { id: "vehicle", label: "Pojazd i nawigacja", sub: navAccess === "premium" ? `Nawigacja włączona · ${fmtT(settings.vehicle.weightKg)} t · ${String(settings.vehicle.heightM).replace(".", ",")} m` : "Dane pojazdu · nawigacja dla ciężarówek (beta)", icon: "M2 6h12v10H2zM14 9h4l3 3.5V16h-7M6.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM17.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" },
    { id: "gps", label: "GPS", sub: settings.autoStop ? "Postój włącza się sam" : "Postój ręcznie", icon: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" },
    { id: "hud", label: "HUD", sub: `Styl: ${HUD_STYLES.find((h) => h.id === settings.hudStyle)!.label.toLowerCase()} · elementy, okienko`, icon: "M3 5h18v14H3zM7 15h4M7 11h10" },
    { id: "apps", label: "Muzyka", sub: MUSIC_APPS.find((a) => a.id === settings.musicApp)!.label, icon: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" },
    { id: "data", label: "Dane i prywatność", sub: "Co wysyłamy, czyszczenie danych", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" },
    ...(account.user?.admin ? [{ id: "admin" as const, label: "Administracja", sub: "Premium, limity TomTom, dane do mapy", icon: "M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.5 6.5 19.5l1-6.3L3 8.9 9 8l3-6Z" }] : []),
  ];

  // Na telefonie: lista kategorii albo jedna kategoria (z „‹ Ustawienia”). Na szerokim ekranie (CSS, od 760 px)
  // lista zostaje po lewej, a treść wybranej kategorii jest obok — bez wchodzenia i cofania.
  return (
    <div className={`settings-layout ${cat ? "open" : ""}`}>
      <nav className="settings-cats" aria-label="Kategorie ustawień">
        {categories.map((c) => (
          <button key={c.id} className={`settings-cat ${c.id === cat ? "active" : ""}`} onClick={() => open(c.id)} aria-current={c.id === cat ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden><path d={c.icon} /></svg>
            <span>
              <b>{c.label}</b>
              <small>{c.sub}</small>
            </span>
            <i aria-hidden>›</i>
          </button>
        ))}
      </nav>
      {cat && (
      <div className="settings-body">
      <button className="settings-back" onClick={() => open(null)}>‹ Ustawienia</button>
      <h1 className="settings-title">{categories.find((c) => c.id === cat)!.label}</h1>

      {cat === "account" && <AccountSection {...account} />}

      {cat === "friends" && <FriendsSettings api={friends.api} share={settings.friendsShare} onShare={(friendsShare) => set({ friendsShare })} gpsOn={friends.gpsOn} onLogin={account.onLogin} me={friends.me} now={now} mapToken={navAccess === "premium" ? account.token : null} mapStyle={{ theme: settings.mapTheme === "auto" ? autoTheme(undefined, now) : settings.mapTheme, vehicle: settings.vehicle }} />}

      {cat === "planning" && (
        <>
      <section className="card">
            <div className="eyebrow">Planowanie</div>
            <h2>Co może użyć silnik</h2>
            <Toggle
              checked={settings.allowExtension}
              disabled={driver.extensionsLeft <= 0}
              onChange={(allowExtension) => set({ allowExtension })}
              label="Wydłużenie jazdy do 10 h"
              hint={driver.extensionsLeft > 0 ? `Zostało w tym tygodniu: ${driver.extensionsLeft}` : "Wykorzystane w tym tygodniu"}
            />
            <Toggle
              checked={settings.allowReducedRest}
              disabled={driver.reducedRestsLeft <= 0}
              onChange={(allowReducedRest) => set({ allowReducedRest })}
              label="Skrócony odpoczynek 9 h po drodze"
              hint={driver.reducedRestsLeft > 0 ? `Zostało: ${driver.reducedRestsLeft}` : "Wykorzystane do odpoczynku tygodniowego"}
            />
            <div className="form">
              <NumberField label="Szukaj parkingu z wyprzedzeniem" value={settings.parkingBufferMin} unit="min" min={0} max={240} onChange={(parkingBufferMin) => set({ parkingBufferMin })} wide />
            </div>
          </section>

          <section className="card">
            <div className="eyebrow">Godzina planowania</div>
            <h2>{state.planTime === null ? "Liczę od teraz" : "Planuję na inną godzinę"}</h2>
            <Toggle
              checked={state.planTime !== null}
              onChange={(v) => onPlanTime(v ? floorMinute(now) : null)}
              label="Ustaw inną godzinę"
              hint="Np. żeby sprawdzić plan na jutrzejszy wyjazd."
            />
            {state.planTime !== null && (
              <label className="field">
                <span className="field-label">Planuj od</span>
                <input type="datetime-local" value={toLocalInput(state.planTime)} onChange={(e) => { const t = fromLocalInput(e.target.value); if (t) onPlanTime(t); }} />
              </label>
            )}
          </section>

          <section className="card">
            <div className="section-head static">
              <span>
                <div className="eyebrow">Prędkości</div>
                <h2>Średnie na typ drogi</h2>
              </span>
              <button className="ghost" onClick={() => set({ speeds: { ...DEFAULT_SPEEDS } })}>Domyślne</button>
            </div>
            <p className="muted">Realna średnia Twojego zestawu z uwzględnieniem ruchu — nie limit prędkości.</p>
            <div className="form">
              {ROAD_TYPES.map((t) => (
                <NumberField key={t} label={ROAD_LABELS[t]} value={settings.speeds[t]} unit="km/h" min={5} max={90} onChange={(v) => set({ speeds: { ...settings.speeds, [t]: v } })} />
              ))}
            </div>
          </section>
        </>
      )}

      {cat === "service" && <ServiceSection state={state} now={now} onChange={(service) => set({ service })} />}

      {cat === "work" && <WorkSection w={settings.work} reducedRestsLeft={driver.reducedRestsLeft} onChange={(work) => set({ work })} />}

      {cat === "gps" && (
      <section className="card">
        <div className="eyebrow">GPS</div>
        <Toggle
          checked={settings.autoStop}
          onChange={(autoStop) => set({ autoStop })}
          label="Postój włącza się sam"
          hint="Po 5 s jazdy 0–5 km/h RoadPilot zaczyna odliczać przerwę od chwili zatrzymania, a po ruszeniu ją kończy. Działa przy włączonym GPS."
        />
      </section>
      )}

      {cat === "hud" && <HudSection settings={settings} onChange={set} />}

      {cat === "vehicle" && <VehicleSection settings={settings} navAccess={navAccess} onChange={set} />}

      {cat === "admin" && account.user?.admin && account.token && (
        <>
          <AdminStatsCard token={account.token} />
          <AdminMap token={account.token} />
          <PremiumKeysCard token={account.token} />
          <AdminSection token={account.token} me={account.user.id} />
        </>
      )}

      {cat === "apps" && (
        <section className="card">
          <div className="eyebrow">Skróty w HUD</div>
        <div className="form">
          <label className="field">
            <span className="field-label">Muzyka</span>
            <select value={settings.musicApp} onChange={(e) => set({ musicApp: e.target.value as MusicApp })}>
              {MUSIC_APPS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
        </div>
        <p className="muted small">
          Przycisk w HUD otwiera wybraną aplikację muzyki. RoadPilot nie steruje muzyką; aplikacja musi być zainstalowana
          (inaczej otworzy się jej strona). Nawigacja jest wbudowana w RoadPilot (Premium).
        </p>
        </section>
      )}

      {cat === "data" && <MapDataSection token={account.token} consent={!!account.user?.dataConsent} onChange={account.onConsent} />}

      {cat === "data" && (
      <section className="card">
        <div className="eyebrow">Dane</div>
        <p className="muted">
          {account.user
            ? "Dane są w tym urządzeniu i na Twoim koncie RoadPilot (serwer RoadPilot, baza MariaDB) — trasa, stan tachografu, ustawienia i historia z GPS. Bieżąca pozycja GPS nie jest wysyłana."
            : "Bez konta wszystko jest zapisane tylko w tym urządzeniu."}{" "}
          W trybie HUD przybliżona pozycja (z dokładnością ~1 km) trafia do OpenStreetMap (Overpass) i Open-Meteo — po
          najbliższe MOP-y i parkingi, nazwy dróg i miejscowości oraz pogodę. Przy włączonej nawigacji wpisywany cel,
          punkt startu (pozycja GPS) i dane pojazdu idą przez serwer RoadPilot do TomTom; trasa zostaje tylko w telefonie. W czasie jazdy co 5 min serwer RoadPilot pyta TomTom o korki w obszarze ~150 km trasy przed Tobą (bez Twojej pozycji ani telefonu). Kafelki mapy w HUD pobiera serwer RoadPilot — TomTom nie widzi Twojego telefonu.
          {account.user ? " Znajomi (Ustawienia → Znajomi): przy włączonym GPS i udostępnianiu serwer RoadPilot trzyma Twoją ostatnią pozycję, prędkość, postój, cel i stan tachografu — widzą je tylko zaakceptowani znajomi; wyłączenie udostępniania kasuje te dane." : ""}
          {account.user ? " Po powrocie do aplikacji po przerwie w odczytach GPS ostatnia i obecna pozycja idą do serwera RoadPilot, który liczy drogę ciężarówki (do szacunku jazdy i postoju). Przy otwarciu przekroczenia w Historii serwer dostaje jego pozycję, żeby podać miejscowość, drogę i MOP. Serwer tych pozycji nie zapisuje." : ""}
          {account.user ? " Opinie o parkingu przy celu (Trasa → nawigacja): serwer zapisuje miejsce celu, ocenę i komentarz z Twoim kontem; inni kierowcy widzą je bez Twojego imienia i e-maila. Swoją opinię usuniesz w każdej chwili, a usunięcie konta kasuje wszystkie." : ""}
        </p>
        {confirmReset ? (
          <div className="row-buttons">
            <button className="danger" onClick={() => { onReset(); setConfirmReset(false); }}>Tak, wyczyść</button>
            <button className="ghost" onClick={() => setConfirmReset(false)}>Anuluj</button>
          </div>
        ) : (
          <button className="ghost" onClick={() => setConfirmReset(true)}>Wyczyść wszystkie dane</button>
        )}
      </section>
      )}
      </div>
      )}
    </div>
  );
}

const fmtT = (kg: number) => String(Math.round(kg / 100) / 10).replace(".", ",");

const ADR_OPTIONS: { id: Vehicle["adr"]; label: string }[] = [
  { id: "none", label: "Brak (bez ADR)" },
  { id: "B", label: "B" },
  { id: "C", label: "C" },
  { id: "D", label: "D" },
  { id: "E", label: "E" },
];

/** Dane pojazdu do nawigacji dla ciężarówek — nawigacja jest zawsze włączona dla Premium. */
function VehicleSection({ settings, navAccess, onChange }: { settings: Settings; navAccess: NavAccess; onChange: (patch: Partial<Settings>) => void }) {
  const v = settings.vehicle;
  const setV = (patch: Partial<Vehicle>) => onChange({ vehicle: { ...v, ...patch } });
  return (
    <>
      <section className="card">
        <div className="eyebrow">Nawigacja · Premium · beta</div>
        <h3>Nawigacja RoadPilot dla ciężarówek{navAccess === "premium" ? " — włączona" : ""}</h3>
        <p className="muted small">
          {navAccess === "premium"
            ? "W zakładce Trasa wyszukasz cel, a trasa uwzględni wymiary, masę i ADR; w HUD zobaczysz manewry i pasy. Cel, punkt startu i dane pojazdu idą przez serwer RoadPilot do TomTom."
            : navAccess === "guest"
              ? "Dostępne w RoadPilot Premium — zaloguj się na konto."
              : "Dostępne w RoadPilot Premium — wkrótce do kupienia."}
        </p>
      </section>
      {navAccess === "premium" && (
        <section className="card">
          <div className="eyebrow">Silnik tras</div>
          <div className="hud-style-pick engines">
            {([
              ["tomtom", "TomTom", "Pełne dane w Europie, korki na żywo, pasy ruchu i ograniczenia prędkości."],
              ["roadpilot", "RoadPilot (beta)", "Własny silnik na OpenStreetMap — tylko Polska, bez pasów; korki na trasie dociągane z TomTom co 5 min."],
            ] as const).map(([id, label, hint]) => (
              <button key={id} className={`hud-style-opt ${settings.navEngine === id ? "active" : ""}`} aria-pressed={settings.navEngine === id} onClick={() => onChange({ navEngine: id })}>
                <strong>{label}</strong>
                <small>{hint}</small>
              </button>
            ))}
          </div>
          <p className="muted small">Gdy limit TomTom się wyczerpie, trasy w Polsce liczy automatycznie silnik RoadPilot.</p>
        </section>
      )}
      {navAccess === "premium" && (
        <section className="card">
          <div className="eyebrow">Rodzaj trasy</div>
          <div className="hud-style-pick">
            {ROUTE_TYPES.map((t) => (
              <button key={t.id} className={`hud-style-opt ${settings.routeType === t.id ? "active" : ""}`} aria-pressed={settings.routeType === t.id} onClick={() => onChange({ routeType: t.id })}>
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </button>
            ))}
          </div>
          <p className="muted small">Działa od następnej wyznaczonej trasy. Alternatywy w porównaniu tras są zawsze liczone dla wybranego rodzaju.</p>
        </section>
      )}
      {navAccess === "premium" && (
        <section className="card">
          <div className="eyebrow">Po drodze</div>
          <p className="muted small">MOP-y, parkingi TIR i stacje przed Tobą — lista pod przyciskiem P w Nawigacji i najbliższe pod prędkością.</p>
          <label className="field">
            <span className="field-label">Zasięg listy</span>
            <select value={settings.aheadKm} onChange={(e) => onChange({ aheadKm: Number(e.target.value) })}>
              {AHEAD_KM_OPTIONS.map((km) => <option key={km} value={km}>{km} km</option>)}
            </select>
          </label>
          <Toggle checked={settings.aheadStrip.mop} onChange={(mop) => onChange({ aheadStrip: { ...settings.aheadStrip, mop } })} label="Najbliższy MOP pod prędkością" />
          <Toggle checked={settings.aheadStrip.parking} onChange={(parking) => onChange({ aheadStrip: { ...settings.aheadStrip, parking } })} label="Najbliższy parking TIR pod prędkością" />
          <Toggle checked={settings.aheadStrip.fuel} onChange={(fuel) => onChange({ aheadStrip: { ...settings.aheadStrip, fuel } })} label="Najbliższa stacja pod prędkością" />
        </section>
      )}
      <section className="card">
        <div className="section-head static">
          <span>
            <div className="eyebrow">Pojazd</div>
            <h2>Wymiary i masa zestawu</h2>
          </span>
          <button className="ghost" onClick={() => onChange({ vehicle: { ...DEFAULT_VEHICLE } })}>Domyślne</button>
        </div>
        <p className="muted small">Cały zestaw (ciągnik z naczepą). Domyślnie typowy zestaw 40 t w UE.</p>
        <div className="form">
          <NumberField label="Wysokość" value={v.heightM} unit="m" min={1} max={5} step={0.05} onChange={(heightM) => setV({ heightM })} />
          <NumberField label="Szerokość" value={v.widthM} unit="m" min={1} max={3.5} step={0.05} onChange={(widthM) => setV({ widthM })} />
          <NumberField label="Długość" value={v.lengthM} unit="m" min={2} max={30} step={0.1} onChange={(lengthM) => setV({ lengthM })} />
          <NumberField label="Masa całkowita" value={v.weightKg / 1000} unit="t" min={1} max={80} step={0.5} onChange={(t) => setV({ weightKg: Math.round(t * 1000) })} />
          <NumberField label="Nacisk na oś" value={v.axleWeightKg / 1000} unit="t" min={1} max={20} step={0.5} onChange={(t) => setV({ axleWeightKg: Math.round(t * 1000) })} />
          <NumberField label="Liczba osi" value={v.axles} min={2} max={12} onChange={(axles) => setV({ axles: Math.round(axles) })} />
          <NumberField label="Prędkość maks." value={v.maxKmh} unit="km/h" min={30} max={130} onChange={(maxKmh) => setV({ maxKmh: Math.round(maxKmh) })} />
          <label className="field">
            <span className="field-label">ADR — kategoria tunelowa</span>
            <select value={v.adr} onChange={(e) => setV({ adr: e.target.value as Vehicle["adr"] })}>
              {ADR_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        </div>
      </section>
    </>
  );
}

/** Styl HUD i widoczne elementy — osobno dla stylu zwykłego i minimalistycznego. */
function HudSection({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const style = settings.hudStyle;
  const items = settings.hudItems[style];
  const setItems = (next: HudItems) => onChange({ hudItems: { ...settings.hudItems, [style]: next } });
  const pip = floatingSupported();
  return (
    <>
      <section className="card">
        <div className="eyebrow">Mapa w nawigacji</div>
        <div className="hud-style-pick engines">
          {([["auto", "Automatycznie", "Dzień / noc z pogody, a bez niej z zegara (7–19)."], ["day", "Dzień", "Jasne tło, szare drogi."], ["night", "Noc", "Ciemne tło — jak dotąd."]] as const).map(([id, label, hint]) => (
            <button key={id} className={`hud-style-opt ${settings.mapTheme === id ? "active" : ""}`} aria-pressed={settings.mapTheme === id} onClick={() => onChange({ mapTheme: id })}>
              <strong>{label}</strong>
              <small>{hint}</small>
            </button>
          ))}
        </div>
        <p className="muted small">Własna mapa RoadPilot (OpenStreetMap) działa w Polsce; drogi z zakazem dla Twojego zestawu są czerwono-białe (zakaz wjazdu) albo czerwone z białymi kreskami (ograniczenie masy, wysokości itp.). Poza Polską mapa TomTom.</p>
      </section>
      <section className="card">
        <div className="eyebrow">Styl</div>
        <div className="hud-style-pick">
          {HUD_STYLES.map((h) => (
            <button key={h.id} className={`hud-style-opt ${style === h.id ? "active" : ""}`} aria-pressed={style === h.id} onClick={() => onChange({ hudStyle: h.id })}>
              <span className={`hud-style-preview ${h.id}`} aria-hidden>
                <b>78</b>
                {h.id === "full" ? <><i /><i /><i /></> : <em>213 km · 15:12 · 1 h 52</em>}
              </span>
              <strong>{h.label}</strong>
              <small>{h.hint}</small>
            </button>
          ))}
        </div>
        <p className="muted small">Styl zmienisz też w HUD: menu ⋮ → „Styl”.</p>
      </section>

      <section className="card">
        <div className="section-head static">
          <span>
            <div className="eyebrow">Co pokazywać</div>
            <h2>Styl {HUD_STYLES.find((h) => h.id === style)!.label.toLowerCase()}</h2>
          </span>
          <button className="ghost" onClick={() => setItems({ ...DEFAULT_HUD_ITEMS[style] })}>Domyślne</button>
        </div>
        <p className="muted small">Prędkość jest zawsze widoczna. Każdy styl ma własny zestaw.</p>
        <div className="hud-items">
          {HUD_ITEMS.map((i) => (
            <label key={i.id} className={`hud-item ${items[i.id] ? "on" : ""}`}>
              <input type="checkbox" checked={items[i.id]} onChange={(e) => setItems({ ...items, [i.id]: e.target.checked })} />
              <span>
                {i.label}
                {i.hint && <small>{i.hint}</small>}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">Wygląd</div>
        <Toggle
          checked={settings.hudMirror}
          onChange={(hudMirror) => onChange({ hudMirror })}
          label="Odbicie na szybę"
          hint="Lustrzany obraz — połóż telefon na desce, żeby odbijał się w przedniej szybie."
        />
        <Toggle
          checked={settings.hudAnimation}
          onChange={(hudAnimation) => onChange({ hudAnimation })}
          label="Animacja drogi"
          hint="Przerywane pasy ruchu po bokach prędkości — przesuwają się tym szybciej, im szybciej jedziesz."
        />
      </section>

      <section className="card">
        <div className="eyebrow">Pływające okienko</div>
        <h2>Prędkość i przyjazd nad innymi aplikacjami</h2>
        <p className="muted">
          W HUD stuknij „Okienko” (albo menu ⋮ → „Pływające okienko”), potem przejdź do nawigacji. Okienko pokazuje prędkość,
          godzinę przyjazdu i na zmianę: czas do przerwy, do odpoczynku i koniec pracy. Stuknięcie okienka wraca do RoadPilot.
        </p>
        <p className={`small ${pip ? "muted" : "warn-text"}`}>
          {pip
            ? "Eksperymentalne: gdy RoadPilot jest w tle, telefon może spowolnić lub zatrzymać odświeżanie — wtedy prędkość pokazuje „—”. Na iPhonie liczby najczęściej stają."
            : "Ta przeglądarka nie obsługuje pływającego okienka."}
        </p>
      </section>
    </>
  );
}

function WorkSection({ w, reducedRestsLeft, onChange }: { w: WorkSettings; reducedRestsLeft: number; onChange: (w: WorkSettings) => void }) {
  const [perm, setPerm] = useState(notificationsState);
  const set = (patch: Partial<WorkSettings>) => onChange({ ...w, ...patch });
  return (
    <section className="card">
      <div className="eyebrow">Czas pracy</div>
      <h2>Przypomnienia o końcu dnia pracy</h2>
      <p className="muted">Liczony od początku dnia pracy (koniec ostatniego odpoczynku). Nie zatrzymuje się w przerwach — osobno od czasu jazdy.</p>
      <div className="form">
        <DurationField label="Czas pracy" value={w.limitMin} maxHours={15} onChange={(limitMin) => set({ limitMin: Math.max(60, Math.min(limitMin, EXTENDED_WORK_MIN)) })} hint="domyślnie 13 h (24 h − 11 h odpoczynku)" />
        <NumberField label="Przypomnij przed końcem" value={w.leadMin} unit="min" min={5} max={180} onChange={(leadMin) => set({ leadMin })} />
      </div>
      <Toggle checked={w.remind} onChange={(remind) => set({ remind })} label="Przypominaj przed końcem czasu pracy" hint={`Powiadomienie ${w.leadMin} min przed końcem i na koniec.`} />
      <Toggle
        checked={w.extension}
        onChange={(extension) => set({ extension })}
        label="Wydłużenie czasu pracy do 15 h"
        hint={reducedRestsLeft > 0 ? `Wymaga skróconego odpoczynku 9 h (zostało: ${reducedRestsLeft}). Przypomnę też przed końcem 15 h.` : "Skrócone odpoczynki wykorzystane — wydłużenie niedostępne do odpoczynku tygodniowego."}
      />
      {w.remind && perm !== "granted" && (
        perm === "unsupported" ? (
          <p className="warn-text small">Powiadomienia wymagają HTTPS — na tym adresie są niedostępne.</p>
        ) : perm === "denied" ? (
          <p className="warn-text small">Powiadomienia są zablokowane — zezwól na nie w ustawieniach przeglądarki.</p>
        ) : (
          <button className="primary" onClick={async () => { await askNotifications(); setPerm(notificationsState()); }}>Zezwól na powiadomienia</button>
        )
      )}
    </section>
  );
}

function AccountSection({ user, token, sync, onLogin, onLogout, onSyncNow, onDelete, onUser }: AccountProps) {
  const [confirmOut, setConfirmOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <section className="card">
        <div className="eyebrow">Konto</div>
        <h2>Bez konta</h2>
        <p className="muted">Dane są tylko w tym telefonie. Z kontem zapiszesz je na serwerze i odtworzysz na innym urządzeniu.</p>
        <button className="primary" onClick={onLogin}>Zaloguj się lub załóż konto</button>
      </section>
    );
  }

  const del = async () => {
    setError(null);
    try {
      await onDelete(password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się usunąć konta.");
    }
  };

  return (
    <section className="card">
      <div className="eyebrow">Konto</div>
      <h2>{user.name || user.email}</h2>
      {user.name && <p className="muted">{user.email}</p>}
      <p className={`premium-line ${user.premium ? "on" : ""}`}>
        {user.admin ? "Administrator · Premium" : user.premium ? `Premium ${premiumText(user.premiumUntil ?? null)}` : "Bez Premium — wkrótce do kupienia"}
      </p>
      {!user.admin && token && <RedeemKey token={token} onUser={onUser} />}
      <p className={`sync-line ${sync.kind}`}>
        <span className="sync-dot" aria-hidden />
        {syncText(sync)}
        {(sync.kind === "offline" || sync.kind === "error" || sync.kind === "ok") && <button className="text-btn" onClick={() => onSyncNow()}>Synchronizuj teraz</button>}
      </p>
      {confirmOut ? (
        <div className="row-buttons">
          <button className="danger" onClick={() => { setConfirmOut(false); onLogout(); }}>Wyloguj i wyczyść telefon</button>
          <button className="ghost" onClick={() => setConfirmOut(false)}>Anuluj</button>
        </div>
      ) : (
        <button className="ghost" onClick={() => setConfirmOut(true)}>Wyloguj</button>
      )}
      {confirmOut && <p className="muted small">Dane zostaną na koncie, z tego telefonu znikną.</p>}
      {deleting ? (
        <div className="delete-account">
          <p className="muted small">Konto i wszystkie dane na serwerze zostaną trwale usunięte. Dane w tym telefonie zostają.</p>
          <label className="field">
            <span className="field-label">Hasło</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <div className="row-buttons">
            <button className="danger" disabled={!password} onClick={del}>Usuń konto</button>
            <button className="ghost" onClick={() => { setDeleting(false); setPassword(""); setError(null); }}>Anuluj</button>
          </div>
        </div>
      ) : (
        <button className="text-btn danger-text" onClick={() => setDeleting(true)}>Usuń konto</button>
      )}
    </section>
  );
}

/** Klucz Premium od administratora: wpisanie (wielkość liter, spacje i myślniki bez znaczenia) → Premium od razu. */
function RedeemKey({ token, onUser }: { token: string; onUser: (u: User) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const redeem = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ user: User; days: number | null }>("POST", "/premium/redeem", { key }, token);
      onUser(r.user);
      setKey("");
      setMsg({ ok: true, text: `Gotowe — Premium ${premiumText(r.user.premiumUntil ?? null)}${r.days !== null ? ` (+${r.days} dni)` : ""}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Nie udało się — sprawdź połączenie." });
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <button className="text-btn" onClick={() => setOpen(true)}>Mam klucz Premium</button>;
  return (
    <div className="redeem">
      <label className="field">
        <span className="field-label">Klucz Premium</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="RP-XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && key.trim() && !busy && redeem()} />
      </label>
      <div className="row-buttons">
        <button className="primary" disabled={!key.trim() || busy} onClick={redeem}>{busy ? "Sprawdzam…" : "Aktywuj"}</button>
        <button className="ghost" onClick={() => { setOpen(false); setMsg(null); }}>Zamknij</button>
      </div>
      {msg && <p className={msg.ok ? "redeem-ok" : "auth-error"}>{msg.text}</p>}
    </div>
  );
}

interface PremiumKey {
  key: string;
  days: number | null;
  note: string;
  createdAt: number;
  usedAt: number | null;
  usedBy: string | null;
}

const KEY_DAYS: { days: number | null; label: string }[] = [
  { days: 7, label: "7 dni" },
  { days: 30, label: "30 dni" },
  { days: 90, label: "3 mies." },
  { days: 365, label: "Rok" },
  { days: null, label: "Bez terminu" },
];

const keyDaysText = (days: number | null) => (days === null ? "bez terminu" : days === 1 ? "1 dzień" : `${days} dni`);

/** Administracja: klucze Premium do przekazania (SMS, komunikator) — jednorazowe, na wybraną liczbę dni. */
function PremiumKeysCard({ token }: { token: string }) {
  const [keys, setKeys] = useState<PremiumKey[] | null>(null);
  const [days, setDays] = useState<number | null>(30);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<PremiumKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ keys: PremiumKey[] }>("GET", "/admin/keys", undefined, token).then((r) => setKeys(r.keys)).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const chosen = custom.trim() ? Number(custom) : days;
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: PremiumKey }>("POST", "/admin/keys", { days: chosen, note }, token);
      setFresh(r.key);
      setCopied(false);
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się wygenerować klucza.");
    } finally {
      setBusy(false);
    }
  };
  const message = (k: PremiumKey) => `Klucz RoadPilot Premium (${keyDaysText(k.days)}): ${k.key}\nWpisz go w aplikacji: Ustawienia → Konto → „Mam klucz Premium”.`;
  const share = async (k: PremiumKey) => {
    const text = message(k);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      /* anulowane udostępnianie / brak schowka — klucz jest widoczny */
    }
  };
  const remove = async (k: PremiumKey) => {
    if (!confirm(`Usunąć klucz ${k.key}? Nie będzie można go użyć.`)) return;
    try {
      await api("DELETE", "/admin/keys", { key: k.key }, token);
      if (fresh?.key === k.key) setFresh(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się usunąć klucza.");
    }
  };
  const valid = chosen === null || (Number.isInteger(chosen) && chosen >= 1 && chosen <= 3650);
  return (
    <section className="card">
      <div className="eyebrow">Klucze Premium</div>
      <h2>Wygeneruj klucz</h2>
      <p className="muted small">Jednorazowy klucz do przekazania kierowcy — wpisuje go w Ustawienia → Konto. Dni dokładają się do trwającego Premium.</p>
      <div className="key-days" role="radiogroup" aria-label="Na ile">
        {KEY_DAYS.map((d) => (
          <button key={d.label} role="radio" aria-checked={!custom.trim() && days === d.days} className={!custom.trim() && days === d.days ? "active" : ""} onClick={() => { setDays(d.days); setCustom(""); }}>{d.label}</button>
        ))}
      </div>
      <div className="form">
        <label className="field">
          <span className="field-label">Albo liczba dni</span>
          <input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="np. 14" />
        </label>
        <label className="field">
          <span className="field-label">Dla kogo (notatka)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="np. Marek, firma X" />
        </label>
      </div>
      {error && <p className="auth-error">{error}</p>}
      <button className="primary key-generate" disabled={busy || !valid} onClick={generate}>{busy ? "Generuję…" : `Wygeneruj klucz — ${keyDaysText(chosen)}`}</button>
      {fresh && (
        <div className="key-fresh">
          <strong>{fresh.key}</strong>
          <span>{keyDaysText(fresh.days)}{fresh.note ? ` · ${fresh.note}` : ""}</span>
          <button className="ghost" onClick={() => share(fresh)}>{copied ? "Skopiowano ✓" : "Wyślij / kopiuj"}</button>
        </div>
      )}
      {keys && keys.length > 0 && (
        <ul className="key-list">
          {keys.map((k) => (
            <li key={k.key} className={k.usedAt ? "used" : ""}>
              <span>
                <b>{k.key}</b>
                <small>{keyDaysText(k.days)}{k.note ? ` · ${k.note}` : ""} · {k.usedAt ? `użyty ${new Date(k.usedAt).toLocaleDateString("pl-PL")} przez ${k.usedBy ?? "usunięte konto"}` : `wolny, od ${new Date(k.createdAt).toLocaleDateString("pl-PL")}`}</small>
              </span>
              {!k.usedAt && (
                <span className="key-actions">
                  <button className="ghost" onClick={() => share(k)}>Wyślij</button>
                  <button className="ghost danger-text" onClick={() => remove(k)}>Usuń</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** „bez terminu” (rok 9999) albo „do 30.10.2026”. */
function premiumText(until: number | null) {
  if (until === null || new Date(until).getFullYear() >= 9999) return "bez terminu";
  return `do ${new Date(until).toLocaleDateString("pl-PL")}`;
}

/** Administracja: wyszukanie konta i nadanie / odebranie Premium. Zakup Premium jeszcze nie działa. */
interface AdminStats {
  period: string;
  periodKind: "month" | "day";
  share: number;
  apis: { api: string; used: number; limit: number; cap: number }[];
  points: number;
  pointUsers: number;
  consents: number;
  reports: Record<string, number>;
  osm?: Record<string, number>;
  recent: { kind: string; lat: number; lon: number; value: number | null; note: string; at: number; email: string }[];
}

const API_LABELS: Record<string, string> = { search: "TomTom — wyszukiwanie", route: "TomTom — trasy", tiles: "TomTom — mapa (kafelki)", traffic: "TomTom — korki" };

/** Zużycie limitów TomTom (próg 80%) i dane zebrane do mapy. */
function AdminStatsCard({ token }: { token: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  useEffect(() => {
    api<AdminStats>("GET", "/admin/stats", undefined, token).then(setStats).catch(() => {});
  }, [token]);
  if (!stats) return null;
  const kindLabel = (k: string) => REPORT_KINDS.find((x) => x.id === k)?.label ?? k;
  return (
    <>
      <section className="card">
        <div className="eyebrow">Limity TomTom · {stats.periodKind === "day" ? `dzień ${stats.period}` : `miesiąc ${stats.period}`}</div>
        <p className="muted small">Serwer przestaje pytać TomTom przy {Math.round(stats.share * 100)}% limitu — nawigacja pokaże wtedy komunikat do końca okresu.</p>
        <div className="admin-usage">
          {stats.apis.map((a) => (
            <div key={a.api}>
              <span>{API_LABELS[a.api] ?? a.api}: <b>{a.used}</b> / {a.cap} (limit {a.limit})</span>
              <div className={`hud-bar ${a.used >= a.cap ? "bad" : a.used >= a.cap * 0.8 ? "warn" : ""}`}><span style={{ width: `${Math.min(100, (a.used / a.cap) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="eyebrow">Mapa RoadPilot</div>
        <p className="muted small">
          Zgody: <b>{stats.consents}</b> · punkty śladu: <b>{stats.points.toLocaleString("pl-PL")}</b> (od {stats.pointUsers} kierowców) · zgłoszenia:{" "}
          <b>{Object.values(stats.reports).reduce((a, b) => a + b, 0)}</b>
        </p>
        {stats.osm && (
          <p className="muted small">
            Ograniczenia z OpenStreetMap (Polska): <b>{Object.values(stats.osm).reduce((a, b) => a + b, 0).toLocaleString("pl-PL")}</b> — wysokość {stats.osm.height ?? 0}, masa {stats.osm.weight ?? 0},
            nacisk osi {stats.osm.axle ?? 0}, zakazy TIR {stats.osm.hgv ?? 0}, prędkość TIR {stats.osm.speed_hgv ?? 0}.
          </p>
        )}
        {stats.recent.length > 0 && (
          <ul className="admin-reports">
            {stats.recent.map((r, i) => (
              <li key={i}>
                <b>{kindLabel(r.kind)}</b>{r.value !== null ? ` ${String(r.value).replace(".", ",")}` : ""} · {r.lat.toFixed(4)}, {r.lon.toFixed(4)} · {new Date(r.at).toLocaleString("pl-PL")} · {r.email}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AdminSection({ token, me }: { token: string; me: number }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      api<{ users: AdminUser[] }>("GET", `/admin/users?q=${encodeURIComponent(q.trim())}`, undefined, token)
        .then((r) => alive && (setUsers(r.users), setError(null)))
        .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Nie udało się pobrać kont."));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, token]);

  const grant = async (u: AdminUser, days: number | null) => {
    setBusy(u.id);
    try {
      const r = await api<{ user: AdminUser }>("POST", "/admin/premium", { userId: u.id, days }, token);
      setUsers((list) => list?.map((x) => (x.id === u.id ? r.user : x)) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zmienić Premium.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <div className="eyebrow">Premium</div>
      <h2>Nadaj dostęp</h2>
      <p className="muted small">Premium odblokowuje nawigację dla ciężarówek. Zmiana działa od razu — kierowca zobaczy ją po powrocie do aplikacji.</p>
      <label className="field wide">
        <span className="field-label">Szukaj konta (e-mail lub imię)</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="np. jan@firma.pl" autoCapitalize="off" />
      </label>
      {error && <p className="auth-error">{error}</p>}
      {users === null ? (
        <p className="muted small">Wczytuję…</p>
      ) : users.length === 0 ? (
        <p className="muted small">Brak kont.</p>
      ) : (
        <ul className="admin-users">
          {users.map((u) => (
            <li key={u.id}>
              <div>
                <strong>{u.name || u.email}</strong>
                <small>{u.name ? u.email : ""} · od {new Date(u.createdAt).toLocaleDateString("pl-PL")}</small>
                <span className={`premium-line ${u.premium ? "on" : ""}`}>
                  {u.admin ? "Administrator · Premium" : u.premium ? `Premium ${premiumText(u.premiumUntil ?? null)}` : "Bez Premium"}
                </span>
              </div>
              {!u.admin && u.id !== me && (
                <div className="admin-actions">
                  <button className="ghost" disabled={busy === u.id} onClick={() => grant(u, 30)}>30 dni</button>
                  <button className="ghost" disabled={busy === u.id} onClick={() => grant(u, 365)}>Rok</button>
                  <button className="ghost" disabled={busy === u.id} onClick={() => grant(u, null)}>Bez terminu</button>
                  {u.premium && <button className="ghost danger-text" disabled={busy === u.id} onClick={() => confirm(`Odebrać Premium kontu ${u.email}?`) && grant(u, 0)}>Odbierz</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function syncText(s: SyncStatus) {
  switch (s.kind) {
    case "syncing":
      return "Synchronizuję…";
    case "ok":
      return `Zsynchronizowano ${new Date(s.at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`;
    case "offline":
      return "Brak sieci — zmiany wyślę, gdy wróci zasięg";
    case "error":
      return s.message;
    default:
      return "Synchronizacja wyłączona";
  }
}

function ServiceSection({ state, now, onChange }: { state: AppState; now: number; onChange: (s: ServiceInfo) => void }) {
  const service = state.settings.service;
  const st = serviceStatus(service, state.odoKm, now);
  const kmLeft = st.kmLeft === undefined ? null : Math.max(0, Math.round(st.kmLeft));
  const set = (patch: Partial<ServiceInfo>) => onChange({ ...service, ...patch });
  return (
    <section className="card">
      <div className="eyebrow">Serwis</div>
      <h2>Przegląd pojazdu</h2>
      <p className="muted">Ostrzeżenie w Planie na {SERVICE.soonDays} dni lub {SERVICE.soonKm} km przed serwisem.</p>
      <div className="form">
        <label className="field">
          <span className="field-label">Data serwisu</span>
          <input type="date" value={service.date === null ? "" : toDateInput(service.date)} onChange={(e) => set({ date: fromDateInput(e.target.value) })} />
        </label>
        <OptionalNumberField
          label="Za ile km"
          value={kmLeft}
          unit="km"
          placeholder="np. 25000"
          max={1_000_000}
          // Wpisanie km zapamiętuje stan licznika GPS — od niego odliczamy przejechane kilometry.
          onChange={(km) => set({ km, odoAtSet: state.odoKm })}
        />
        <p className="field-hint wide">
          {st.level === "overdue"
            ? "Serwis po terminie."
            : "Kilometry odliczane z GPS, gdy RoadPilot śledzi trasę — co jakiś czas popraw je według licznika pojazdu."}
        </p>
      </div>
      {st.level !== "none" && (
        <button className="text-btn" onClick={() => onChange({ date: null, km: null, odoAtSet: state.odoKm })}>Usuń przypomnienie o serwisie</button>
      )}
    </section>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function toDateInput(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** „2026-11-15” → północ tego dnia w czasie lokalnym; puste → null. */
function fromDateInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}
