import { ReactNode } from "react";

// Menu Nawigacji (przycisk ⋯) wzorowane na TomTom GO: pełny ekran nad przyciemnioną mapą, duże dwukolorowe ikony
// (białe + akcent RoadPilot) — poziomo rząd z podpisem nad ikoną (przewijany), pionowo lista z ikoną po lewej.
// Na dole przełącznik głosu, w lewym górnym rogu powrót (do mapy albo strony wyżej), w prawym — „namierz” (wróć do mapy na pozycję).
// Podstrony (Aktualna trasa, Ustawienia → Wygląd…) mają duży tytuł obok przycisku powrotu, jak w TomTom GO.

export type MenuIcon = "search" | "home" | "recent" | "route" | "places" | "break" | "dayEnd" | "dayStart" | "report" | "gap" | "settings" | "fullscreen" | "endNav" | "exit"
  | "skipStop" | "altRoute" | "roadblock" | "avoidTolls" | "favRoute" | "directions" | "look" | "voice" | "planning" | "sounds" | "vehicle" | "ahead";

export interface MenuItem {
  id: string;
  icon: MenuIcon;
  label: string;
  onClick: () => void;
  /** Kropka „trwa / do zrobienia” (np. trwający postój, niewyjaśniona luka). */
  dot?: boolean;
  tone?: "danger";
  /** Niedostępne teraz (np. „Pomiń następny postój” bez punktów pośrednich) — wyszarzone, jak w TomTom. */
  disabled?: boolean;
  /** Drugi wiersz pod podpisem (np. „włączone”). */
  sub?: string;
}

export interface MenuPage {
  /** Duży tytuł strony (bez tytułu = strona główna menu, z trasą małymi literami u góry). */
  heading?: string;
  /** Mały opis u góry strony głównej (trasa → cel). */
  title?: string;
  items?: MenuItem[];
  /** Zawartość podstrony zamiast listy (ustawienia). */
  content?: ReactNode;
}

