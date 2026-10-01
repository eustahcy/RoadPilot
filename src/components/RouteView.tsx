import { PROFILES, ProfileId, ROAD_LABELS, ROAD_TYPES, RoadType, Route, Segment, segmentsFromProfile } from "../core/route";
import { fmtDuration, fmtKm, fromLocalInput, toLocalInput } from "../format";
import { floorMinute, Trip } from "../state";
import { NumberField, Toggle } from "./fields";
import { NavCard, NavProps } from "./NavCard";
import { TRAFFIC_ON } from "../nav";

interface Props {
  trip: Trip;
  route: Route;
  onChange: (trip: Trip) => void;
  nav: NavProps;
}

export function RouteView({ trip, route, onChange, nav }: Props) {
  const set = (patch: Partial<Trip>) => onChange({ ...trip, ...patch });

  const chooseProfile = (profile: ProfileId) => {
    if (profile === "custom") {
      const segments = trip.profile === "custom" && trip.segments.length ? trip.segments : segmentsFromProfile(trip.distance, trip.profile === "custom" ? "mixed" : trip.profile);
      set({ profile, segments: segments.map((s) => ({ ...s, km: Math.round(s.km) })) });
    } else {
      set({ profile });
    }
  };

  const setSegments = (segments: Segment[]) => {
    const distance = Math.round(segments.reduce((a, s) => a + (s.km || 0), 0) * 10) / 10;
    set({ segments, distance, doneKm: 0 });
  };

  // Trasa z nawigacji RoadPilot: kilometry i rodzaje dróg są z niej (tripFromRoute) — nic nie wpisujemy ręcznie.
  const navRoute = nav.access === "premium" ? nav.route : null;

  const manual = (
    <>
      <section className="card form">
        <label className="field wide">
          <span className="field-label">Start</span>
          <input type="text" value={trip.origin} placeholder="np. Łódź" onChange={(e) => set({ origin: e.target.value })} />
        </label>
        <label className="field wide">
          <span className="field-label">Cel podróży</span>
          <input type="text" value={trip.destination} placeholder="np. Poznań, magazyn DC2" onChange={(e) => set({ destination: e.target.value })} />
        </label>
        {trip.profile !== "custom" ? (
          <NumberField label="Dystans do celu" value={trip.distance} unit="km" min={0} max={10000} onChange={(distance) => set({ distance, doneKm: 0 })} wide />
        ) : (
          <div className="field wide">
            <span className="field-label">Dystans do celu</span>
            <strong className="big-number">{Math.round(trip.segments.reduce((a, s) => a + s.km, 0))} km</strong>
            <span className="field-hint">suma odcinków poniżej</span>
          </div>
        )}
        {trip.doneKm > 0 && (
          <p className="field-hint wide">
            GPS: przejechane {fmtKm(trip.doneKm)}, zostało <strong>{fmtKm(route.totalKm)}</strong>. Zmiana dystansu lub odcinków zeruje licznik.{" "}
            <button className="text-btn" onClick={() => set({ doneKm: 0 })}>Wyzeruj</button>
          </p>
        )}
      </section>

      <section className="card">
        <div className="eyebrow">Charakter trasy</div>
        <h2>Jakimi drogami jedziesz?</h2>
        <p className="muted small">Tylko do obliczeń przerw i przyjazdu — nie zmienia trasy nawigacji.</p>
        <div className="profiles">
          {(Object.keys(PROFILES) as Exclude<ProfileId, "custom">[]).map((id) => (
            <button key={id} className={`profile ${trip.profile === id ? "active" : ""}`} onClick={() => chooseProfile(id)}>
              <strong>{PROFILES[id].label}</strong>
              <span>{PROFILES[id].hint}</span>
            </button>
          ))}
          <button className={`profile ${trip.profile === "custom" ? "active" : ""}`} onClick={() => chooseProfile("custom")}>
            <strong>Własne odcinki</strong>
            <span>wpisz kilometry dla każdego typu drogi</span>
          </button>
        </div>

        {trip.profile === "custom" && (
          <div className="segments">
            {trip.segments.map((s, i) => (
              <div className="segment-row" key={i}>
                <select value={s.type} onChange={(e) => setSegments(trip.segments.map((x, j) => (j === i ? { ...x, type: e.target.value as RoadType } : x)))}>
                  {ROAD_TYPES.map((t) => <option key={t} value={t}>{ROAD_LABELS[t]}</option>)}
                </select>
                <span className="input-row">
                  <input type="number" inputMode="decimal" min={0} value={s.km} onChange={(e) => setSegments(trip.segments.map((x, j) => (j === i ? { ...x, km: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                  <span className="unit">km</span>
                </span>
                <button className="icon-btn" aria-label="Usuń odcinek" onClick={() => setSegments(trip.segments.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button className="ghost" onClick={() => setSegments([...trip.segments, { type: "rural", km: 50 }])}>+ Dodaj odcinek</button>
          </div>
        )}

        <SegmentBar route={route} />
      </section>
    </>
  );

  // Na szerokim ekranie dwie kolumny: nawigacja i odcinki | rozładunek i zapas — mniej przewijania.
  return (
    <div className="route-grid">
      <div className="route-main">
      <NavCard {...nav} />
      {navRoute ? (
        <section className="card">
          <div className="eyebrow">Obliczenia trasy · z nawigacji</div>
          <h2>{navRoute.to.label}</h2>
          <div className="nav-trip">
            <span><small>Do celu</small><b>{fmtKm(route.totalKm)}</b></span>
            <span><small>Cała trasa</small><b>{fmtKm(navRoute.lengthKm)}</b></span>
            {TRAFFIC_ON && <span><small>Korki teraz</small><b className={navRoute.trafficMin >= 1 ? "warn-text" : ""}>{navRoute.trafficMin >= 1 ? `+${fmtDuration(navRoute.trafficMin)}` : navRoute.engine === "roadpilot" && !navRoute.trafficAt ? "—" : "brak"}</b></span>}
          </div>
          {trip.doneKm > 0 && (
            <p className="field-hint">
              GPS: przejechane {fmtKm(trip.doneKm)}. <button className="text-btn" onClick={() => set({ doneKm: 0 })}>Wyzeruj</button>
            </p>
          )}
          <SegmentBar route={route} />
          <p className="muted small">
            Kilometry i rodzaje dróg (autostrada, ekspresowa, poza miastem, miasto) są z wyznaczonej trasy — zmienią się same
            po nowej trasie lub wyborze alternatywy. Czas jazdy liczymy z Twoich prędkości (Ustawienia), żeby przerwy wypadały realnie.
          </p>
        </section>
      ) : (
        <>
          {nav.access === "premium" && <p className="muted small route-hint">Wyznacz trasę powyżej — kilometry i rodzaje dróg uzupełnią się same. Bez nawigacji możesz je wpisać ręcznie:</p>}
          {manual}
        </>
      )}
      </div>

      <div className="route-side">
      <UnloadSection trip={trip} set={set} />

      <section className="card form">
        <NumberField label="Zapas na ruch, roboty, granice" value={trip.trafficPct} unit="%" min={0} max={100} onChange={(trafficPct) => set({ trafficPct })} wide />
        <p className="field-hint wide">
          Wydłuża czas każdego odcinka. Prędkości dla typów dróg zmienisz w Ustawieniach.
        </p>
      </section>
      </div>
    </div>
  );
}

function UnloadSection({ trip, set }: { trip: Trip; set: (p: Partial<Trip>) => void }) {
  const on = trip.unloadAt !== null;
  const defaultSlot = () => {
    // domyślnie jutro 08:00
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return floorMinute(d.getTime());
  };
  return (
    <section className="card">
      <div className="eyebrow">Rozładunek</div>
      <h2>Na którą masz być?</h2>
      <Toggle
        checked={on}
        onChange={(v) => set({ unloadAt: v ? defaultSlot() : null })}
        label="Mam godzinę rozładunku (awizację)"
        hint="RoadPilot dobierze odpoczynek i godzinę wyjazdu tak, żebyś zdążył."
      />
      {on && (
        <div className="form">
          <label className="field wide">
            <span className="field-label">Godzina rozładunku</span>
            <input type="datetime-local" value={toLocalInput(trip.unloadAt!)} onChange={(e) => { const t = fromLocalInput(e.target.value); if (t) set({ unloadAt: t }); }} />
          </label>
          <NumberField label="Chcę być wcześniej o" value={trip.unloadBufferMin} unit="min" min={0} max={600} onChange={(unloadBufferMin) => set({ unloadBufferMin })} wide />
        </div>
      )}
    </section>
  );
}

const COLORS: Record<RoadType, string> = {
  motorway: "#42d392",
  expressway: "#4ea1ff",
  rural: "#e8b44c",
  urban: "#ef6a5b",
  mixed: "#a98bff",
};

function SegmentBar({ route }: { route: Route }) {
  if (route.totalKm <= 0) return null;
  const totals = ROAD_TYPES.map((t) => {
    const km = route.segments.filter((s) => s.type === t).reduce((a, s) => a + s.km, 0);
    return { t, km };
  }).filter((x) => x.km > 0);
  return (
    <div className="segbar-wrap">
      <div className="segbar">
        {route.segments.map((s, i) => (
          <span key={i} style={{ flexGrow: s.km, background: COLORS[s.type] }} title={`${ROAD_LABELS[s.type]}: ${s.km} km`} />
        ))}
      </div>
      <ul className="legend">
        {totals.map(({ t, km }) => (
          <li key={t}><i style={{ background: COLORS[t] }} />{ROAD_LABELS[t]} <span>{Math.round(km)} km</span></li>
        ))}
      </ul>
      <p className="muted">Czas samej jazdy: <strong>{fmtDuration(route.driveMinutes(0))}</strong> (średnio {Math.round(route.totalKm / (route.driveMinutes(0) / 60))} km/h)</p>
    </div>
  );
}
