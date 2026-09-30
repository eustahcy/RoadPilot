import { ReactNode, useState } from "react";
import { DeadlinePlan } from "../core/deadline";
import { parkingHint, Plan, PlanEvent, PlanOptions } from "../core/plan";
import { Route } from "../core/route";
import { Comparison, DriverStatus, explain, Scenario, ScenarioId, WhatIf } from "../core/scenarios";
import { fmtClock, fmtDuration, fmtKm } from "../format";
import { AppState } from "../state";
import { OngoingCard, Reminders } from "./Reminders";
import { StopCard, StopControlsProps } from "./StopControls";
import { eventLabel, Timeline } from "./Timeline";

interface Props {
  state: AppState;
  route: Route;
  comparison: Comparison;
  hints: WhatIf[];
  status: DriverStatus;
  planNow: number;
  deadline?: DeadlinePlan;
  /** Scenariusz wybrany przez kierowcę (zamiast zalecanego). */
  chosen?: Scenario;
  /** Plan, według którego jedziemy: wybrany, pod rozładunek albo zalecany. */
  activePlan?: Plan;
  onChoose: (id: ScenarioId | null) => void;
  ongoing: boolean;
  onOngoing: (on: boolean) => void;
  /** Prędkość z GPS, z której liczony jest przyjazd (km/h). */
  liveKmh?: number;
  gps: ReactNode;
  stopControls: StopControlsProps;
  onOption: (option: WhatIf["option"], value: boolean) => void;
  onOptions: (options: PlanOptions) => void;
  goTo: (tab: "route" | "driver") => void;
}

