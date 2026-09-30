import { useState } from "react";
import { DayLog, daySummary, dayKey } from "../core/history";
import { fmtDuration, fmtKm, fmtTime } from "../format";

const DAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];

/** Historia dzienna z GPS: start, koniec, jazda, postoje, km i średnia. */
export function HistoryCard({ history, now, gpsOn, onClear }: { history: DayLog[]; now: number; gpsOn: boolean; onClear: () => void }) {
  const [open, setOpen] = useState<string | null>(() => dayKey(now));
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="card">
      <div className="eyebrow">Historia</div>
      <h2>Dzień po dniu</h2>
      {history.length === 0 ? (
        <p className="muted">{gpsOn ? "Pojawi się po pierwszej jeździe z włączonym GPS." : "Włącz GPS w zakładce Plan — RoadPilot zapisze jazdę, postoje i kilometry z każdego dnia."}</p>
      ) : (
        <div className="history">
          {history.map((d) => (
            <DayRow key={d.date} d={d} now={now} open={open === d.date} onToggle={() => setOpen(open === d.date ? null : d.date)} />
          ))}
        </div>
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
      </button>
      {open && (
        <div className="history-body">
          <div className="stats">
            <Cell label="Rozpoczęcie" value={d.start !== null ? fmtTime(d.start) : "—"} />
            <Cell label="Zakończenie" value={d.end !== null ? fmtTime(d.end) : "—"} />
            <Cell label="Jazda" value={fmtDuration(d.driveMin)} />
            <Cell label="Przerwy" value={fmtDuration(stopMin)} sub={d.stops.length ? `${d.stops.length} × postój` : "brak"} />
            <Cell label="Przejechane" value={fmtKm(d.km)} />
            <Cell label="Średnia prędkość" value={avgKmh !== undefined ? `${Math.round(avgKmh)} km/h` : "—"} sub="w czasie jazdy" />
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

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

/** „Dziś”, „Wczoraj” albo „wtorek 29.09”. */
function dayLabel(date: string, now: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d, 12).getTime();
  if (date === dayKey(now)) return "Dziś";
  if (date === dayKey(now - 86_400_000)) return "Wczoraj";
  return `${DAYS[new Date(t).getDay()]} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}
