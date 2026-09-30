import { useEffect, useState } from "react";
import { DriverState } from "../core/plan";
import { RULES } from "../core/rules";
import { ActiveStop, nextStopThreshold, STOP_PRESETS, StopCredit, stopCredit, suggestedStop } from "../core/stop";
import { fmtClock, fmtDuration } from "../format";
import { floorMinute } from "../state";

/** Ile minut temu zaczął się postój — kierowca często oznacza go dopiero po zaparkowaniu. */
const STARTED_AGO = [0, 5, 10, 15];

const CREDIT: Record<StopCredit, string> = {
  none: "jeszcze nic się nie zalicza",
  splitFirst: "1. część przerwy (15 min) — potem wystarczy 30 min",
  break: "przerwa zaliczona — 4,5 h jazdy od nowa",
  reducedRest: "skrócony odpoczynek dzienny (9 h)",
  dailyRest: "regularny odpoczynek dzienny (11 h)",
};

const SHORT: Record<StopCredit, string> = {
  none: "nic",
  splitFirst: "1. część przerwy",
  break: "przerwa zaliczona",
  reducedRest: "odpoczynek 9 h",
  dailyRest: "odpoczynek 11 h",
};

interface PickerProps {
  driver: DriverState;
  now: number;
  onStart: (start: number, targetMin: number) => void;
  onCancel?: () => void;
}

/** Wybór długości postoju i momentu startu. Krótszy lub dłuższy postój też się liczy — wg faktycznego czasu. */
export function StopPicker({ driver, now, onStart, onCancel }: PickerProps) {
  const [target, setTarget] = useState(() => suggestedStop(driver));
  const [ago, setAgo] = useState(0);
  const suggested = suggestedStop(driver);
  return (
    <div className="stop-picker">
      <div className="stop-label">Ile chcesz stać?</div>
      <div className="stop-chips">
        {STOP_PRESETS.map((m) => (
          <button key={m} className={`stop-chip ${m === target ? "active" : ""}`} onClick={() => setTarget(m)}>
            {fmtDuration(m)}
            {m === suggested && <small>potrzebna</small>}
          </button>
        ))}
      </div>
      <div className="stop-label">Stoję od</div>
      <div className="stop-chips">
        {STARTED_AGO.map((m) => (
          <button key={m} className={`stop-chip ${m === ago ? "active" : ""}`} onClick={() => setAgo(m)}>
            {m === 0 ? "teraz" : `${m} min temu`}
          </button>
        ))}
      </div>
      <p className="stop-note">Liczy się faktyczny czas postoju — możesz skończyć wcześniej albo później.</p>
      <div className="stop-actions">
        {onCancel && <button className="ghost" onClick={onCancel}>Anuluj</button>}
        <button className="primary" onClick={() => onStart(floorMinute(now) - ago * 60_000, target)}>Zaczynam postój {fmtDuration(target)}</button>
      </div>
    </div>
  );
}

interface ActiveProps {
  stop: ActiveStop;
  driver: DriverState;
  onEnd: (end: number) => void;
  onCancel: () => void;
  onTarget: (targetMin: number) => void;
}

/** Trwający postój: odliczanie, co już jest zaliczone i co będzie za chwilę. */
export function ActiveStopPanel({ stop, driver, onEnd, onCancel, onTarget }: ActiveProps) {
  const now = useSecondTick();
  const elapsed = Math.max(0, (now - stop.start) / 60_000);
  const left = stop.targetMin - elapsed;
  const credit = stopCredit(driver, elapsed);
  const next = nextStopThreshold(driver, elapsed);
  const pct = Math.min(100, (elapsed / stop.targetMin) * 100);
  return (
    <div className={`stop-active ${left <= 0 ? "done" : ""}`}>
      <div className="stop-head">
        <span className="stop-label">{stop.targetMin >= RULES.reducedDailyRest ? "Odpoczynek" : "Przerwa"} od {fmtClock(stop.start, now)} · plan {fmtDuration(stop.targetMin)}</span>
        <strong className="stop-timer">{fmtTimer(elapsed)}</strong>
        <span className="stop-left">{left > 0 ? `zostało ${fmtTimerShort(left)} · do ${fmtClock(stop.start + stop.targetMin * 60_000, now)}` : `plan osiągnięty${left < -1 ? ` · +${fmtDuration(-left)}` : ""}`}</span>
      </div>
      <div className="stop-bar"><span style={{ width: `${pct}%` }} /></div>
      <p className={`stop-credit ${credit === "none" ? "" : "ok"}`}>
        {credit === "none" ? "Jeszcze nic się nie zalicza" : `Zaliczone: ${CREDIT[credit]}`}
        {next && next.at <= Math.max(stop.targetMin, elapsed + 1) && <span> · za {fmtDuration(Math.ceil(next.at - elapsed))}: {SHORT[next.credit]}</span>}
      </p>
      <div className="stop-chips">
        {STOP_PRESETS.map((m) => (
          <button key={m} className={`stop-chip ${m === stop.targetMin ? "active" : ""}`} onClick={() => onTarget(m)}>{fmtDuration(m)}</button>
        ))}
      </div>
      <div className="stop-actions">
        <button className="ghost" onClick={() => { if (confirm("Anulować postój? Nic nie zostanie zaliczone.")) onCancel(); }}>Anuluj</button>
        <button className="primary" onClick={() => onEnd(now)}>Koniec postoju</button>
      </div>
    </div>
  );
}

function useSecondTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** „12:34” (min:s) albo „9:05:12” (h:min:s). */
export function fmtTimer(min: number) {
  const s = Math.floor(min * 60);
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Pozostały czas: pod godzinę z sekundami, dłużej — w h i min. */
function fmtTimerShort(min: number) {
  return min < 60 ? fmtTimer(min) : fmtDuration(Math.ceil(min));
}

export interface StopControlsProps {
  stop: ActiveStop | null;
  /** Stan kierowcy sprzed postoju — z niego liczymy, co postój zaliczy. */
  driver: DriverState;
  now: number;
  onStart: (start: number, targetMin: number) => void;
  onEnd: (end: number) => void;
  onCancel: () => void;
  onTarget: (targetMin: number) => void;
}

/** Karta w zakładce Plan: przycisk „Zaczynam przerwę” albo trwający postój. */
export function StopCard(p: StopControlsProps) {
  const [open, setOpen] = useState(false);
  if (p.stop) {
    return (
      <section className="card stop-card active">
        <ActiveStopPanel stop={p.stop} driver={p.driver} onEnd={p.onEnd} onCancel={p.onCancel} onTarget={p.onTarget} />
      </section>
    );
  }
  return (
    <section className="card stop-card">
      {open ? (
        <StopPicker driver={p.driver} now={p.now} onCancel={() => setOpen(false)} onStart={(start, target) => { p.onStart(start, target); setOpen(false); }} />
      ) : (
        <button className="stop-open" onClick={() => setOpen(true)}>
          <span>
            <span className="eyebrow">Postój</span>
            <strong>Zaczynam przerwę</strong>
          </span>
          <span className="muted">odliczanie i zaliczenie do tachografu w planie</span>
        </button>
      )}
    </section>
  );
}
