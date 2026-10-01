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

  return (
    <div className="report">
      <div className="stop-label">{place !== undefined ? `Zgłoś na drodze${place ? ` ${place}` : ""}` : "Zgłoś w tym miejscu"}{def ? `: ${def.label.toLowerCase()}` : ""}</div>
      {!located && <p className="warn-text small">Brak pozycji GPS — zgłoszenie wymaga lokalizacji.</p>}
      {/* Fotoradar, odcinkowy, kontrole — jedno dotknięcie wysyła od razu (w czasie jazdy). */}
      <div className="report-quick">
        {REPORT_KINDS.filter((k) => k.quick).map((k) => (
          <button key={k.id} className={`report-quick-btn ${k.id} ${kind === k.id && state !== "idle" ? "active" : ""}`} disabled={!located || state === "sending" || state === "sent"} onClick={() => send(k.id)} aria-label={k.label} title={k.label}>
            <ReportIcon kind={k.id} />
            {kind === k.id && state !== "idle" && state !== "error" && <em>{state === "sending" ? "…" : "✓"}</em>}
          </button>
        ))}
      </div>
      {/* Parking / MOP / stacja, których nie ma w nawigacji — jedno dotknięcie, miejsce = nasza pozycja (albo przytrzymane na mapie). */}
      <div className="report-places-label">Brakuje na mapie:</div>
      <div className="report-places">
        {REPORT_KINDS.filter((k) => k.place).map((k) => (
          <button key={k.id} className={`report-place ${kind === k.id && state !== "idle" ? "active" : ""}`} disabled={!located || state === "sending" || state === "sent"} onClick={() => send(k.id)} aria-label={`Tu jest: ${k.label}`}>
            <ReportIcon kind={k.id} />
            <span>{kind === k.id && state === "sending" ? "Wysyłam…" : kind === k.id && state === "sent" ? "Dziękujemy ✓" : k.label}</span>
          </button>
        ))}
      </div>
      <div className="report-kinds">
        {REPORT_KINDS.filter((k) => !k.quick && !k.place).map((k) => (
          <button key={k.id} className={`report-kind ${kind === k.id ? "active" : ""}`} onClick={() => pick(k.id)} aria-label={k.label} title={k.label}>
            <ReportIcon kind={k.id} />
          </button>
        ))}
      </div>
      {def?.unit && (
        <div className="report-value">
          <button className="ghost" onClick={() => step(-1)} aria-label="Mniej">−</button>
          <b>{String(value).replace(".", ",")} {def.unit}</b>
          <button className="ghost" onClick={() => step(1)} aria-label="Więcej">+</button>
        </div>
      )}
      {state === "error" && <p className="auth-error">{error}</p>}
      {!def?.quick && !def?.place && (
        <button className="primary full" disabled={!kind || !located || state === "sending" || state === "sent"} onClick={() => send()}>
          {state === "sent" ? "Dziękujemy — wysłane" : state === "sending" ? "Wysyłam…" : "Wyślij zgłoszenie"}
        </button>
      )}
    </div>
  );
}
