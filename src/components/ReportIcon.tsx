// Piktogramy zgłoszeń i ostrzeżeń (fotoradar, kontrole, znaki) — w okienku „Zgłoś” i przy głosowaniu.

const RED = "#e0342f";
const Sign = ({ children }: { children?: React.ReactNode }) => (
  <>
    <circle cx="24" cy="24" r="19" fill="#fff" stroke={RED} strokeWidth="5" />
    {children}
  </>
);
const Truck = ({ x = 0, y = 0, s = 1, fill = "#111" }: { x?: number; y?: number; s?: number; fill?: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill}>
    <rect x="0" y="0" width="16" height="10" rx="1" />
    <path d="M17 3h5l4 4v3h-9z" />
    <circle cx="4" cy="12" r="2.3" />
    <circle cx="21" cy="12" r="2.3" />
  </g>
);
const Camera = ({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="2" y="4" width="26" height="16" rx="3" fill="#f2c230" stroke="#111" strokeWidth="2" />
    <circle cx="15" cy="12" r="5" fill="#222" stroke="#111" strokeWidth="2" />
    <circle cx="15" cy="12" r="2" fill="#7fb6ff" />
    <rect x="12" y="20" width="6" height="10" fill="#555" />
  </g>
);

const ICONS: Record<string, React.ReactNode> = {
  camera: (
    <>
      <Camera x={6} y={8} s={1.1} />
      <path d="M40 10l4-3M41 16h5M40 22l4 3" stroke="#f2c230" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  red_light: (
    <>
      <rect x="15" y="4" width="18" height="40" rx="5" fill="#222" stroke="#111" strokeWidth="2" />
      <circle cx="24" cy="13" r="5" fill={RED} />
      <circle cx="24" cy="24" r="5" fill="#5a4a10" />
      <circle cx="24" cy="35" r="5" fill="#123a22" />
    </>
  ),
  section: (
    <>
      <Camera x={1} y={4} s={0.62} />
      <Camera x={28} y={4} s={0.62} />
      <path d="M6 38h36" stroke="#fff" strokeWidth="3" strokeDasharray="5 4" />
      <path d="M10 33l-5 5 5 5M38 33l5 5-5 5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  police: (
    <>
      <path d="M5 30l5-10h28l5 10v8H5z" fill="#e8eef5" stroke="#111" strokeWidth="2" />
      <path d="M13 22h22l3 7H10z" fill="#7fb6ff" />
      <rect x="5" y="31" width="38" height="4" fill="#1f5fd1" />
      <rect x="17" y="13" width="7" height="5" rx="1.5" fill="#1f5fd1" />
      <rect x="24" y="13" width="7" height="5" rx="1.5" fill={RED} />
      <circle cx="13" cy="39" r="4" fill="#111" />
      <circle cx="35" cy="39" r="4" fill="#111" />
    </>
  ),
  itd: (
    <>
      <Truck x={4} y={20} s={1.5} fill="#e8eef5" />
      <rect x="6" y="3" width="36" height="14" rx="3" fill="#1f5fd1" />
      <text x="24" y="14" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif">ITD</text>
    </>
  ),
  height: (
    <>
      <path d="M3 10h42v8H3z" fill="#9aa7b4" />
      <path d="M3 18v26M45 18v26" stroke="#9aa7b4" strokeWidth="4" />
      <path d="M24 21v19" stroke="#fff" strokeWidth="2.5" />
      <path d="M18 27l6-7 6 7M18 34l6 7 6-7" fill="none" stroke={RED} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  weight: (
    <Sign>
      <text x="24" y="31" textAnchor="middle" fontSize="20" fontWeight="900" fill="#111" fontFamily="system-ui, sans-serif">t</text>
    </Sign>
  ),
  speed: (
    <Sign>
      <text x="24" y="30" textAnchor="middle" fontSize="16" fontWeight="900" fill="#111" fontFamily="system-ui, sans-serif">50</text>
    </Sign>
  ),
  truck_ban: (
    <Sign>
      <Truck x={11} y={17} s={1} />
    </Sign>
  ),
  // Roboty drogowe: pomarańczowy trójkąt ostrzegawczy z robotnikiem przy łopacie (znak A-14).
  roadworks: (
    <>
      <path d="M24 4 45 42H3z" fill="#fff" stroke={RED} strokeWidth="4" strokeLinejoin="round" />
      <path d="M24 9 40.5 39h-33z" fill="#f2a230" />
      <circle cx="21" cy="19" r="2.6" fill="#111" />
      <path d="M21 22.5l-2.5 7 3 1 1 6M18.5 29.5l-3 7M21 24l5 2M26 26l3.5 8.5M27 34h6" stroke="#111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M30 32l5-1 1 4.5h-7z" fill="#111" />
    </>
  ),
  closed: (
    <>
      <rect x="4" y="16" width="40" height="11" rx="2" fill="#fff" stroke="#111" strokeWidth="1.5" />
      <path d="M10 16l-6 11M20 16l-6 11M30 16l-6 11M40 16l-6 11" stroke={RED} strokeWidth="5" />
      <path d="M10 27v15M38 27v15" stroke="#9aa7b4" strokeWidth="4" />
    </>
  ),
  parking: (
    <>
      <rect x="6" y="6" width="36" height="36" rx="5" fill="#1f5fd1" stroke="#fff" strokeWidth="2" />
      <text x="24" y="35" textAnchor="middle" fontSize="26" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif">P</text>
    </>
  ),
  // MOP: niebieska tablica z P i znakiem stacji / baru (jak znak MOP), stacja: pomarańczowy dystrybutor.
  mop: (
    <>
      <rect x="6" y="6" width="36" height="36" rx="5" fill="#1f5fd1" stroke="#fff" strokeWidth="2" />
      <text x="20" y="31" textAnchor="middle" fontSize="20" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif">P</text>
      <path d="M30 18h6v14h-6zM36 22h2.5v7.5a1.5 1.5 0 0 0 3 0V20l-2-2" fill="#fff" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
      <text x="24" y="40" textAnchor="middle" fontSize="7.5" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif">MOP</text>
    </>
  ),
  fuel: (
    <>
      <rect x="6" y="6" width="36" height="36" rx="5" fill="#e07a1f" stroke="#fff" strokeWidth="2" />
      <path d="M14 36V13h13v23zM17 16v7h7v-7zM27 21h3.5l2.5 2.5v9a2 2 0 0 0 4 0V18l-3.5-3.5" fill="#fff" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
  // Wjazd dla ciężarówek: szlaban w pasy i ciężarówka.
  gate: (
    <>
      <rect x="6" y="6" width="36" height="36" rx="5" fill="#2a8a4a" stroke="#fff" strokeWidth="2" />
      <path d="M11 16V36" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <rect x="10" y="13" width="28" height="6" rx="1.5" fill="#fff" />
      <path d="M17 13v6M24 13v6M31 13v6" stroke="#e0342f" strokeWidth="3" />
      <rect x="18" y="24" width="12" height="8" rx="1" fill="#fff" />
      <path d="M30 26h4l3 3v3h-7z" fill="#fff" />
      <circle cx="21" cy="34" r="2" fill="#fff" /><circle cx="33" cy="34" r="2" fill="#fff" />
    </>
  ),
  other: (
    <>
      <circle cx="24" cy="24" r="19" fill="none" stroke="#cfdae2" strokeWidth="3" />
      <circle cx="15" cy="24" r="3" fill="#cfdae2" />
      <circle cx="24" cy="24" r="3" fill="#cfdae2" />
      <circle cx="33" cy="24" r="3" fill="#cfdae2" />
    </>
  ),
};

export function ReportIcon({ kind, className = "" }: { kind: string; className?: string }) {
  return (
    <svg className={`report-ico ${className}`} viewBox="0 0 48 48" aria-hidden>
      {ICONS[kind] ?? ICONS.other}
    </svg>
  );
}
