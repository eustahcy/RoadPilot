import { BREAK_STOP } from "../core/breakstop";
import { useState } from "react";
import { DEFAULT_VEHICLE, NO_AVOID, ROUTE_TYPES, RouteAvoid, Vehicle } from "../nav";
import { Settings } from "../state";
import { NumberField, Toggle } from "./fields";
import { ADR_OPTIONS, AHEAD_KM_OPTIONS } from "./SettingsView";

// Ustawienia prosto z Nawigacji (⋯ → Ustawienia): pojazd, jakimi drogami jechać, mapa i dźwięk, „po drodze”.
// Te same pola co w Ustawieniach aplikacji — zapis od razu (synchronizowane z kontem jak reszta ustawień).

export type SettingsSection = "look" | "voice" | "planning" | "vehicle" | "ahead";

const AVOID: { id: keyof RouteAvoid; label: string; hint: string }[] = [
  { id: "tolls", label: "Unikaj dróg płatnych", hint: "Bez bramek i odcinków płatnych (A1, A2, A4…), jeśli da się dojechać inaczej." },
  { id: "motorways", label: "Unikaj autostrad", hint: "Drogi krajowe i ekspresowe zamiast autostrad — zwykle dłużej." },
  { id: "ferries", label: "Unikaj promów", hint: "Bez przepraw promowych." },
  { id: "unpaved", label: "Unikaj dróg gruntowych", hint: "Bez dróg nieutwardzonych (szutr, grunt) — ważne zwłaszcza dojazdy do firm i parkingów." },
];

export interface NavSettingsProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  voice: { supported: boolean; on: boolean; toggle: () => void };
  /** Przelicz trasę z nowymi ustawieniami (gdy jest cel). */
  onReroute?: () => void;
}

/** Jedna strona ustawień (menu ⋯ → Ustawienia → …) — zapis od razu; przy zmianie trasy / pojazdu przycisk „Przelicz trasę”. */
export function NavSettingsPage({ section, settings, onChange, voice, onReroute }: NavSettingsProps & { section: SettingsSection }) {
  const [changed, setChanged] = useState(false);
  const v = settings.vehicle;
  const avoid = v.avoid ?? NO_AVOID;
  const setV = (patch: Partial<Vehicle>) => { onChange({ vehicle: { ...v, ...patch } }); setChanged(true); };
  return (
    <div className="nav-settings">
      {section === "look" && (
        <div className="nset-body">
          <span className="field-label">Motyw mapy</span>
          <div className="nset-seg">
            {([["auto", "Auto"], ["day", "Dzień"], ["night", "Noc"]] as const).map(([id, label]) => (
              <button key={id} className={settings.mapTheme === id ? "on" : ""} aria-pressed={settings.mapTheme === id} onClick={() => onChange({ mapTheme: id })}>{label}</button>
            ))}
          </div>
          <p className="muted small">Auto: dzień / noc z pogody, a bez niej z zegara (7–19).</p>
          <span className="field-label">Widok mapy</span>
          <div className="nset-seg">
            {([["3d", "3D — pochylona"], ["2d", "2D — z góry"]] as const).map(([id, label]) => (
              <button key={id} className={settings.navMap === id ? "on" : ""} aria-pressed={settings.navMap === id} onClick={() => onChange({ navMap: id })}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {section === "voice" && (
        <div className="nset-body">
          {voice.supported
            ? <Toggle checked={voice.on} onChange={() => voice.toggle()} label="Komunikaty głosowe" hint="Manewry, pasy ruchu, ostrzeżenia (fotoradary, odcinkowy, ograniczenia) i bramki — po polsku." />
            : <p className="muted">Ta przeglądarka nie obsługuje mowy.</p>}
        </div>
      )}

      {section === "planning" && (
        <div className="nset-body">
          <span className="field-label">Rodzaj trasy</span>
          <div className="nset-pick">
            {ROUTE_TYPES.map((t) => (
              <button key={t.id} className={settings.routeType === t.id ? "on" : ""} aria-pressed={settings.routeType === t.id} onClick={() => { onChange({ routeType: t.id }); setChanged(true); }}>
                <strong>{t.label}</strong><small>{t.hint}</small>
              </button>
            ))}
          </div>
          <span className="field-label">Jakimi drogami</span>
          {AVOID.map((a) => (
            <Toggle key={a.id} checked={!!avoid[a.id]} onChange={(on) => setV({ avoid: { ...avoid, [a.id]: on } })} label={a.label} hint={a.hint} />
          ))}
        </div>
      )}

      {section === "vehicle" && (
        <div className="nset-body">
          <p className="muted small">Cały zestaw — trasa omija za niskie wiadukty, za słabe mosty i zakazy dla takiego pojazdu.</p>
          <div className="form nset-form">
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
          <button className="text-btn" onClick={() => setV({ ...DEFAULT_VEHICLE, avoid })}>Przywróć typowy zestaw 40 t</button>
        </div>
      )}

      {section === "ahead" && (
        <div className="nset-body">
          <label className="field">
            <span className="field-label">Zasięg listy „Po drodze”</span>
            <select value={settings.aheadKm} onChange={(e) => onChange({ aheadKm: Number(e.target.value) })}>
              {AHEAD_KM_OPTIONS.map((km) => <option key={km} value={km}>{km} km</option>)}
            </select>
          </label>
          <Toggle checked={settings.aheadStrip.mop} onChange={(mop) => onChange({ aheadStrip: { ...settings.aheadStrip, mop } })} label="Najbliższy MOP pod prędkością" />
          <Toggle checked={settings.aheadStrip.parking} onChange={(parking) => onChange({ aheadStrip: { ...settings.aheadStrip, parking } })} label="Najbliższy parking TIR pod prędkością" />
          <Toggle checked={settings.aheadStrip.fuel} onChange={(fuel) => onChange({ aheadStrip: { ...settings.aheadStrip, fuel } })} label="Najbliższa stacja pod prędkością" />
          <Toggle checked={settings.aheadStrip.camera !== false} onChange={(camera) => onChange({ aheadStrip: { ...settings.aheadStrip, camera } })} label="Najbliższy fotoradar i odcinkowy pomiar pod prędkością" hint="W czerwonej ramce — tylko z trasą." />
          <Toggle checked={settings.aheadStrip.toll !== false} onChange={(toll) => onChange({ aheadStrip: { ...settings.aheadStrip, toll } })} label="Najbliższe bramki pod prędkością" hint="W fioletowej ramce — tylko z trasą." />
          <Toggle checked={settings.breakStop.on} onChange={(on) => onChange({ breakStop: { ...settings.breakStop, on } })} label="Proponuj MOP na przerwę" hint="Nawigacja zaproponuje dodanie do trasy MOP-u lub parkingu TIR, do którego dojedziesz przed końcem 4,5 h jazdy." />
          {settings.breakStop.on && (
            <label className="field">
              <span className="field-label">Zapas przed limitem jazdy</span>
              <select value={settings.breakStop.marginMin} onChange={(e) => onChange({ breakStop: { ...settings.breakStop, marginMin: Number(e.target.value) } })}>
                {BREAK_STOP.margins.map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {changed && onReroute && (
        <button className="primary full nset-apply" onClick={() => { onReroute(); setChanged(false); }}>Przelicz trasę z nowymi ustawieniami</button>
      )}
    </div>
  );
}