export function PlanView({ state, route, comparison, hints, status, planNow, deadline, chosen, activePlan: active, onChoose, ongoing, onOngoing, liveKmh, gps, stopControls, onOption, onOptions, goTo }: Props) {
  const best = comparison.scenarios.find((s) => s.id === comparison.bestId);
  const { trip, settings } = state;
  const parking = active ? parkingHint(active, route, settings.parkingBufferMin) : undefined;

  return (
    <>
      <section className="card hero-card">
        <button className="dest" onClick={() => goTo("route")}>
          <span className="eyebrow">Cel</span>
          <span className="dest-name">{trip.destination || "Ustaw cel podróży"}</span>
          <span className="muted">
            {fmtKm(route.totalKm)} · {fmtDuration(route.driveMinutes(0))} samej jazdy{liveKmh ? ` · tempo z GPS ${liveKmh} km/h` : ""}
          </span>
        </button>
        {chosen ? (
          <div className="eta-block">
            <span className="eyebrow">Przewidywany przyjazd</span>
            <strong className={`eta-big ${deadline && chosen.plan.arrival > deadline.deadline ? "late" : ""}`}>{fmtClock(chosen.plan.arrival, planNow)}</strong>
            <span className="muted">Twój wybór: {chosen.label.toLowerCase()} · łącznie {fmtDuration((chosen.plan.arrival - planNow) / 60_000)}</span>
          </div>
        ) : deadline ? (
          <div className="eta-block">
            <span className="eyebrow">Rozładunek {fmtClock(deadline.deadline, planNow)}</span>
            <strong className={`eta-big ${deadline.onTime ? "" : "late"}`}>{fmtClock(deadline.plan?.arrival ?? deadline.earliest ?? deadline.deadline, planNow)}</strong>
            <span className="muted">
              {deadline.onTime
                ? `przyjazd · ${fmtDuration(deadline.slackMin!)} przed awizacją`
                : deadline.earliest !== undefined
                  ? `najwcześniejszy przyjazd · spóźnienie ${fmtDuration(deadline.lateByMin!)}`
                  : "brak wykonalnego planu"}
            </span>
          </div>
        ) : best ? (
          <div className="eta-block">
            <span className="eyebrow">Przewidywany przyjazd</span>
            <strong className="eta-big">{fmtClock(best.plan.arrival, planNow)}</strong>
            <span className="muted">{best.label.toLowerCase()} · łącznie {fmtDuration((best.plan.arrival - planNow) / 60_000)}</span>
          </div>
        ) : (
          <div className="eta-block"><span className="muted">Brak wykonalnego scenariusza</span></div>
        )}
      </section>

      <StopCard {...stopControls} />

      {gps}

      {chosen ? (
        <NextStep best={chosen} parking={parking} planNow={planNow} chosen deadline={deadline?.deadline} onReset={() => onChoose(null)} />
      ) : deadline ? (
        <DeadlineCard d={deadline} parking={parking} planNow={planNow} onOptions={onOptions} goTo={goTo} />
      ) : (
        <NextStep best={best} parking={parking} planNow={planNow} />
      )}

      <section className="card">
        <button className="section-head" onClick={() => goTo("driver")}>
          <span>
            <span className="eyebrow">Stan kierowcy</span>
            <h2>Tachograf teraz</h2>
          </span>
          <span className="link">Zmień</span>
        </button>
        <div className="stats">
          <Stat label="Jazda dziś — zostało" value={fmtDuration(status.driveLeftToday)} sub={status.driveLeftTodayExtended > status.driveLeftToday ? `z wydłużeniem ${fmtDuration(status.driveLeftTodayExtended)}` : undefined} warn={status.driveLeftToday <= 30} />
          <Stat label="Do przerwy" value={fmtDuration(Math.min(status.untilBreak, status.driveLeftToday))} sub={`przerwa ${status.breakNeeded} min`} warn={status.untilBreak <= 30} />
          <Stat label="Czas pracy — zostało" value={fmtDuration(Math.max(0, (status.restDeadline - planNow) / 60_000))} sub={`odpoczynek do ${fmtClock(status.restDeadline, planNow)}`} warn={status.restDeadline - planNow <= 60 * 60_000} />
          <Stat label="Tydzień — zostało" value={fmtDuration(status.weekLeft)} sub="limit 56 h / 90 h" warn={status.weekLeft <= 120} />
        </div>
      </section>

      <section className="card">
        <div className="eyebrow">Scenariusze</div>
        <h2>Co się bardziej opłaca?</h2>
        <div className="scenario-list">
          {comparison.scenarios.map((s) => (
            <ScenarioCard key={s.id} s={s} best={best} planNow={planNow} deadline={deadline?.deadline} chosen={chosen?.id === s.id} onChoose={() => onChoose(chosen?.id === s.id ? null : s.id)} />
          ))}
        </div>
        {hints.map((h) => (
          <div className="hint" key={h.option}>
            <span>
              <strong>Co jeśli?</strong> Użycie opcji „{h.label}” da przyjazd {fmtClock(h.arrival, planNow)} — o {fmtDuration(h.savedMin)} wcześniej.
            </span>
            <button className="ghost" onClick={() => onOption(h.option, true)}>Uwzględnij</button>
          </div>
        ))}
        {(settings.allowExtension || settings.allowReducedRest) && (
          <p className="muted small">
            Plan dopuszcza: {[settings.allowExtension && "wydłużenie jazdy do 10 h", settings.allowReducedRest && "skrócony odpoczynek 9 h po drodze"].filter(Boolean).join(", ")}.{" "}
            <button className="text-btn" onClick={() => { onOption("allowExtension", false); onOption("allowReducedRest", false); }}>Wyłącz</button>
          </p>
        )}
      </section>

      {active && <Reminders plan={active} parking={parking} />}

      <OngoingCard on={ongoing} onChange={onOngoing} />
    </>
  );
}

