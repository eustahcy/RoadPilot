import { useState } from "react";
import { DriverState } from "../core/plan";
import { Activity, ActivityKind, reconstruct } from "../core/reconstruct";
import { RULES } from "../core/rules";
import { fmtClock, fmtDuration, fromLocalInput, toLocalInput } from "../format";
import { floorMinute } from "../state";
import { DurationField, Stepper, Toggle } from "./fields";

interface Props {
  driver: DriverState;
  planNow: number;
  onChange: (d: DriverState) => void;
}

export function DriverView({ driver, planNow, onChange }: Props) {
  const set = (patch: Partial<DriverState>) => onChange({ ...driver, ...patch });

  const newDay = () =>
    set({ shiftStart: floorMinute(planNow), drivenTodayMin: 0, sinceBreakMin: 0, splitBreakTaken: false });

  return (
    <>
      <section className="card">
        <div className="eyebrow">Dzień pracy</div>
        <h2>Stan z tachografu</h2>
        <p className="muted">Przepisz wartości z tachografu. RoadPilot ich nie odczytuje — liczy na podstawie tego, co wpiszesz.</p>
        <div className="form">
          <label className="field wide">
            <span className="field-label">Koniec ostatniego odpoczynku (początek dnia pracy)</span>
            <span className="inline">
              <input type="datetime-local" value={toLocalInput(driver.shiftStart)} max={toLocalInput(planNow)} onChange={(e) => { const t = fromLocalInput(e.target.value); if (t) set({ shiftStart: t }); }} />
              <button className="ghost" onClick={newDay} title="Zaczynam nowy dzień teraz">Teraz</button>
            </span>
            <span className="field-hint">
              {driver.shiftStart > planNow
                ? "Ta godzina jest w przyszłości."
                : `${fmtDuration((planNow - driver.shiftStart) / 60_000)} temu · odpoczynek dzienny najpóźniej od ${fmtClock(driver.shiftStart + (RULES.restCycle - RULES.regularDailyRest) * 60_000, planNow)}`}
            </span>
          </label>
          <DurationField label="Jazda od początku dnia" value={driver.drivenTodayMin} maxHours={10} onChange={(drivenTodayMin) => set({ drivenTodayMin })} />
          <DurationField label="Jazda od ostatniej przerwy" value={driver.sinceBreakMin} maxHours={4} onChange={(sinceBreakMin) => set({ sinceBreakMin: Math.min(sinceBreakMin, RULES.maxContinuousDrive) })} hint="przerwa ≥ 45 min lub 15 + 30 min zeruje" />
          <div className="wide">
            <Toggle checked={driver.splitBreakTaken} onChange={(splitBreakTaken) => set({ splitBreakTaken })} label="Mam już 15 min przerwy dzielonej" hint="Następna przerwa wystarczy 30 min." />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">Tydzień</div>
        <h2>Limity tygodniowe</h2>
        <div className="form">
          <DurationField label="Jazda w tym tygodniu" value={driver.weekDrivenMin} maxHours={56} onChange={(weekDrivenMin) => set({ weekDrivenMin })} hint="od poniedziałku 00:00" />
          <DurationField label="Jazda w poprzednim tygodniu" value={driver.prevWeekDrivenMin} maxHours={56} onChange={(prevWeekDrivenMin) => set({ prevWeekDrivenMin })} hint="do limitu 90 h / 2 tyg." />
          <Stepper label="Wydłużenia do 10 h — zostało" value={driver.extensionsLeft} min={0} max={RULES.maxExtensionsPerWeek} onChange={(extensionsLeft) => set({ extensionsLeft })} hint="maks. 2 w tygodniu" />
          <Stepper label="Skrócone odpoczynki 9 h — zostało" value={driver.reducedRestsLeft} min={0} max={RULES.maxReducedRestsBetweenWeeklyRests} onChange={(reducedRestsLeft) => set({ reducedRestsLeft })} hint="maks. 3 między odp. tygodniowymi" />
        </div>
      </section>

      <LateStart driver={driver} planNow={planNow} onApply={(patch) => set(patch)} />
    </>
  );
}

