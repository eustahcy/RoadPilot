import { CSSProperties, useEffect, useState } from "react";
import { RoutePos } from "../core/navmatch";
import { SECTION, SectionSpan, sectionLimit, SectionRun, SectionState, sectionStats, stepSection } from "../core/section";
import { NavRoute, RouteWarning } from "../nav";
import { fmtDist } from "./HudNav";
import { Icon } from "./HudView";

// Odcinkowy pomiar prędkości w nawigacji (jak w TomTom): zapowiedź przed odcinkiem, w trakcie pasek postępu
// ze średnią od wjazdu w kolorze (zielona / żółta / czerwona względem limitu ciężarówki), po wyjeździe podsumowanie.

export const sectionKey = (w: RouteWarning) => `${w.source}:${w.id}`;
const sections = (route: NavRoute | null) => route?.warnings?.filter((w) => w.kind === "section" && w.toKm !== undefined) ?? [];

/** Przejazd przez odcinek liczony z kolejnych odczytów GPS (km po trasie). */
export function useSectionRun(route: NavRoute | null, pos: RoutePos | undefined, off: boolean, t: number | undefined, truck: boolean): SectionState {
  const [s, setS] = useState<SectionState>({});
  useEffect(() => {
    if (!route || !pos || off || t === undefined) return;
    setS((prev) => {
      const list = sections(route);
      const active = prev.run && prev.run.endT === undefined ? list.find((w) => sectionKey(w) === prev.run!.id) : undefined;
      const w = active ?? list.find((x) => pos.km >= x.km && pos.km < x.toKm!);
      const span: SectionSpan | undefined = w && { id: sectionKey(w), km: w.km, toKm: w.toKm! };
      const next = stepSection(prev, span, pos.km, t);
      if (w && next.run && next.run !== prev.run && next.run.id !== prev.run?.id) next.run.limit = sectionLimit(route, { ...span!, value: w.value }, truck);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  return s;
}

/** Co pokazać: trwający odcinek, podsumowanie (SECTION.summaryMs po wyjeździe) albo zapowiedź najbliższego. */
export function sectionView(route: NavRoute | null, km: number | undefined, run: SectionRun | undefined, now: number, truck: boolean) {
  if (!route || km === undefined) return null;
  const list = sections(route);
  const limitOf = (w: RouteWarning | undefined) => (w ? sectionLimit(route, { id: sectionKey(w), km: w.km, toKm: w.toKm!, value: w.value }, truck) : undefined);
  if (run && (run.endT === undefined || now - run.endT <= SECTION.summaryMs)) {
    const w = list.find((x) => sectionKey(x) === run.id);
    // Limit zapamiętany przy wjeździe — po przeliczeniu trasy odcinka może już nie być na liście.
    return { mode: run.endT === undefined ? ("active" as const) : ("done" as const), run, limit: limitOf(w) ?? run.limit, warn: w };
  }
  const next = list.find((w) => w.km >= km - 0.01 && w.km - km <= SECTION.aheadKm);
  return next ? { mode: "ahead" as const, warn: next, inKm: Math.max(0, next.km - km), limit: limitOf(next) } : null;
}

export type SectionViewData = NonNullable<ReturnType<typeof sectionView>>;

/** Znak B-33 (jak w nawigacji); bez limitu — znak odcinkowego pomiaru. */
function LimitSign({ kmh }: { kmh?: number }) {
  return kmh !== undefined ? <span className="sc-limit" aria-label={`Ograniczenie ${kmh} km/h`}>{kmh}</span> : <SectionIcon />;
}

function SectionIcon() {
  return (
    <svg className="sc-ico" viewBox="0 0 32 32" aria-hidden>
      <rect x="1.5" y="1.5" width="29" height="29" rx="5" />
      <path d="M8 9v14M24 9v14M8 16h16" />
    </svg>
  );
}

export function SectionPanel({ v, now }: { v: SectionViewData; now: number }) {
  if (v.mode === "ahead") {
    const len = v.warn.toKm! - v.warn.km;
    return (
      <div className={`sc ahead ${v.inKm <= 0.5 ? "near" : ""}`} role="alert">
        <SectionIcon />
        <span className="sc-text">
          <b>Odcinkowy pomiar · {fmtDist(v.inKm)}</b>
          <small>pomiar prędkości na {fmtDist(len)}{v.warn.name ? ` · ${v.warn.name}` : ""}</small>
        </span>
        <LimitSign kmh={v.limit} />
      </div>
    );
  }

  const st = sectionStats(v.run, now, v.limit);
  const avg = st.avgKmh !== undefined ? Math.round(st.avgKmh) : undefined;
  if (v.mode === "done") {
    const good = st.tone !== "over";
    return (
      <div className={`sc done ${st.tone ?? ""}`} role="status">
        <span className="sc-mark" aria-hidden>{good ? "✓" : "!"}</span>
        <span className="sc-text">
          <b>Koniec odcinka · średnia {avg ?? "—"} km/h</b>
          <small>{v.limit === undefined ? "brak danych o limicie" : good ? `w limicie ${v.limit} km/h` : `ponad limit ${v.limit} km/h`}{v.run.partial ? " · od włączenia nawigacji" : ""}</small>
        </span>
      </div>
    );
  }

  return (
    <div className={`sc active ${st.tone ?? ""}`} role="status" aria-label={`Odcinkowy pomiar: średnia ${avg ?? "—"} km/h, do końca ${fmtDist(st.leftKm)}`}>
      <div className="sc-row">
        <LimitSign kmh={v.limit} />
        <span className="sc-avg">
          <small>Średnia</small>
          <b>{avg ?? "—"}<i>km/h</i></b>
        </span>
        <span className="sc-left">
          <small>do końca</small>
          <b>{fmtDist(st.leftKm)}</b>
        </span>
      </div>
      <div className="sc-bar" aria-hidden>
        <span className="sc-fill" style={{ width: `${st.progress * 100}%` }} />
        <span className="sc-me" style={{ left: `${st.progress * 100}%` }} />
      </div>
      {st.adviseKmh !== undefined && (
        <small className="sc-advice">{st.adviseKmh > 0 ? `Zwolnij — do końca jedź najwyżej ${st.adviseKmh} km/h` : "Średnia ponad limit — zwolnij do końca odcinka"}</small>
      )}
    </div>
  );
}

const LINE_DASHES = 18;

/**
 * Odcinkowy pomiar jak oś trasy w HUD (dolny pasek Nawigacji na tablecie): kwadraciki odcinka, ciężarówka w miejscu,
 * w którym jesteśmy, nad nią średnia; przejechana część w kolorze średniej (zielony / żółty / czerwony).
 * Po lewej limit (znak), po prawej meta z „do końca”.
 */
export function SectionLine({ v, now }: { v: SectionViewData; now: number }) {
  const st = v.mode === "ahead" ? undefined : sectionStats(v.run, now, v.limit);
  const done = v.mode === "ahead" ? 0 : v.mode === "done" ? 1 : st!.progress;
  const avg = st?.avgKmh !== undefined ? Math.round(st.avgKmh) : undefined;
  const tone = st?.tone ?? "";
  const len = v.mode === "ahead" ? v.warn.toKm! - v.warn.km : v.run.lengthKm;
  return (
    <div className={`hud-route sc-line ${v.mode} ${tone}`} role="status" aria-label={v.mode === "ahead" ? `Odcinkowy pomiar za ${fmtDist(v.inKm)}` : `Odcinkowy pomiar: średnia ${avg ?? "—"} km/h`}>
      <div className="hud-route-end start">
        <LimitSign kmh={v.limit} />
        <b>{v.mode === "ahead" ? "Odcinek" : "Limit"}</b>
        <small>{v.mode === "ahead" ? `za ${fmtDist(v.inKm)}` : `${fmtDist(len)} odcinka`}</small>
      </div>
      <div className="hud-track">
        <div className="hud-dashes">
          {Array.from({ length: LINE_DASHES }, (_, i) => <i key={i} className={(i + 0.5) / LINE_DASHES <= done ? "on" : ""} />)}
        </div>
        <div className="hud-truck" style={{ "--p": done } as CSSProperties}>
          <b>{v.mode === "ahead" ? "pomiar" : `${avg ?? "—"} km/h`}</b>
          <Icon name="truck" />
        </div>
        {st?.adviseKmh !== undefined && <small className="sc-line-advice">{st.adviseKmh > 0 ? `Zwolnij — do końca najwyżej ${st.adviseKmh} km/h` : "Średnia ponad limit — zwolnij"}</small>}
      </div>
      <div className="hud-route-end">
        {v.mode === "done" ? <span className="sc-mark" aria-hidden>{tone === "over" ? "!" : "✓"}</span> : <SectionIcon />}
        <b>Koniec</b>
        <small>{v.mode === "done" ? (v.limit === undefined ? "bez limitu" : tone === "over" ? "ponad limit" : "w limicie") : v.mode === "active" ? `za ${fmtDist(st!.leftKm)}` : fmtDist(len)}</small>
      </div>
    </div>
  );
}