function NextStep({ best, parking, planNow, chosen, deadline, onReset }: { best?: Scenario; parking?: ReturnType<typeof parkingHint>; planNow: number; chosen?: boolean; deadline?: number; onReset?: () => void }) {
  if (!best) return null;
  const events = best.plan.events;
  const first = events[0];
  let title: string;
  let text: string;
  if (best.id !== "now") {
    title = `Odpocznij teraz — ${best.id === "rest9" ? "9 h" : "11 h"}`;
    text = `Ruszysz ${fmtClock(best.plan.departure, planNow)}, przyjazd ${fmtClock(best.plan.arrival, planNow)}.`;
  } else if (first.kind === "drive") {
    const next = events[1] as PlanEvent;
    title = "Jedź";
    text =
      next.kind === "arrive"
        ? `Dojedziesz bez postoju o ${fmtClock(next.start, planNow)}.`
        : `${eventLabel(next)} ${fmtDuration((next.end - next.start) / 60_000)} o ${fmtClock(next.start, planNow)} (za ${fmtDuration((next.start - planNow) / 60_000)}, ok. ${fmtKm(next.fromKm)}).`;
  } else {
    title = `Najpierw: ${eventLabel(first).toLowerCase()} ${fmtDuration((first.end - first.start) / 60_000)}`;
    text = `${first.reason}. Ruszysz ${fmtClock(first.end, planNow)}.`;
  }
  return (
    <section className="card next">
      <div className="eyebrow">{chosen ? "Następna czynność · Twój wybór" : "Następna czynność"}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      {chosen && deadline !== undefined && best.plan.arrival > deadline && (
        <p className="late-note">Spóźnienie na rozładunek {fmtDuration((best.plan.arrival - deadline) / 60_000)}.</p>
      )}
      {parking && (
        <p className="parking">
          <span className="p-badge">P</span>
          <span>
            Zacznij szukać parkingu od <strong>{fmtClock(parking.searchFrom, planNow)}</strong> (ok. {fmtKm(parking.searchFromKm)}) — {eventLabel(parking.stop).toLowerCase()} o {fmtClock(parking.stop.start, planNow)}.
          </span>
        </p>
      )}
      {chosen && <button className="text-btn" onClick={onReset}>Wróć do zalecenia RoadPilot</button>}
    </section>
  );
}

function DeadlineCard({ d, parking, planNow, onOptions, goTo }: { d: DeadlinePlan; parking?: ReturnType<typeof parkingHint>; planNow: number; onOptions: (o: PlanOptions) => void; goTo: (t: "route" | "driver") => void }) {
  const [open, setOpen] = useState(false);
  const p = d.plan;
  if (!d.onTime || !p) {
    return (
      <section className="card next deadline late">
        <div className="eyebrow">Plan pod rozładunek</div>
        <h2>Nie zdążysz na {fmtClock(d.deadline, planNow)}</h2>
        <p>
          {d.earliest !== undefined
            ? <>Najwcześniej możesz być o <strong>{fmtClock(d.earliest, planNow)}</strong> — {fmtDuration(d.lateByMin!)} po awizacji. Warto od razu zadzwonić i przełożyć rozładunek.</>
            : "Brak wykonalnego planu — sprawdź dane trasy i tachografu."}
        </p>
        {d.fixes.map((f) => (
          <div className="hint" key={f.label}>
            <span><strong>Zdążysz,</strong> jeśli użyjesz: {f.label} — przyjazd {fmtClock(f.arrival, planNow)}.</span>
            <button className="ghost" onClick={() => onOptions(f.options)}>Uwzględnij</button>
          </div>
        ))}
        <button className="text-btn" onClick={() => goTo("route")}>Zmień godzinę rozładunku</button>
      </section>
    );
  }
  const first = p.events[0];
  let title: string;
  let text: string;
  if (d.kind === "rest") {
    title = `Odpoczywaj do ${fmtClock(p.departure, planNow)}`;
    text = `Masz czas na ${fmtDuration(d.restMinutes!)} odpoczynku${d.restMinutes! < 660 ? " (skrócony — zużywa 1 z 3)" : ""}. Ruszaj najpóźniej o ${fmtClock(p.departure, planNow)}, będziesz na miejscu ${fmtClock(p.arrival, planNow)}.`;
  } else if (p.departure > planNow + 60_000 && first.kind === "drive") {
    title = `Ruszaj najpóźniej o ${fmtClock(p.departure, planNow)}`;
    text = `Na odpoczynek przed wyjazdem jest za mało czasu (min. 9 h). Będziesz na miejscu ${fmtClock(p.arrival, planNow)}.`;
  } else {
    title = "Jedź teraz";
    text = `Będziesz na miejscu ${fmtClock(p.arrival, planNow)}.`;
  }
  const stops = p.events.filter((e) => e.kind === "break" || e.kind === "rest" || e.kind === "weeklyRest");
  const onRoute = d.kind === "rest" ? stops.slice(1) : stops;
  return (
    <section className="card next deadline">
      <div className="eyebrow">Plan pod rozładunek · zdążysz</div>
      <h2>{title}</h2>
      <p>{text}</p>
      <p className="muted">
        {onRoute.length ? `Po drodze: ${onRoute.map((e) => `${eventLabel(e).toLowerCase()} ${fmtDuration((e.end - e.start) / 60_000)} o ${fmtClock(e.start, planNow)}`).join(", ")}.` : "Po drodze bez postojów."}
        {d.earliest !== undefined && d.earliest < p.arrival - 30 * 60_000 && ` Gdybyś jechał od razu, byłbyś najwcześniej o ${fmtClock(d.earliest, planNow)}.`}
      </p>
      {parking && (
        <p className="parking">
          <span className="p-badge">P</span>
          <span>
            Zacznij szukać parkingu od <strong>{fmtClock(parking.searchFrom, planNow)}</strong> (ok. {fmtKm(parking.searchFromKm)}) — {eventLabel(parking.stop).toLowerCase()} o {fmtClock(parking.stop.start, planNow)}.
          </span>
        </p>
      )}
      <button className="text-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Ukryj plan" : "Pokaż cały plan"}</button>
      {open && <div className="details"><Timeline events={p.events} reference={planNow} /></div>}
    </section>
  );
}

