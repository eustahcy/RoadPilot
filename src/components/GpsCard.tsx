import { GPS } from "../core/gps";
import { fmtKm } from "../format";
import { GpsStatus } from "../tracking";
import { Toggle } from "./fields";

interface Props {
  on: boolean;
  status: GpsStatus;
  doneKm: number;
  leftKm: number;
  /** Średnia z ostatnich 10 min (km/h) — undefined, gdy za mało danych. */
  recentKmh?: number;
  liveEta: boolean;
  /** Czy przyjazd jest teraz faktycznie liczony z tej średniej. */
  liveUsed: boolean;
  onToggle: (on: boolean) => void;
  onLiveEta: (on: boolean) => void;
}

const STATUS_TEXT: Record<GpsStatus, string> = {
  off: "",
  waiting: "Szukam sygnału GPS…",
  ok: "",
  weak: "Słaby sygnał GPS — odczyty niedokładne są pomijane.",
  denied: "Brak zgody na lokalizację — zezwól na nią w ustawieniach przeglądarki.",
  unavailable: "GPS niedostępny — wymaga połączenia HTTPS i przeglądarki z lokalizacją.",
};

export function GpsCard({ on, status, doneKm, leftKm, recentKmh, liveEta, liveUsed, onToggle, onLiveEta }: Props) {
  if (!on) {
    return (
      <section className="card reminders">
        <div>
          <div className="eyebrow">GPS</div>
          <p className="muted">Odliczaj przejechane kilometry i aktualizuj przyjazd oraz czas jazdy w trakcie trasy.</p>
        </div>
        <button className="primary" onClick={() => onToggle(true)}>Włącz</button>
      </section>
    );
  }

  const speedText =
    recentKmh === undefined
      ? `za mało danych (min. ${GPS.minWindowMin} min odczytów)`
      : `${Math.round(recentKmh)} km/h`;

  return (
    <section className="card">
      <div className="section-head static">
        <span>
          <div className="eyebrow">GPS · śledzenie trasy</div>
          <h2>Przejechane {fmtKm(doneKm)} · zostało {fmtKm(leftKm)}</h2>
        </span>
        <button className="ghost" onClick={() => onToggle(false)}>Wyłącz</button>
      </div>
      {STATUS_TEXT[status] && <p className="warn-text small">{STATUS_TEXT[status]}</p>}
      <p className="muted">Średnia z ostatnich {GPS.windowMin} min: <strong>{speedText}</strong></p>
      <Toggle
        checked={liveEta}
        onChange={onLiveEta}
        label={`Przyjazd z prędkości z ostatnich ${GPS.windowMin} min`}
        hint={
          liveEta && !liveUsed
            ? `Teraz liczę z prędkości typów dróg — średnia jest niedostępna lub poniżej ${GPS.minLiveKmh} km/h (postój, korek).`
            : "Zamiast średnich dla typów dróg. Na postoju i w korku wraca do zwykłego wyliczenia."
        }
      />
      <p className="muted small">
        Jazda i postoje z GPS są doliczane do stanu tachografu — sprawdzaj je z tachografem. Trzymaj aplikację otwartą:
        przy wygaszonym ekranie przeglądarka nie podaje pozycji, a po powrocie RoadPilot dolicza dystans w linii prostej × {GPS.gapRoadFactor}.
      </p>
    </section>
  );
}
