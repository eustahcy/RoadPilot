import { useEffect, useRef, useState } from "react";
import { isAlert, RouteWarning } from "../nav";
import { ReportIcon } from "./ReportIcon";

/** Pytamy po minięciu miejsca (km za nim) i trzymamy pytanie tyle ms. */
const ASK_AFTER_KM = [0.05, 0.6] as const;
const ASK_FOR_MS = 15_000;

const QUESTION: Record<string, string> = {
  camera: "Fotoradar nadal tu jest?",
  red_light: "Kamera na czerwonym nadal jest?",
  section: "Odcinkowy pomiar nadal działa?",
  police: "Kontrola policji nadal stoi?",
  itd: "Kontrola ITD nadal stoi?",
};

/**
 * Po minięciu fotoradaru / kontroli: „nadal jest?” — łapka w górę / w dół. Każde miejsce raz na przejazd;
 * odcinkowy pomiar — po jego końcu. Bez odpowiedzi znika po ASK_FOR_MS.
 */
export function AlertVote({ warnings, km, onVote }: { warnings: RouteWarning[] | undefined; km: number | undefined; onVote: (w: RouteWarning, vote: 1 | -1) => Promise<void> }) {
  const asked = useRef(new Set<string>());
  const [ask, setAsk] = useState<{ w: RouteWarning; at: number } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (km === undefined || ask) return;
    const w = warnings?.find((x) => {
      if (!isAlert(x) || asked.current.has(`${x.source}:${x.id}`)) return false;
      const past = km - (x.toKm ?? x.km);
      return past >= ASK_AFTER_KM[0] && past <= ASK_AFTER_KM[1];
    });
    if (!w) return;
    asked.current.add(`${w.source}:${w.id}`);
    setDone(false);
    setAsk({ w, at: Date.now() });
  }, [km, warnings, ask]);

  useEffect(() => {
    if (!ask) return;
    const id = setTimeout(() => setAsk(null), done ? 1500 : ASK_FOR_MS);
    return () => clearTimeout(id);
  }, [ask, done]);

  if (!ask) return null;
  const vote = (v: 1 | -1) => {
    setDone(true);
    onVote(ask.w, v).catch(() => {});
  };
  return (
    <div className="alert-vote" role="dialog" aria-label={QUESTION[ask.w.kind]}>
      <ReportIcon kind={ask.w.kind} />
      <span>{done ? "Dziękujemy!" : QUESTION[ask.w.kind] ?? "Nadal jest?"}</span>
      {!done && (
        <>
          <button className="up" onClick={() => vote(1)} aria-label="Tak, jest">👍</button>
          <button className="down" onClick={() => vote(-1)} aria-label="Nie ma">👎</button>
        </>
      )}
    </div>
  );
}
