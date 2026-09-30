import { useState } from "react";
import { DEFAULT_SPEEDS, ROAD_LABELS, ROAD_TYPES } from "../core/route";
import { SERVICE, ServiceInfo, serviceStatus } from "../core/service";
import { fromLocalInput, toLocalInput } from "../format";
import { AppState, floorMinute, Settings } from "../state";
import { NumberField, OptionalNumberField, Toggle } from "./fields";

interface Props {
  state: AppState;
  now: number;
  onSettings: (s: Settings) => void;
  onPlanTime: (t: number | null) => void;
  onReset: () => void;
}

export function SettingsView({ state, now, onSettings, onPlanTime, onReset }: Props) {
  const { settings, driver } = state;
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  const [confirmReset, setConfirmReset] = useState(false);

  return (
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

      <ServiceSection state={state} now={now} onChange={(service) => set({ service })} />

      <section className="card">
        <div className="eyebrow">Tryb HUD</div>
        <Toggle
          checked={settings.hudMirror}
          onChange={(hudMirror) => set({ hudMirror })}
          label="Odbicie na szybę"
          hint="Lustrzany obraz — połóż telefon na desce, żeby odbijał się w przedniej szybie."
        />
      </section>

      <section className="card">
        <div className="eyebrow">Dane</div>
        <p className="muted">
          Wszystko jest zapisane tylko w tym urządzeniu, bez kont i własnego serwera. W trybie HUD przybliżona pozycja
          (z dokładnością ~1 km) trafia do OpenStreetMap (Overpass) i Open-Meteo — po najbliższe stacje i pogodę.
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
    </>
  );
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
      <p className="muted">Pokazywany w trybie HUD. Ostrzeżenie na {SERVICE.soonDays} dni lub {SERVICE.soonKm} km przed serwisem.</p>
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