function ScenarioCard({ s, best, planNow, deadline, chosen, onChoose }: { s: Scenario; best?: Scenario; planNow: number; deadline?: number; chosen: boolean; onChoose: () => void }) {
  const [open, setOpen] = useState(false);
  const p = s.plan;
  const isBest = best?.id === s.id;
  const lead = s.id === "now" ? "Jeżeli ruszysz teraz" : `Jeżeli odpoczniesz ${s.id === "rest9" ? "9" : "11"} godzin`;
  const diff = best && !isBest && p.feasible ? (p.arrival - best.plan.arrival) / 60_000 : 0;
  return (
    <article className={`scenario ${isBest ? "recommended" : ""} ${chosen ? "chosen" : ""} ${p.feasible ? "" : "unavailable"}`}>
      <div className="scenario-top">
        <div>
          <div className="scenario-name">{s.label}</div>
          <div className="muted">{p.feasible ? `start ${fmtClock(p.departure, planNow)} · łącznie ${fmtDuration((p.arrival - planNow) / 60_000)}` : "niedostępny"}</div>
        </div>
        <div className="scenario-eta">
          <strong>{p.feasible ? fmtClock(p.arrival, planNow) : "—"}</strong>
          <span>przyjazd</span>
        </div>
      </div>
      {p.feasible ? (
        <p className="scenario-say">
          {lead}, przewidywany przyjazd: <strong>{fmtClock(p.arrival, planNow)}</strong>.
          {isBest && <span className="badge">Najwcześniej</span>}
          {chosen && <span className="badge chosen">Twój wybór</span>}
          {diff >= 1 && <span className="later"> O {fmtDuration(diff)} później niż „{best!.label}”.</span>}
          {deadline !== undefined && (p.arrival <= deadline
            ? <span className="slot ok">zdążysz · {fmtDuration((deadline - p.arrival) / 60_000)} przed</span>
            : <span className="slot late">spóźnienie {fmtDuration((p.arrival - deadline) / 60_000)}</span>)}
        </p>
      ) : (
        <p className="scenario-say">{p.problem}</p>
      )}
      {p.feasible && (
        <div className="scenario-actions">
          <button className="text-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Ukryj szczegóły" : "Pokaż szczegóły"}
          </button>
          <button className={chosen ? "ghost pick" : "primary pick"} onClick={onChoose}>{chosen ? "Anuluj wybór" : "Wybieram"}</button>
        </div>
      )}
      {open && (
        <div className="details">
          <ul className="reasons">
            {explain(s).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <Timeline events={p.events} reference={planNow} />
        </div>
      )}
    </article>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? "warn" : ""}`}>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}
