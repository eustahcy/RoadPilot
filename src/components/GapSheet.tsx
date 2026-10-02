import { useState } from "react";
import { fmtDuration } from "../core/scenarios";
import { GapAnswer, GapReview } from "../core/gapfix";
import { fmtTime } from "../format";

/**
 * Aplikacja była zamknięta, a ciężarówka się przemieściła — co się działo? Jazda, pauza (ile, na początku czy na końcu)
 * albo sam postój. Odpowiedź przelicza tachograf (core/gapfix). Pytanie przy otwarciu Nawigacji; uzupełnić można też później.
 */
export function GapSheet({ review, onAnswer, onLater }: { review: GapReview; onAnswer: (a: GapAnswer) => void; onLater: () => void }) {
  const { gap } = review;
  const totalMin = Math.round((gap.end - gap.start) / 60_000);
  const [both, setBoth] = useState(false);
  const [pause, setPause] = useState(Math.min(45, totalMin));
  const [at, setAt] = useState<"start" | "end">("end");
  const step = (d: number) => setPause((p) => Math.max(5, Math.min(totalMin, p + d)));
  return (
    <div className="gap-sheet">
      <div className="stop-label">Co robiłeś, gdy aplikacja była zamknięta?</div>
      <p>
        Od <b>{fmtTime(gap.start)}</b> do <b>{fmtTime(gap.end)}</b> ({fmtDuration(totalMin)}) aplikacja nie widziała GPS, a ciężarówka przejechała ok. <b>{Math.round(gap.km)} km</b>.
        {review.answer ? " Odpowiedź już zapisana — możesz ją zmienić." : ` Na razie przyjęliśmy ${fmtDuration(Math.round(gap.driveMin))} jazdy.`}
      </p>
      {!both ? (
        <div className="gap-choices">
          <button className="primary" onClick={() => onAnswer({ kind: "drive" })}>Jechałem cały czas</button>
          <button className="primary" onClick={() => setBoth(true)}>Pauza i jazda</button>
          <button className="ghost" onClick={() => onAnswer({ kind: "stop" })}>Stałem — pauza cały czas</button>
        </div>
      ) : (
        <div className="gap-both">
          <span className="field-label">Ile trwała pauza?</span>
          <div className="report-value">
            <button className="ghost" onClick={() => step(-5)} aria-label="Krócej">−</button>
            <b>{fmtDuration(pause)}</b>
            <button className="ghost" onClick={() => step(5)} aria-label="Dłużej">+</button>
          </div>
          <div className="gap-at">
            <button className={at === "start" ? "on" : ""} aria-pressed={at === "start"} onClick={() => setAt("start")}>Na początku</button>
            <button className={at === "end" ? "on" : ""} aria-pressed={at === "end"} onClick={() => setAt("end")}>Na końcu</button>
          </div>
          <p className="muted small">Jazda: {fmtDuration(totalMin - pause)}.</p>
          <button className="primary full" onClick={() => onAnswer({ kind: "both", pauseMin: pause, pauseAt: at })}>Zapisz</button>
        </div>
      )}
      <button className="text-btn" onClick={onLater}>Później (uzupełnisz w menu ⋯ albo w Historii)</button>
    </div>
  );
}
