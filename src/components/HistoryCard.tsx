import { useState } from "react";
import { DayLog, daySummary, dayKey } from "../core/history";
import { fmtDuration, fmtKm, fmtTime } from "../format";

const DAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
/** Podsumowanie ostatnich dni — tyle wstecz, licząc dziś. */
const SUMMARY_DAYS = 7;
const DAY_MS = 86_400_000;

/** Historia dzienna z GPS: podsumowanie tygodnia, pasek doby (jazda i postoje), szczegóły po rozwinięciu. */
export function HistoryCard({ history, now, gpsOn, onClear }: { history: DayLog[]; now: number; gpsOn: boolean; onClear: () => void }) {
  const [open, setOpen] = useState<string | null>(() => dayKey(now));
  const [confirm, setConfirm] = useState(false);
  const recent = history.filter((d) => d.date >= dayKey(now - (SUMMARY_DAYS - 1) * DAY_MS));
  const weekKm = recent.reduce((a, d) => a + d.km, 0);
  const weekDrive = recent.reduce((a, d) => a + d.driveMin, 0);
  return (
    <section className="card">
      <div className="eyebrow">Historia</div>
      <h2>Dzień po dniu</h2>
      {history.length === 0 ? (
        <p className="muted">{gpsOn ? "Pojawi się po pierwszej jeździe z włączonym GPS." : "Włącz GPS w zakładce Plan — RoadPilot zapisze jazdę, postoje i kilometry z każdego dnia."}</p>
      ) : (
        <>
          <div className="history-week">
            <span className="history-week-label">Ostatnie {SUMMARY_DAYS} dni</span>
            <div><strong>{Math.round(weekKm).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")} km</strong><span>przejechane</span></div>
            <div><strong>{fmtDuration(weekDrive)}</strong><span>jazdy</span></div>
            <div><strong>{recent.filter((d) => d.driveMin > 0).length}</strong><span>dni z jazdą</span></div>
          </div>
          <div className="history">
            {history.map((d) => (
              <DayRow key={d.date} d={d} now={now} open={open === d.date} onToggle={() => setOpen(open === d.date ? null : d.date)} />
            ))}
          </div>
        </>
      )}
      <p className="muted small">Zapis z GPS, gdy aplikacja działa — pomocniczy, nie zastępuje tachografu. Ostatnie 31 dni, tylko w tym urządzeniu.</p>
      {history.length > 0 &&
        (confirm ? (
          <div className="row-buttons">
            <button className="danger" onClick={() => { onClear(); setConfirm(false); }}>Tak, wyczyść historię</button>
            <button className="ghost" onClick={() => setConfirm(false)}>Anuluj</button>
          </div>
        ) : (
          <button className="text-btn" onClick={() => setConfirm(true)}>Wyczyść historię</button>
        ))}
    </section>
  );
}

function DayRow({ d, now, open, onToggle }: { d: DayLog; now: number; open: boolean; onToggle: () => void }) {
  const { stopMin, avgKmh } = daySummary(d);
  return (
    <article className={`history-day ${open ? "open" : ""}`}>
      <button className="history-head" onClick={onToggle} aria-expanded={open}>
        <span>
          <strong>{dayLabel(d.date, now)}</strong>
          <span className="muted">{d.start !== null && d.end !== null ? `${fmtTime(d.start)} – ${fmtTime(d.end)}` : "bez jazdy"}</span>
        </span>
        <span className="history-sum">
          <strong>{fmtKm(d.km)}</strong>
          <span className="muted">{fmtDuration(d.driveMin)} jazdy</span>
        </span>
        <DayClock d={d} />
      </button>
      {open && (
        <div className="history-body">
          <div className="history-facts">
            <span><b>{fmtDuration(d.driveMin)}</b> jazda</span>
            <span><b>{d.stops.length ? fmtDuration(stopMin) : "—"}</b> {d.stops.length ? `postoje (${d.stops.length})` : "bez postojów"}</span>
            <span><b>{avgKmh !== undefined ? `${Math.round(avgKmh)} km/h` : "—"}</b> średnio</span>
          </div>
          {d.stops.length > 0 && (
            <ul className="history-stops">
              {d.stops.map((s) => (
                <li key={s.start}>
                  <span>{fmtTime(s.start)} – {fmtTime(s.end)}</span>
                  <strong>{fmtDuration((s.end - s.start) / 60_000)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

/** Pasek doby 0–24: od pierwszej do ostatniej jazdy na zielono, postoje na niebiesko. */
function DayClock({ d }: { d: DayLog }) {
  const [y, m, day] = d.date.split("-").map(Number);
  const midnight = new Date(y, m - 1, day).getTime();
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - midnight) / DAY_MS) * 100));
  const bar = (from: number, to: number, cls: string, key?: number) => <span key={key} className={cls} style={{ left: `${pct(from)}%`, width: `${Math.max(0.6, pct(to) - pct(from))}%` }} />;
  return (
    <span className="history-clock" aria-hidden>
      <span className="day-strip-bar">
        {d.start !== null && d.end !== null && bar(d.start, d.end, "drive")}
        {d.stops.map((s) => bar(s.start, s.end, "break", s.start))}
      </span>
      <span className="history-clock-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></span>
    </span>
  );
}

/** „Dziś”, „Wczoraj” albo „Wtorek 29.09”. */
function dayLabel(date: string, now: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d, 12).getTime();
  if (date === dayKey(now)) return "Dziś";
  if (date === dayKey(now - DAY_MS)) return "Wczoraj";
  const name = DAYS[new Date(t).getDay()];
  return `${name[0].toUpperCase()}${name.slice(1)} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}
