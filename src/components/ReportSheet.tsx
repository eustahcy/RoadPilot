import { useState } from "react";
import { REPORT_KINDS, ReportKind } from "../collect";
import { ReportIcon } from "./ReportIcon";

/** HUD: zgłoszenie z drogi w miejscu, w którym jesteśmy (albo przytrzymanym na mapie — `place`) — rodzaj, wartość (np. 3,8 m), wysłanie. */
export function ReportSheet({ onSend, onClose, located, place }: { onSend: (kind: ReportKind, value: number | null) => Promise<void>; onClose: () => void; located: boolean; place?: string }) {
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [value, setValue] = useState(0);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const def = REPORT_KINDS.find((k) => k.id === kind);

  const pick = (k: ReportKind) => {
    setKind(k);
    setValue(REPORT_KINDS.find((x) => x.id === k)!.def ?? 0);
  };
  const send = async (quick?: ReportKind) => {
    const k = quick ?? kind;
    if (!k) return;
    if (quick) setKind(quick);
    setState("sending");
    try {
      await onSend(k, quick || !def?.unit ? null : value);
      setState("sent");
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się wysłać.");
      setState("error");
    }
  };
  const step = (d: number) => setValue((v) => Math.round(Math.min(def!.max!, Math.max(def!.min!, v + d * def!.step!)) * 10) / 10);

  const busy = state === "sending" || state === "sent";
  const tile = (k: (typeof REPORT_KINDS)[number], onClick: () => void, active: boolean) => (
    <button key={k.id} className={`report-tile ${k.id} ${active ? "active" : ""}`} disabled={!located || (busy && !active)} onClick={onClick} aria-label={k.label}>
      <i><ReportIcon kind={k.id} />{active && state !== "idle" && state !== "error" && <em>{state === "sending" ? "…" : "✓"}</em>}</i>
      <span>{k.label}</span>
    </button>
  );

  return (
    <div className="report">
      <p className="report-where">{place !== undefined ? `Miejsce: ${place || "przytrzymane na mapie"}` : "Miejsce: Twoja pozycja"}</p>
      {!located && <p className="warn-text small">Brak pozycji GPS — zgłoszenie wymaga lokalizacji.</p>}
      {state === "sent" && <p className="report-done">Dziękujemy — zgłoszenie wysłane ✓</p>}
      {/* Fotoradar, odcinkowy, kontrole — jedno dotknięcie wysyła od razu (w czasie jazdy). */}
      <div className="report-section">Na drodze teraz — jedno dotknięcie</div>
      <div className="report-grid">
        {REPORT_KINDS.filter((k) => k.quick).map((k) => tile(k, () => send(k.id), kind === k.id && state !== "idle"))}
      </div>
      {/* Parking / MOP / stacja, których nie ma w nawigacji — miejsce = nasza pozycja (albo przytrzymane na mapie). */}
      <div className="report-section">Brakuje na mapie</div>
      <div className="report-grid">
        {REPORT_KINDS.filter((k) => k.place).map((k) => tile(k, () => send(k.id), kind === k.id && state !== "idle"))}
      </div>
      <div className="report-section">Ograniczenie lub utrudnienie</div>
      <div className="report-grid">
        {REPORT_KINDS.filter((k) => !k.quick && !k.place).map((k) => tile(k, () => pick(k.id), kind === k.id))}
      </div>
      {def?.unit && (
        <div className="report-value">
          <button className="ghost" onClick={() => step(-1)} aria-label="Mniej">−</button>
          <b>{String(value).replace(".", ",")} {def.unit}</b>
          <button className="ghost" onClick={() => step(1)} aria-label="Więcej">+</button>
        </div>
      )}
      {state === "error" && <p className="auth-error">{error}</p>}
      {def && !def.quick && !def.place && (
        <button className="primary full" disabled={!located || busy} onClick={() => send()}>
          {state === "sent" ? "Dziękujemy — wysłane" : state === "sending" ? "Wysyłam…" : `Wyślij: ${def.label.toLowerCase()}`}
        </button>
      )}
    </div>
  );
}
