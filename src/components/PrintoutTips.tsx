import { useState } from "react";

interface Tip {
  id: string;
  title: string;
  when: string;
  /** Co dopisać na odwrocie wydruku — […] do uzupełnienia. */
  text: string;
  note?: string;
}

// Formułki na podstawie art. 12 rozporządzenia (WE) 561/2006 (po zmianach z 2020/1054) oraz art. 35 i 37
// rozporządzenia (UE) 165/2014. Każdy wpis kończy się danymi kierowcy i podpisem.
const SIGN = "\n[imię i nazwisko], nr karty kierowcy [...], [data], podpis";

const TIPS: Tip[] = [
  {
    id: "art12-parking",
    title: "Przekroczenie — dojazd do miejsca postoju",
    when: "Korek, wypadek, zamknięta droga albo pełne parkingi i musisz dojechać do bezpiecznego miejsca postoju.",
    text: "Art. 12 rozp. (WE) 561/2006 — przekroczenie [czasu jazdy / przerwy / odpoczynku] o [xx min] w celu dotarcia do odpowiedniego miejsca postoju. Przyczyna: [brak wolnych miejsc na MOP ..., korek na ..., wypadek na ...]." + SIGN,
    note: "Dopisz najpóźniej po dotarciu do miejsca postoju — zrób wydruk dzienny i opisz go od razu.",
  },
  {
    id: "art12-home1",
    title: "Do 1 h dłużej — dojazd do bazy / domu",
    when: "W wyjątkowych okolicznościach, żeby dojechać do bazy firmy albo domu na odpoczynek tygodniowy.",
    text: "Art. 12 akapit 2 rozp. (WE) 561/2006 — przekroczenie dziennego i tygodniowego czasu jazdy o [xx min] (maks. 1 h) w celu dotarcia do [bazy pracodawcy w ... / miejsca zamieszkania w ...] na tygodniowy okres odpoczynku. Przyczyna: [...]." + SIGN,
    note: "Wydłużenie trzeba odebrać — dołożyć do odpoczynku do końca trzeciego tygodnia.",
  },
  {
    id: "art12-home2",
    title: "Do 2 h dłużej — na regularny odpoczynek tygodniowy",
    when: "Jak wyżej, ale na regularny odpoczynek tygodniowy (45 h) — tylko po 30 min nieprzerwanej przerwy tuż przed dodatkową jazdą.",
    text: "Art. 12 akapit 3 rozp. (WE) 561/2006 — przekroczenie dziennego i tygodniowego czasu jazdy o [xx min] (maks. 2 h) po 30-minutowej przerwie w celu dotarcia do [bazy pracodawcy w ... / miejsca zamieszkania w ...] na regularny tygodniowy okres odpoczynku. Przyczyna: [...]." + SIGN,
    note: "Też do odebrania do końca trzeciego tygodnia.",
  },
  {
    id: "card-broken",
    title: "Karta uszkodzona, zgubiona lub skradziona",
    when: "Jedziesz bez karty (maks. 15 dni) — wydruk z tachografu na początku i na końcu dnia.",
    text: "Art. 35 ust. 2 rozp. (UE) 165/2014 — karta kierowcy [uszkodzona / zgubiona / skradziona / nie działa] od [data]. Wydruk na [początek / koniec] dnia. Inna praca: [godz.–godz.], dyspozycyjność: [godz.–godz.], odpoczynek: [godz.–godz.]." + SIGN,
    note: "Kartę zgłoś w ciągu 7 dni. Na wydruku z końca dnia wpisz aktywności, których tachograf nie zapisał.",
  },
  {
    id: "tacho-broken",
    title: "Awaria tachografu",
    when: "Tachograf nie rejestruje albo rejestruje błędnie.",
    text: "Art. 37 ust. 2 rozp. (UE) 165/2014 — awaria tachografu od [godz.], pojazd [nr rej.]. Czynności niezarejestrowane: jazda [godz.–godz.], inna praca [godz.–godz.], odpoczynek [godz.–godz.]." + SIGN,
    note: "Naprawa w serwisie tachografów jak najszybciej — jeśli nie wrócisz do bazy w ciągu tygodnia od awarii, to w trasie.",
  },
];

const RULES = [
  "Pisz długopisem na odwrocie wydruku — czytelnie, bez skreśleń.",
  "Zawsze: data, imię i nazwisko, nr karty kierowcy (albo prawa jazdy) i podpis.",
  "Wydruki z bieżącego dnia i poprzednich 28 dni wozisz ze sobą — pokażesz je przy kontroli.",
  "Zapomniana karta to nie awaria — tu żadna formułka nie pomoże.",
];

/** Pro tip: co dopisać na wydruku z tachografu, żeby odstępstwo było udokumentowane przy kontroli. */
export function PrintoutTips() {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (t: Tip) => {
    try {
      await navigator.clipboard.writeText(t.text);
      setCopied(t.id);
      setTimeout(() => setCopied((c) => (c === t.id ? null : c)), 2000);
    } catch {
      /* brak schowka (np. http) — tekst i tak jest widoczny do przepisania */
    }
  };

  return (
    <section className="card">
      <div className="eyebrow">Pro tip · wydruk z tachografu</div>
      <h2>Co dopisać na wydruku?</h2>
      <p className="muted small">Gotowe formułki na odwrót wydruku — uzupełnij […] i podpisz.</p>
      <ul className="tips">
        {TIPS.map((t) => (
          <li key={t.id} className={open === t.id ? "open" : ""}>
            <button className="tip-head" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
              <strong>{t.title}</strong>
              <span>{t.when}</span>
            </button>
            {open === t.id && (
              <div className="tip-body">
                <pre>{t.text}</pre>
                {t.note && <p className="muted small">{t.note}</p>}
                <button className="ghost" onClick={() => copy(t)}>{copied === t.id ? "Skopiowano ✓" : "Kopiuj tekst"}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ul className="tip-rules">
        {RULES.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <p className="muted small">
        Podpowiedź, nie porada prawna — o uznaniu odstępstwa decyduje kontrolujący. Odstępstwo z art. 12 jest tylko na
        nieprzewidziane sytuacje i nie może zagrażać bezpieczeństwu na drodze.
      </p>
    </section>
  );
}
