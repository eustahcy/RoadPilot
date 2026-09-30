import { PlanEvent } from "../core/plan";
import { fmtClock, fmtDuration, fmtKm } from "../format";

const LABEL: Record<PlanEvent["kind"], string> = {
  drive: "Jazda",
  break: "Przerwa",
  rest: "Odpoczynek dzienny",
  weeklyRest: "Odpoczynek tygodniowy",
  arrive: "Przyjazd",
};

export function eventLabel(e: PlanEvent) {
  return LABEL[e.kind];
}

export function Timeline({ events, reference }: { events: PlanEvent[]; reference: number }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const minutes = (e.end - e.start) / 60_000;
        return (
          <li key={i} className={`tl tl-${e.kind}`}>
            <span className="tl-time">{fmtClock(e.start, reference)}</span>
            <span className="tl-dot" aria-hidden />
            <span className="tl-body">
              <strong>
                {LABEL[e.kind]}
                {e.kind !== "arrive" && <span className="tl-dur"> · {fmtDuration(minutes)}</span>}
              </strong>
              <span className="tl-sub">
                {e.kind === "drive" ? `${fmtKm(e.fromKm)} → ${fmtKm(e.toKm)} (${fmtKm(e.toKm - e.fromKm)})` : e.kind === "arrive" ? fmtKm(e.toKm) : `${e.reason} · na ${fmtKm(e.fromKm)}`}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
