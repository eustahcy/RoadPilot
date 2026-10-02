import { ReactNode } from "react";

// Menu Nawigacji (przycisk ⋯) wzorowane na TomTom GO: pełny ekran nad przyciemnioną mapą, duże dwukolorowe ikony
// (białe + akcent RoadPilot) — poziomo rząd z podpisem nad ikoną (przewijany), pionowo lista z ikoną po lewej.
// Na dole przełącznik głosu, w lewym górnym rogu powrót do mapy.

export type MenuIcon = "search" | "home" | "recent" | "route" | "places" | "break" | "dayEnd" | "dayStart" | "report" | "gap" | "settings" | "fullscreen" | "endNav" | "exit";

export interface MenuItem {
  id: string;
  icon: MenuIcon;
  label: string;
  onClick: () => void;
  /** Kropka „trwa / do zrobienia” (np. trwający postój, niewyjaśniona luka). */
  dot?: boolean;
  tone?: "danger";
}

export function NavMenu({ items, title, voice, onClose }: { items: MenuItem[]; title?: string; voice: { supported: boolean; on: boolean; toggle: () => void }; onClose: () => void }) {
  return (
    <div className="nmm" role="dialog" aria-label="Menu nawigacji">
      <button className="nmm-back" onClick={onClose} aria-label="Wróć do mapy">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M16 4 6 12l10 8-3-8z" /></svg>
      </button>
      {title && <div className="nmm-title">{title}</div>}
      <div className="nmm-items">
        {items.map((it) => (
          <button key={it.id} className={`nmm-item ${it.tone ?? ""}`} onClick={it.onClick}>
            <span className="nmm-label">{it.label}</span>
            <span className="nmm-ico">{ICONS[it.icon]}{it.dot && <i className="nmm-dot" />}</span>
          </button>
        ))}
      </div>
      {voice.supported && (
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
  exit: (
    <svg viewBox="0 0 64 64"><path d="M34 6h20v52H34" className="w" fill="none" strokeWidth="6" strokeLinejoin="round" /><path d="M40 32H8" className="a" strokeWidth="6" strokeLinecap="round" /><path d="M20 18 6 32l14 14" className="a" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
};
