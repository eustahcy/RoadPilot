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
  onStart: (start: number, targetMin: number | null) => void;
  onCancel?: () => void;
}

/** Długości do wyboru + „bez limitu” (null) — np. załadunek, nocleg: trwa do ruszenia. */
const TARGETS: (number | null)[] = [...STOP_PRESETS, null];

const targetLabel = (m: number | null) => (m === null ? "Bez limitu" : fmtDuration(m));

/** Wybór długości postoju i momentu startu. Krótszy lub dłuższy postój też się liczy — wg faktycznego czasu. */
export function StopPicker({ driver, now, onStart, onCancel }: PickerProps) {
  const [target, setTarget] = useState<number | null>(() => suggestedStop(driver));
  const [ago, setAgo] = useState(0);
  const suggested = suggestedStop(driver);
  return (
    <div className="stop-picker">
      <div className="stop-label">Ile chcesz stać?</div>
      <div className="stop-chips">
        {TARGETS.map((m) => (
          <button key={m ?? "open"} className={`stop-chip ${m === target ? "active" : ""}`} onClick={() => setTarget(m)}>
            {targetLabel(m)}
            {m === suggested && <small>potrzebna</small>}
            {m === null && <small>do ruszenia</small>}
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
      <p className="stop-note">
        {target === null
          ? "Np. załadunek, rozładunek, nocleg. Liczy faktyczny czas i pokazuje, co już się zalicza (przerwa, odpoczynek). Z włączonym GPS kończy się sam, gdy ruszysz (powyżej 5 km/h)."
          : "Liczy się faktyczny czas postoju — możesz skończyć wcześniej albo później."}
      </p>
      <div className="stop-actions">
        {onCancel && <button className="ghost" onClick={onCancel}>Anuluj</button>}
        <button className="primary" onClick={() => onStart(floorMinute(now) - ago * 60_000, target)}>{target === null ? "Zaczynam postój bez limitu" : `Zaczynam postój ${fmtDuration(target)}`}</button>
      </div>
    </div>
  );
}

interface ActiveProps {
  stop: ActiveStop;
  driver: DriverState;
  onEnd: (end: number) => void;
  onCancel: () => void;
  onTarget: (targetMin: number | null) => void;
  /** Dla odpoczynku po „Zakończ dzień” — zamiast „Koniec postoju”. */
  onStartDay?: () => void;
}

/** Nowy dzień po zbyt krótkim odpoczynku — decyzja kierowcy, ale z ostrzeżeniem. */
export function confirmStartDay(stop: ActiveStop | null, now: number) {
  const min = stop ? (now - stop.start) / 60_000 : Infinity;
  return min >= RULES.reducedDailyRest || confirm(`Odpoczynek trwał dopiero ${fmtDuration(min)} — mniej niż 9 h, więc nie jest pełnym odpoczynkiem dziennym. Rozpocząć nowy dzień mimo to?`);
}

/** Trwający postój: odliczanie, co już jest zaliczone i co będzie za chwilę. */
export function ActiveStopPanel({ stop, driver, onEnd, onCancel, onTarget, onStartDay }: ActiveProps) {
  const now = useSecondTick();
  const elapsed = Math.max(0, (now - stop.start) / 60_000);
  const target = stop.targetMin;
  const left = target === null ? Infinity : target - elapsed;
  const credit = stopCredit(driver, elapsed);
  const next = nextStopThreshold(driver, elapsed);
  return (
    <div className={`stop-active ${left <= 0 ? "done" : ""} ${target === null ? "open" : ""}`}>
      <div className="stop-head">
        <span className="stop-label">
          {stop.dayEnd
            ? `Koniec dnia · odpoczynek od ${fmtClock(stop.start, now)}${target !== null ? ` · plan ${fmtDuration(target)}` : ""}`
            : target === null ? `Postój bez limitu od ${fmtClock(stop.start, now)}` : `${target >= RULES.reducedDailyRest ? "Odpoczynek" : "Przerwa"} od ${fmtClock(stop.start, now)} · plan ${fmtDuration(target)}`}
        </span>
        <strong className="stop-timer">{fmtTimer(elapsed)}</strong>
        <span className="stop-left">
          {target === null
            ? "trwa, dopóki nie ruszysz (powyżej 5 km/h)"
            : left > 0 ? `zostało ${fmtTimerShort(left)} · do ${fmtClock(stop.start + target * 60_000, now)}` : `plan osiągnięty${left < -1 ? ` · +${fmtDuration(-left)}` : ""}`}
        </span>
      </div>
      {target !== null && <div className="stop-bar"><span style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }} /></div>}
      {stop.auto && <p className="stop-note">Włączony automatycznie po zatrzymaniu — skończy się sam, gdy ruszysz.</p>}
      <p className={`stop-credit ${credit === "none" ? "" : "ok"}`}>
        {credit === "none" ? "Jeszcze nic się nie zalicza" : `Zaliczone: ${CREDIT[credit]}`}
        {next && (target === null || next.at <= Math.max(target, elapsed + 1)) && <span> · za {fmtDuration(Math.ceil(next.at - elapsed))}: {SHORT[next.credit]}</span>}
      </p>
      <div className="stop-chips">
        {TARGETS.map((m) => (
          <button key={m ?? "open"} className={`stop-chip ${m === target ? "active" : ""}`} onClick={() => onTarget(m)}>{targetLabel(m)}</button>
        ))}
      </div>
      <div className="stop-actions">
        <button className="ghost" onClick={() => { if (confirm("Anulować postój? Nic nie zostanie zaliczone.")) onCancel(); }}>Anuluj</button>
        {stop.dayEnd && onStartDay
          ? <button className="primary" onClick={() => confirmStartDay(stop, now) && onStartDay()}>Rozpocznij dzień</button>
          : <button className="primary" onClick={() => onEnd(now)}>Koniec postoju</button>}
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
  onStart: (start: number, targetMin: number | null) => void;
  onEnd: (end: number) => void;
  onCancel: () => void;
  onTarget: (targetMin: number | null) => void;
  onEndDay: () => void;
  onStartDay: () => void;
}

/** Karta w zakładce Plan: przycisk „Zaczynam przerwę” albo trwający postój. */
export function StopCard(p: StopControlsProps) {
  const [open, setOpen] = useState(false);
  if (p.stop) {
    return (
      <section className="card stop-card active">
        <ActiveStopPanel stop={p.stop} driver={p.driver} onEnd={p.onEnd} onCancel={p.onCancel} onTarget={p.onTarget} onStartDay={p.onStartDay} />
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
      {!open && (
        <button className="ghost day-btn" onClick={() => confirm("Zakończyć dzień pracy? Zacznie się odpoczynek dzienny — liczony do „Rozpocznij dzień” albo do ruszenia.") && p.onEndDay()}>
          Zakończ dzień
        </button>
      )}
    </section>
  );
}
