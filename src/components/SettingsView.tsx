import { useState } from "react";
import { DEFAULT_SPEEDS, ROAD_LABELS, ROAD_TYPES } from "../core/route";
import { fromLocalInput, toLocalInput } from "../format";
import { AppState, floorMinute, Settings } from "../state";
import { NumberField, Toggle } from "./fields";

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

      <section className="card">
        <div className="eyebrow">Dane</div>
        <p className="muted">Wszystko jest zapisane tylko w tym urządzeniu. RoadPilot nie wysyła danych na serwer.</p>
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
