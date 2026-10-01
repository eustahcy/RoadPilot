import { useEffect, useState } from "react";
import { api } from "../api";
import { DayLog, daySummary, dayKey } from "../core/history";
import { Violation, VIOLATION_INFO, VIOLATION_REASONS, violationReport, Where, whereText } from "../core/violations";
import { fmtDuration, fmtKm, fmtTime } from "../format";

const DAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
/** Podsumowanie ostatnich dni — tyle wstecz, licząc dziś. */
const SUMMARY_DAYS = 7;
const DAY_MS = 86_400_000;

interface Props {
  history: DayLog[];
  now: number;
  gpsOn: boolean;
  onClear: () => void;
  /** Token konta — do ustalenia miejsca przekroczenia (miejscowość, droga, MOP); bez konta tylko współrzędne. */
  token: string | null;
  onWhere: (id: string, where: Where | null) => void;
}

/** Historia dzienna z GPS: podsumowanie tygodnia, pasek doby (jazda, postoje, luki, przekroczenia), szczegóły po rozwinięciu. */
export function HistoryCard({ history, now, gpsOn, onClear, token, onWhere }: Props) {
  const [open, setOpen] = useState<string | null>(() => dayKey(now));
  const [confirm, setConfirm] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const shownV = shown ? history.flatMap((d) => d.violations ?? []).find((v) => v.id === shown) : undefined;
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
              <DayRow key={d.date} d={d} now={now} open={open === d.date} onToggle={() => setOpen(open === d.date ? null : d.date)} onViolation={setShown} />
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
      {shownV && <ViolationSheet v={shownV} token={token} onWhere={onWhere} onClose={() => setShown(null)} />}
    </section>
  );
}