const KIND_LABEL: Record<ActivityKind, string> = { drive: "Jazda", break: "Przerwa", work: "Inna praca" };

function LateStart({ driver, planNow, onApply }: { driver: DriverState; planNow: number; onApply: (p: Partial<DriverState>) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(driver.shiftStart);
  const [items, setItems] = useState<Activity[]>([{ kind: "drive", minutes: 120 }]);
  const r = reconstruct(start, items);
  const gap = (planNow - r.end) / 60_000;

  if (!open) {
    return (
      <section className="card late">
        <div>
          <div className="eyebrow">Spóźniony start</div>
          <p className="muted">Zapomniałeś uruchomić aplikację? Odtwórz dzień z listy aktywności — RoadPilot policzy jazdę i przerwy.</p>
        </div>
        <button className="ghost" onClick={() => { setStart(driver.shiftStart); setOpen(true); }}>Odtwórz dzień</button>
      </section>
    );
  }

  const update = (i: number, patch: Partial<Activity>) => setItems(items.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <section className="card">
      <div className="eyebrow">Spóźniony start</div>
      <h2>Odtwórz dzień</h2>
      <p className="muted">Wpisz rzeczywistą godzinę rozpoczęcia i kolejne aktywności tak, jak widzisz je na tachografie.</p>
      <label className="field">
        <span className="field-label">Rzeczywisty początek dnia pracy</span>
        <input type="datetime-local" value={toLocalInput(start)} onChange={(e) => { const t = fromLocalInput(e.target.value); if (t) setStart(t); }} />
      </label>
      <ol className="activities">
        {items.map((a, i) => (
          <li key={i}>
            <select value={a.kind} onChange={(e) => update(i, { kind: e.target.value as ActivityKind })}>
              {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <span className="input-row">
              <input type="number" inputMode="numeric" min={0} value={a.minutes} onChange={(e) => update(i, { minutes: Math.max(0, Number(e.target.value) || 0) })} />
              <span className="unit">min</span>
            </span>
            <button className="icon-btn" aria-label="Usuń" onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ol>
      <div className="row-buttons">
        <button className="ghost" onClick={() => setItems([...items, { kind: "break", minutes: 45 }])}>+ Przerwa</button>
        <button className="ghost" onClick={() => setItems([...items, { kind: "drive", minutes: 60 }])}>+ Jazda</button>
        <button className="ghost" onClick={() => setItems([...items, { kind: "work", minutes: 30 }])}>+ Inna praca</button>
      </div>
      <div className="recon">
        <span>Jazda od początku dnia: <strong>{fmtDuration(r.drivenTodayMin)}</strong></span>
        <span>Od ostatniej przerwy: <strong>{fmtDuration(r.sinceBreakMin)}</strong>{r.splitBreakTaken ? " (odbyte 15 min przerwy)" : ""}</span>
        <span>Ostatnia aktywność kończy się: <strong>{fmtClock(r.end, planNow)}</strong></span>
        {Math.abs(gap) > 15 && (
          <span className="warn-text">
            {gap > 0
              ? `Brakuje ${fmtDuration(gap)} do teraz — dopisz, co się działo (np. przerwę lub pracę).`
              : `Aktywności wychodzą ${fmtDuration(-gap)} poza aktualną godzinę — sprawdź czasy.`}
          </span>
        )}
      </div>
      <div className="row-buttons">
        <button className="primary" onClick={() => { onApply({ shiftStart: start, drivenTodayMin: r.drivenTodayMin, sinceBreakMin: Math.min(r.sinceBreakMin, RULES.maxContinuousDrive), splitBreakTaken: r.splitBreakTaken }); setOpen(false); }}>
          Zastosuj
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>Anuluj</button>
      </div>
    </section>
  );
}