export function NavMenu({ page, voice, onBack, onRecenter }: { page: MenuPage; voice: { supported: boolean; on: boolean; toggle: () => void }; onBack: () => void; onRecenter: () => void }) {
  return (
    <div className={`nmm ${page.heading ? "sub" : ""}`} role="dialog" aria-label={page.heading ?? "Menu nawigacji"}>
      <div className="nmm-head">
        <button className="nmm-back" onClick={onBack} aria-label={page.heading ? "Wstecz" : "Wróć do mapy"}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M16 4 6 12l10 8-3-8z" /></svg>
        </button>
        {page.heading ? <h2 className="nmm-heading">{page.heading}</h2> : page.title ? <div className="nmm-title">{page.title}</div> : <span />}
        <button className="nmm-back nmm-locate" onClick={onRecenter} aria-label="Wróć do mapy na moją pozycję">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M3 11l18-8-8 18-2-8z" /></svg>
        </button>
      </div>
      {page.content ? (
        <div className="nmm-content">{page.content}</div>
      ) : (
        <div className="nmm-items">
          {page.items?.map((it) => (
            <button key={it.id} className={`nmm-item ${it.tone ?? ""} ${it.disabled ? "disabled" : ""}`} onClick={it.disabled ? undefined : it.onClick} aria-disabled={it.disabled}>
              <span className="nmm-label">{it.label}{it.sub && <small>{it.sub}</small>}</span>
              <span className="nmm-ico">{ICONS[it.icon]}{it.dot && <i className="nmm-dot" />}</span>
            </button>
          ))}
        </div>
      )}
      {voice.supported && !page.content && (
        <div className="nmm-voice" role="radiogroup" aria-label="Komunikaty głosowe">
          <button role="radio" aria-checked={!voice.on} className={!voice.on ? "on" : ""} onClick={() => voice.on && voice.toggle()} aria-label="Wycisz">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M4 9h4l5-4v14l-5-4H4z" className="f" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" /></svg>
          </button>
          <button role="radio" aria-checked={voice.on} className={voice.on ? "on" : ""} onClick={() => !voice.on && voice.toggle()} aria-label="Komunikaty głosowe włączone">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M4 9h4l5-4v14l-5-4H4z" className="f" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

/** Odznaka w prawym dolnym rogu ikony (jak w TomTom): ciemne kółko z białą obwódką i znakiem w kolorze akcentu. */
const Badge = ({ children }: { children: ReactNode }) => (
  <g>
    <circle cx="47" cy="47" r="14" className="bg" />
    <circle cx="47" cy="47" r="14" className="w" fill="none" strokeWidth="4" />
    {children}
  </g>
);

const ICONS: Record<MenuIcon, ReactNode> = {
  search: (
    <svg viewBox="0 0 64 64"><circle cx="27" cy="27" r="19" className="w" fill="none" strokeWidth="7" /><path d="M41 41l13 13" className="w" strokeWidth="8" strokeLinecap="round" /><path d="M27 37s-8-6.5-8-12a8 8 0 0 1 16 0c0 5.5-8 12-8 12z" className="a" fill="none" strokeWidth="4" strokeLinejoin="round" /></svg>
  ),
  home: (
    <svg viewBox="0 0 64 64"><path d="M30 4 2 30h9v26h38V30h9z" className="wf" />
      <Badge><circle cx="47" cy="47" r="7.5" className="a" fill="none" strokeWidth="3" /><path d="M39.5 46h15M47 47v7.5" className="a" strokeWidth="3" /></Badge></svg>
  ),
  recent: (
    <svg viewBox="0 0 64 64"><path d="M8 6v46M40 6v28" className="a" strokeWidth="6" strokeLinecap="round" /><path d="M13 8h8v7h-8zM29 8h8v7h-8zM21 15h8v7h-8zM13 22h8v7h-8zM29 22h8v6h-8z" className="wf" />
      <Badge><path d="M47 39v8l5 3" className="a" strokeWidth="3.5" strokeLinecap="round" fill="none" /></Badge></svg>
  ),
  route: (
    <svg viewBox="0 0 64 64"><path d="M38 58V30c0-6-4-10-10-14" className="a" fill="none" strokeWidth="8" strokeLinecap="round" /><path d="M38 4 26 20h24z" className="af" /><path d="M24 32H8" className="w" strokeWidth="6" strokeLinecap="round" /><path d="M4 32l10-8v16z" className="wf" /><path d="M42 44l10 12" className="w" strokeWidth="5" strokeLinecap="round" /></svg>
  ),
  places: (
    <svg viewBox="0 0 64 64"><path d="M26 56S6 38 6 24a20 20 0 0 1 40 0" className="w" fill="none" strokeWidth="7" strokeLinecap="round" />
      <Badge><circle cx="47" cy="43" r="4.5" className="af" /><path d="M38.5 55a8.5 8.5 0 0 1 17 0" className="af" /></Badge></svg>
  ),
  break: (
    <svg viewBox="0 0 64 64"><path d="M8 26h36v12a14 14 0 0 1-14 14h-8A14 14 0 0 1 8 38z" className="wf" /><path d="M44 30h4a7 7 0 0 1 0 14h-5" className="w" fill="none" strokeWidth="5" /><path d="M18 6c-3 4 3 7 0 12M28 6c-3 4 3 7 0 12" className="a" fill="none" strokeWidth="4" strokeLinecap="round" /><path d="M6 58h44" className="a" strokeWidth="4" strokeLinecap="round" /></svg>
  ),
  dayEnd: (
    <svg viewBox="0 0 64 64"><path d="M50 40A22 22 0 1 1 24 10a18 18 0 0 0 26 30z" className="wf" /><path d="M46 8l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM54 26l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" className="af" /></svg>
  ),
  dayStart: (
    <svg viewBox="0 0 64 64"><circle cx="32" cy="34" r="12" className="af" /><path d="M32 8v8M32 52v6M8 34h6M50 34h6M15 17l5 5M44 46l5 5M49 17l-5 5M20 46l-5 5" className="w" strokeWidth="5" strokeLinecap="round" /></svg>
  ),
  report: (
    <svg viewBox="0 0 64 64"><path d="M12 58V6" className="w" strokeWidth="6" strokeLinecap="round" /><path d="M15 8h34l-8 12 8 12H15z" className="wf" /><path d="M32 13v8M32 26v.5" className="a" strokeWidth="5" strokeLinecap="round" /></svg>
  ),
  gap: (
    <svg viewBox="0 0 64 64"><circle cx="28" cy="30" r="22" className="w" fill="none" strokeWidth="6" /><path d="M28 16v14l9 6" className="w" fill="none" strokeWidth="5" strokeLinecap="round" />
      <Badge><path d="M43 43a4.5 4.5 0 1 1 6 4c-2 1-2 2-2 3.5M47 54.5v.5" className="a" fill="none" strokeWidth="3.2" strokeLinecap="round" /></Badge></svg>
  ),
  settings: (
    <svg viewBox="0 0 64 64"><path d="M27 4h10l2 7 6 3 7-3 5 8-5 6v6l5 6-5 8-7-3-6 3-2 7H27l-2-7-6-3-7 3-5-8 5-6v-6l-5-6 5-8 7 3 6-3z" className="w" fill="none" strokeWidth="5" strokeLinejoin="round" /><circle cx="32" cy="31" r="8" className="af" /></svg>
  ),
  fullscreen: (
    <svg viewBox="0 0 64 64"><path d="M6 22V6h16M42 6h16v16M58 42v16H42M22 58H6V42" className="w" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /><path d="M22 22l20 20M42 22 22 42" className="a" strokeWidth="5" strokeLinecap="round" /></svg>
  ),
  endNav: (
    <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="25" className="r" fill="none" strokeWidth="6" /><path d="M22 22l20 20M42 22 22 42" className="r" strokeWidth="6" strokeLinecap="round" /></svg>
  ),
  skipStop: (
    <svg viewBox="0 0 64 64"><path d="M20 50V8" className="w" strokeWidth="6" strokeLinecap="round" /><path d="M23 10l22 12-22 12z" className="wf" /><ellipse cx="20" cy="54" rx="11" ry="5" className="w" fill="none" strokeWidth="4" /><path d="M42 6l8 7-8 7M52 6l8 7-8 7" className="a" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  altRoute: (
    <svg viewBox="0 0 64 64"><circle cx="27" cy="27" r="20" className="w" fill="none" strokeWidth="6" /><path d="M42 42l14 14" className="w" strokeWidth="8" strokeLinecap="round" /><path d="M20 38V30c0-4-3-7-7-9" className="w" fill="none" strokeWidth="4" strokeLinecap="round" /><path d="M10 16l2 8 7-3" className="w" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><path d="M22 32c2-7 8-12 14-14" className="a" fill="none" strokeWidth="5" strokeLinecap="round" /><path d="M30 12l9 5-6 8" className="a" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  roadblock: (
    <svg viewBox="0 0 64 64"><path d="M8 8l8 2-2 8" className="a" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 10c16 4 26 10 30 18s-2 14 4 22c2 3 6 5 8 6" className="a" fill="none" strokeWidth="7" strokeLinecap="round" /><path d="M28 18h8l7 26H21z" className="wf" /><path d="M24 30h16M22 38h20" stroke="#05090d" strokeWidth="4" /><path d="M14 48h36" className="w" strokeWidth="6" strokeLinecap="round" /></svg>
  ),
  avoidTolls: (
    <svg viewBox="0 0 64 64"><path d="M8 8l9 2-2 9" className="w" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 10c12 2 22 8 22 16s-14 10-12 18 18 6 24 16" className="w" fill="none" strokeWidth="7" strokeLinecap="round" /><circle cx="27" cy="36" r="10" className="bg" /><circle cx="27" cy="36" r="10" className="a" fill="none" strokeWidth="4" /><path d="M22.5 31.5l9 9M31.5 31.5l-9 9" className="a" strokeWidth="3.5" strokeLinecap="round" /></svg>
  ),
  favRoute: (
    <svg viewBox="0 0 64 64"><path d="M10 58c8-6 12-14 12-26V12" className="a" fill="none" strokeWidth="7" strokeLinecap="round" /><path d="M22 4 12 16h20z" className="af" /><path d="M48 4l3.5 8 8.5.8-6.4 5.6 1.9 8.4L48 22.4l-7.5 4.4 1.9-8.4L36 12.8l8.5-.8z" className="af" />
      <Badge><circle cx="47" cy="43" r="4.5" className="af" /><path d="M38.5 55a8.5 8.5 0 0 1 17 0" className="af" /></Badge></svg>
  ),
  directions: (
    <svg viewBox="0 0 64 64"><path d="M10 22V10M5 15l5-6 5 6" className="a" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 30l-8 8M6 31v7h7" className="a" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 56l8-8M7 48h7v7" className="a" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M26 14h32M26 34h32M26 52h32" className="w" strokeWidth="6" strokeLinecap="round" /></svg>
  ),
  look: (
    <svg viewBox="0 0 64 64"><path d="M56 4 36 36" className="w" strokeWidth="7" strokeLinecap="round" /><path d="M36 34c-6-2-12 2-12 8 0 5-4 8-8 8 12 6 26 2 26-10z" className="af" /><ellipse cx="14" cy="38" rx="8" ry="4" className="af" /><ellipse cx="18" cy="28" rx="4" ry="2.5" className="wf" /><ellipse cx="22" cy="56" rx="12" ry="4" className="wf" /></svg>
  ),
  voice: (
    <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" className="w" fill="none" strokeWidth="6" /><path d="M28 14c-9 0-14 7-14 15 0 4 2 7 1 10l-3 3 4 2v4c0 3 3 4 6 4h6v6h10V40c4-3 6-8 6-12 0-8-7-14-16-14z" className="wf" transform="translate(-4 0) scale(.9)" /><path d="M42 26a6 6 0 0 1 0 10M47 21a13 13 0 0 1 0 20" className="a" fill="none" strokeWidth="4" strokeLinecap="round" /></svg>
  ),
  planning: (
    <svg viewBox="0 0 64 64"><path d="M50 52 12 14" className="a" strokeWidth="7" strokeLinecap="round" /><path d="M8 26V8h18" className="a" fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /><path d="M46 8a10 10 0 0 0-10 13L12 45a5 5 0 1 0 7 7l24-24A10 10 0 0 0 56 18l-6 6-6-2-2-6z" className="w" fill="none" strokeWidth="5" strokeLinejoin="round" /></svg>
  ),
  sounds: (
    <svg viewBox="0 0 64 64"><path d="M6 24h10l14-12v40L16 40H6z" className="wf" /><path d="M38 24a10 10 0 0 1 0 16M44 16a20 20 0 0 1 0 32M50 8a30 30 0 0 1 0 48" className="a" fill="none" strokeWidth="5" strokeLinecap="round" /></svg>
  ),
  vehicle: (
    <svg viewBox="0 0 64 64"><path d="M4 18h32v26H4zM36 26h12l8 10v8H36z" className="wf" /><circle cx="14" cy="48" r="6" className="bg" /><circle cx="14" cy="48" r="5" className="w" fill="none" strokeWidth="3" /><circle cx="46" cy="48" r="6" className="bg" /><circle cx="46" cy="48" r="5" className="w" fill="none" strokeWidth="3" />
      <path d="M50 4l2 3 4-1 1 4 4 1-1 4 3 2-3 2 1 4-4 1-1 4-4-1-2 3-2-3-4 1-1-4-4-1 1-4-3-2 3-2-1-4 4-1 1-4 4 1z" className="af" /><circle cx="50" cy="15" r="3.5" fill="#05090d" /></svg>
  ),
  ahead: (
    <svg viewBox="0 0 64 64"><rect x="6" y="6" width="40" height="40" rx="9" className="w" fill="none" strokeWidth="6" /><path d="M20 38V14h9a7 7 0 0 1 0 14h-9" className="w" fill="none" strokeWidth="6" strokeLinejoin="round" />
      <Badge><path d="M47 39v9M47 52v1" className="a" strokeWidth="4" strokeLinecap="round" /></Badge></svg>
  ),
  exit: (
    <svg viewBox="0 0 64 64"><path d="M34 6h20v52H34" className="w" fill="none" strokeWidth="6" strokeLinejoin="round" /><path d="M40 32H8" className="a" strokeWidth="6" strokeLinecap="round" /><path d="M20 18 6 32l14 14" className="a" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
};