function DayRow({ d, now, open, onToggle, onViolation }: { d: DayLog; now: number; open: boolean; onToggle: () => void; onViolation: (id: string) => void }) {
  const { stopMin, avgKmh } = daySummary(d);
  const vs = (d.violations ?? []).slice().sort((a, b) => a.t - b.t);
  return (
    <article className={`history-day ${open ? "open" : ""} ${vs.length ? "bad" : ""}`}>
      <button className="history-head" onClick={onToggle} aria-expanded={open}>
        <span>
          <strong>{dayLabel(d.date, now)}{vs.length > 0 && <em className="history-bad">! {vs.length === 1 ? "przekroczenie" : `${vs.length} przekroczenia`}</em>}</strong>
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
          {vs.length > 0 && (
            <ul className="history-violations">
              {vs.map((v) => (
                <li key={v.id}>
                  <button onClick={() => onViolation(v.id)}>
                    <span>
                      <b>{VIOLATION_INFO[v.kind].short}</b>
                      <small>{fmtTime(v.t)}{v.est ? " (szac.)" : ""}{whereText(v.where) ? ` · ${whereText(v.where)}` : ""}</small>
                    </span>
                    <strong>{v.kind === "shortRest" ? "−" : "+"}{fmtDuration(v.overMin)}{v.open ? "…" : ""}</strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="history-facts">
            <span><b>{fmtDuration(d.driveMin)}</b> jazda</span>
            <span><b>{d.stops.length ? fmtDuration(stopMin) : "—"}</b> {d.stops.length ? `postoje (${d.stops.length})` : "bez postojów"}</span>
            <span><b>{avgKmh !== undefined ? `${Math.round(avgKmh)} km/h` : "—"}</b> średnio</span>
          </div>
          {d.stops.length > 0 && (
            <ul className="history-stops">
              {d.stops.map((s) => (
                <li key={s.start}>
                  <span>{fmtTime(s.start)} – {fmtTime(s.end)}{s.est ? " · szacunkowo" : ""}</span>
                  <strong>{fmtDuration((s.end - s.start) / 60_000)}</strong>
                </li>
              ))}
            </ul>
          )}
          {(d.gaps ?? []).map((g) => (
            <p key={g.start} className="history-gap">
              <b>Aplikacja zamknięta {fmtTime(g.start)} – {fmtTime(g.end)}</b>
              <span>
                {g.km > 0 ? `oszacowano ${fmtKm(g.km)} i ${fmtDuration(g.driveMin)} jazdy` : "bez ruchu"}
                {g.driveMin >= 1 ? ` (śr. ${Math.round((g.km / g.driveMin) * 60)} km/h)` : ""}
                {(g.end - g.start) / 60_000 - g.driveMin >= 1 ? `, ${fmtDuration((g.end - g.start) / 60_000 - g.driveMin)} postoju` : ""}
                {g.km > 0 ? ` — ${g.road ? "droga z mapy" : "z linii prostej"}` : ""}
              </span>
            </p>
          ))}
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
        {(d.gaps ?? []).map((g) => bar(g.start, g.end, "gap", g.start))}
        {(d.violations ?? []).map((v) => bar(v.t, v.t, "over", v.t))}
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

/**
 * Szczegóły przekroczenia: o ile, gdzie (miejscowość, droga, MOP / stacja z serwera — pytamy raz i zapamiętujemy w historii),
 * wiersze jak na wydruku i gotowa notatka na odwrót wydruku z tachografu z wybranym powodem.
 */
function ViolationSheet({ v, token, onWhere, onClose }: { v: Violation; token: string | null; onWhere: (id: string, where: Where | null) => void; onClose: () => void }) {
  const [reason, setReason] = useState<string | undefined>();
  const [copied, setCopied] = useState<"note" | "print" | null>(null);
  const [failed, setFailed] = useState(false);
  const hasPos = v.lat !== undefined && v.lon !== undefined;
  useEffect(() => {
    if (v.where !== undefined || !hasPos || !token) return;
    api<Where>("POST", "/geo/where", { lat: v.lat, lon: v.lon }, token)
      .then((w) => onWhere(v.id, w))
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.id, token]);
  const r = violationReport(v, reason);
  const where = whereText(v.where);
  const copy = async (what: "note" | "print") => {
    try {
      await navigator.clipboard.writeText(what === "note" ? r.note : r.printout.join("\n"));
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } catch {
      /* brak schowka — tekst jest widoczny do przepisania */
    }
  };
  return (
    <div className="vio-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vio-sheet-body" role="dialog" aria-label={r.title}>
        <button className="vio-close" aria-label="Zamknij" onClick={onClose}>×</button>
        <div className="eyebrow">{VIOLATION_INFO[v.kind].law}</div>
        <h2 className="vio-title">{r.title}</h2>
        <p className="vio-summary">{r.summary}</p>
        <p className="muted small">
          {where ?? (!hasPos ? "Brak pozycji z tej chwili." : !token ? "Miejscowość, drogę i MOP ustalimy po zalogowaniu — teraz tylko współrzędne." : failed ? "Nie udało się ustalić miejsca (brak sieci) — spróbuj później." : v.where === null ? "Nie udało się ustalić miejsca." : "Ustalam miejsce…")}
          {hasPos && <> · <a href={`https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lon}`} target="_blank" rel="noopener">mapa</a></>}
        </p>
        {v.est && <p className="vio-est">Przekroczenie wypadło, gdy aplikacja była zamknięta — godzina i miejsce są szacunkowe.</p>}

        <div className="eyebrow">Powód</div>
        <div className="vio-reasons">
          {VIOLATION_REASONS.map((x) => (
            <button key={x.id} className={reason === x.text ? "active" : ""} aria-pressed={reason === x.text} onClick={() => setReason(reason === x.text ? undefined : x.text)}>{x.text}</button>
          ))}
        </div>

        <div className="eyebrow">Na odwrót wydruku</div>
        <pre className="vio-pre">{r.note}</pre>
        <button className="ghost" onClick={() => copy("note")}>{copied === "note" ? "Skopiowano ✓" : "Kopiuj notatkę"}</button>

        <div className="eyebrow">Jak na wydruku</div>
        <pre className="vio-pre printout">{r.printout.join("\n")}</pre>
        <button className="ghost" onClick={() => copy("print")}>{copied === "print" ? "Skopiowano ✓" : "Kopiuj"}</button>
        <p className="muted small">Zapis z GPS jest pomocniczy — porównaj z wydrukiem z tachografu (godziny na wydruku są w UTC). Uzupełnij dane kierowcy i podpisz.</p>
      </div>
    </div>
  );
}

