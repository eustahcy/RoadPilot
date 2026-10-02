import { useState } from "react";
import { DriverState } from "../core/plan";
import { ActivityKind, reconstructTimed, TimedActivity } from "../core/reconstruct";
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

const KIND_LABEL: Record<ActivityKind, string> = { drive: "Jazda", break: "Przerwa", work: "Praca" };
const DEFAULT_MIN: Record<ActivityKind, number> = { drive: 60, break: 45, work: 30 };

/** Wiersz odtwarzanego dnia — godziny jak na wydruku z tachografu („06:15”). */
interface Row {
  kind: ActivityKind;
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Godzina „HH:MM” najbliższa po `ref` (z tolerancją 6 h wstecz na drobne nakładki) — obsługuje przejście przez północ. */
function timeAfter(ref: number, v: string): number {
  const [h, m] = v.split(":").map(Number);
  const d = new Date(ref);
  d.setHours(h || 0, m || 0, 0, 0);
  let t = d.getTime();
  while (t < ref - 6 * 3_600_000) t += 86_400_000;
  return t;
}

/** Wiersze → aktywności z pełnymi datami, po kolei od początku dnia. */
function toTimed(start: number, rows: Row[]): TimedActivity[] {
  let ref = start;
  return rows.map((r) => {
    const from = timeAfter(ref, r.from);
    const to = timeAfter(from, r.to);
    ref = to;
    return { kind: r.kind, from, to: to < from ? to + 86_400_000 : to };
  });
}

/** Pasek dnia jak wykres z tachografu: aktywności po kolei od początku dnia, luki (postój) na szaro. */
function DayStrip({ start, timed }: { start: number; timed: TimedActivity[] }) {
  if (!timed.length) return null;
  const end = Math.max(...timed.map((a) => a.to));
  const span = end - start;
  if (span <= 0) return null;
  const pct = (t: number) => `${((t - start) / span) * 100}%`;
  return (
    <div className="day-strip">
      <div className="day-strip-bar">
        {timed.map((a, i) => a.to > a.from && <span key={i} className={a.kind} style={{ left: pct(Math.max(start, a.from)), width: `${((a.to - Math.max(start, a.from)) / span) * 100}%` }} />)}
      </div>
      <div className="day-strip-axis"><span>{hhmm(start)}</span><span>{hhmm(end)}</span></div>
    </div>
  );
}

function LateStart({ driver, planNow, onApply }: { driver: DriverState; planNow: number; onApply: (p: Partial<DriverState>) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(driver.shiftStart);
  const [rows, setRows] = useState<Row[]>([]);
  const timed = toTimed(start, rows);
  const r = reconstructTimed(start, timed);
  const end = timed.length ? Math.max(...timed.map((a) => a.to)) : start;
  const gap = (planNow - end) / 60_000;

  const begin = () => {
    setStart(driver.shiftStart);
    setRows([{ kind: "drive", from: hhmm(driver.shiftStart), to: hhmm(driver.shiftStart + 120 * 60_000) }]);
    setOpen(true);
  };

  if (!open) {
    return (
      <section className="card late">
        <div>
          <div className="eyebrow">Spóźniony start</div>
          <p className="muted">Zapomniałeś uruchomić aplikację? Odtwórz dzień z godzin jazdy i przerw — RoadPilot policzy liczniki.</p>
        </div>
        <button className="ghost" onClick={begin}>Odtwórz dzień</button>
      </section>
    );
  }

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const add = (kind: ActivityKind) => {
    const from = timed.length ? timed[timed.length - 1].to : start;
    setRows([...rows, { kind, from: hhmm(from), to: hhmm(from + DEFAULT_MIN[kind] * 60_000) }]);
  };

  return (
    <section className="card">
      <div className="eyebrow">Spóźniony start</div>
      <h2>Odtwórz dzień</h2>
      <p className="muted">Wpisz początek dnia pracy i kolejne aktywności z godzinami od–do, tak jak na tachografie. Czas niewpisany między nimi liczy się jako postój.</p>
      <label className="field">
        <span className="field-label">Rzeczywisty początek dnia pracy</span>
        <input type="datetime-local" value={toLocalInput(start)} onChange={(e) => { const t = fromLocalInput(e.target.value); if (t) setStart(t); }} />
      </label>
      <DayStrip start={start} timed={timed} />
      <ol className="acts">
        {rows.map((a, i) => (
          <li key={i} className={`act ${a.kind}`}>
            <div className="act-kinds" role="radiogroup" aria-label="Aktywność">
              {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
                <button key={k} role="radio" aria-checked={a.kind === k} className={a.kind === k ? "active" : ""} onClick={() => update(i, { kind: k })}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            <button className="icon-btn act-del" aria-label="Usuń" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
            <label className="act-time"><span>od</span><input type="time" value={a.from} onChange={(e) => update(i, { from: e.target.value })} /></label>
            <label className="act-time"><span>do</span><input type="time" value={a.to} onChange={(e) => update(i, { to: e.target.value })} /></label>
            <strong className="act-len">{fmtDuration((timed[i].to - timed[i].from) / 60_000)}</strong>
          </li>
        ))}
      </ol>
      <div className="row-buttons">
        <button className="ghost" onClick={() => add("drive")}>+ Jazda</button>
        <button className="ghost" onClick={() => add("break")}>+ Przerwa</button>
        <button className="ghost" onClick={() => add("work")}>+ Praca</button>
      </div>
      <div className="recon">
        <span>Jazda od początku dnia: <strong>{fmtDuration(r.drivenTodayMin)}</strong></span>
        <span>Od ostatniej przerwy: <strong>{fmtDuration(r.sinceBreakMin)}</strong>{r.splitBreakTaken ? " (odbyte 15 min przerwy)" : ""}</span>
        {r.gapMin >= 1 && <span>Niewpisany czas (liczony jako postój): <strong>{fmtDuration(r.gapMin)}</strong></span>}
        <span>Ostatnia aktywność kończy się: <strong>{fmtClock(end, planNow)}</strong></span>
        {Math.abs(gap) > 15 && (
          <span className="warn-text">
            {gap > 0
              ? `Od ${fmtClock(end, planNow)} do teraz minęło ${fmtDuration(gap)} — jeśli to nie był postój, dopisz aktywność.`
              : `Aktywności wychodzą ${fmtDuration(-gap)} poza aktualną godzinę — sprawdź godziny.`}
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
