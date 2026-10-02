import { useEffect, useState } from "react";
import { api, ApiError, User } from "../api";

// Licencja RoadPilot (Premium): kierowca wpisuje klucz (menu ⋯ → Licencja, Ustawienia → Licencja), administrator tworzy klucze
// (Administracja → Licencje): własny tekst albo losowy, dla jednego konta / dla N osób / dla wszystkich, na okres albo bez terminu.

/** Nowy klucz można wpisać dopiero tyle dni przed końcem licencji (jak server/premium.mjs). */
const RENEW_BEFORE_DAYS = 5;

/** „bez terminu” (rok 9999) albo „do 30.10.2026”. */
export function premiumText(until: number | null | undefined) {
  if (until === null || until === undefined || new Date(until).getFullYear() >= 9999) return "bez terminu";
  return `do ${new Date(until).toLocaleDateString("pl-PL")}`;
}

/** Krótki stan licencji do podpisu w menu: „Aktywna do 30.10.2026”, „Brak”. */
export function licenseStatus(user: User | null | undefined): string {
  if (!user) return "Wymaga konta";
  if (user.admin) return "Administrator";
  return user.premium ? `Aktywna ${premiumText(user.premiumUntil)}` : "Brak — wpisz klucz";
}

/** Kierowca: stan licencji i wpisanie klucza. */
export function LicensePanel({ token, user, onUser }: { token: string | null; user: User | null; onUser: (u: User) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const redeem = async () => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ user: User; days: number | null }>("POST", "/premium/redeem", { key }, token);
      onUser(r.user);
      setKey("");
      setMsg({ ok: true, text: `Licencja aktywna ${premiumText(r.user.premiumUntil)}${r.days !== null ? ` (+${r.days} dni)` : ""}. Dziękujemy!` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Nie udało się — sprawdź połączenie." });
    } finally {
      setBusy(false);
    }
  };
  const active = !!user?.premium || !!user?.admin;
  // Licencje się nie kumulują: nowy klucz dopiero 5 dni przed końcem trwającej (serwer RENEW_BEFORE_DAYS).
  const until = user?.premiumUntil ?? null;
  const forever = until !== null && new Date(until).getFullYear() >= 9999;
  const renewFrom = until !== null && !forever ? until - RENEW_BEFORE_DAYS * 86_400_000 : null;
  const locked = !!user?.premium && (forever || (renewFrom !== null && Date.now() < renewFrom));
  return (
    <div className="license">
      <div className={`license-status ${active ? "on" : ""}`}>
        <svg viewBox="0 0 24 24" aria-hidden><path d={active ? "M5 12.5l4.5 4.5L19 7.5" : "M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 11h9M18 11v3M21 11v2"} /></svg>
        <div>
          <b>{!user ? "Licencja wymaga konta" : user.admin ? "Konto administratora" : active ? "Licencja RoadPilot Premium" : "Brak aktywnej licencji"}</b>
          <span>{!user ? "Zaloguj się w Ustawienia → Konto." : active ? `Ważna ${premiumText(user.premiumUntil)} · nawigacja dla ciężarówek odblokowana` : "Nawigacja dla ciężarówek wymaga licencji Premium."}</span>
        </div>
      </div>
      {user && !user.admin && token && locked && (
        <p className="muted small">{forever ? "Licencja bez terminu — nowy klucz nie jest potrzebny." : `Licencje się nie kumulują — nowy klucz wpiszesz od ${new Date(renewFrom!).toLocaleDateString("pl-PL")} (${RENEW_BEFORE_DAYS} dni przed końcem).`}</p>
      )}
      {user && !user.admin && token && !locked && (
        <>
          <label className="field">
            <span className="field-label">Klucz licencyjny</span>
            <input className="license-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="np. LATO2026 albo RP-XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && key.trim() && !busy && redeem()} />
          </label>
          <button className="primary full" disabled={!key.trim() || busy} onClick={redeem}>{busy ? "Sprawdzam…" : "Aktywuj licencję"}</button>
          <p className="muted small">Wielkość liter, spacje i myślniki nie mają znaczenia. Przy przedłużeniu dni z klucza liczą się od końca obecnej licencji.</p>
        </>
      )}
      {msg && <p className={msg.ok ? "redeem-ok" : "auth-error"}>{msg.text}</p>}
    </div>
  );
}

interface LicenseKey {
  key: string;
  code: string;
  days: number | null;
  note: string;
  forEmail: string | null;
  maxUses: number | null;
  uses: number;
  createdAt: number;
  lastUsedAt: number | null;
  usedBy: string[];
}

const PERIODS: { days: number | null; label: string }[] = [
  { days: 30, label: "Miesiąc" },
  { days: 182, label: "Pół roku" },
  { days: 365, label: "Rok" },
  { days: null, label: "Bez terminu" },
];
type Who = "one" | "user" | "many" | "all";
const WHO: { id: Who; label: string }[] = [
  { id: "one", label: "Jedna osoba" },
  { id: "user", label: "Konkretne konto" },
  { id: "many", label: "Kilka osób" },
  { id: "all", label: "Dla wszystkich" },
];

const daysText = (d: number | null) => (d === null ? "bez terminu" : d === 30 ? "miesiąc" : d === 182 ? "pół roku" : d === 365 ? "rok" : d === 1 ? "1 dzień" : `${d} dni`);
const usesText = (k: LicenseKey) => `${k.uses}${k.maxUses === null ? "" : ` / ${k.maxUses}`} ${k.maxUses === null ? "użyć (bez limitu)" : "użyć"}`;

/** Administracja → Licencje: tworzenie kluczy i lista z użyciami. */
export function LicenseAdmin({ token }: { token: string }) {
  const [keys, setKeys] = useState<LicenseKey[] | null>(null);
  const [code, setCode] = useState("");
  const [days, setDays] = useState<number | null>(30);
  const [customDays, setCustomDays] = useState("");
  const [who, setWho] = useState<Who>("one");
  const [email, setEmail] = useState("");
  const [many, setMany] = useState("10");
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<LicenseKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ keys: LicenseKey[] }>("GET", "/admin/keys", undefined, token).then((r) => setKeys(r.keys)).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const chosenDays = customDays.trim() ? Number(customDays) : days;
  const maxUses = who === "all" ? null : who === "many" ? Number(many) : 1;
  const valid = (chosenDays === null || (Number.isInteger(chosenDays) && chosenDays >= 1 && chosenDays <= 3650))
    && (maxUses === null || (Number.isInteger(maxUses) && maxUses >= 1))
    && (who !== "user" || /\S+@\S+/.test(email))
    && (!code.trim() || /^[\p{L}\d\s\-_.]{4,40}$/u.test(code.trim()));
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: LicenseKey }>("POST", "/admin/keys", { code: code.trim(), days: chosenDays, maxUses, forEmail: who === "user" ? email.trim() : "", note }, token);
      setFresh(r.key);
      setCopied(false);
      setCode("");
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się utworzyć klucza.");
    } finally {
      setBusy(false);
    }
  };
  const share = async (k: LicenseKey) => {
    const text = `Klucz licencyjny RoadPilot Premium (${daysText(k.days)}): ${k.key}\nWpisz go w aplikacji: menu ⋯ → Licencja albo Ustawienia → Licencja.`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      /* anulowane / brak schowka — klucz jest widoczny */
    }
  };
  const remove = async (k: LicenseKey) => {
    if (!confirm(`Wyłączyć klucz ${k.key}? Nikt więcej go nie użyje (nadane już licencje zostają).`)) return;
    try {
      await api("DELETE", "/admin/keys", { key: k.code }, token);
      if (fresh?.code === k.code) setFresh(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się usunąć klucza.");
    }
  };
  return (
    <>
      <section className="card lic-new">
        <div className="eyebrow">Nowa licencja</div>
        <h2>Utwórz klucz</h2>
        <label className="field wide">
          <span className="field-label">Klucz (wymyśl sam albo zostaw puste — wylosujemy)</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} placeholder="np. LATO2026, FIRMA-KOWALSKI" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </label>
        <span className="field-label">Na jak długo</span>
        <div className="key-days" role="radiogroup" aria-label="Na jak długo">
          {PERIODS.map((d) => (
            <button key={d.label} role="radio" aria-checked={!customDays.trim() && days === d.days} className={!customDays.trim() && days === d.days ? "active" : ""} onClick={() => { setDays(d.days); setCustomDays(""); }}>{d.label}</button>
          ))}
          <input className={`key-days-custom ${customDays.trim() ? "active" : ""}`} inputMode="numeric" value={customDays} onChange={(e) => setCustomDays(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="dni" aria-label="Własna liczba dni" />
        </div>
        <span className="field-label">Dla kogo</span>
        <div className="key-days" role="radiogroup" aria-label="Dla kogo">
          {WHO.map((w) => <button key={w.id} role="radio" aria-checked={who === w.id} className={who === w.id ? "active" : ""} onClick={() => setWho(w.id)}>{w.label}</button>)}
        </div>
        {who === "user" && (
          <label className="field wide">
            <span className="field-label">E-mail konta (tylko ono może użyć klucza)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kierowca@firma.pl" autoCapitalize="off" />
          </label>
        )}
        {who === "many" && (
          <label className="field">
            <span className="field-label">Ile osób może użyć</span>
            <input inputMode="numeric" value={many} onChange={(e) => setMany(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
        )}
        {who === "all" && <p className="muted small">Klucz bez limitu — może go użyć każdy (np. promocja na grupie kierowców). Każde konto tylko raz.</p>}
        <label className="field wide">
          <span className="field-label">Notatka (widzisz tylko Ty)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="np. Marek, firma X, grupa FB" />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="primary full" disabled={busy || !valid} onClick={create}>
          {busy ? "Tworzę…" : `Utwórz klucz — ${daysText(chosenDays)}, ${who === "all" ? "bez limitu osób" : who === "many" ? `${many || "?"} osób` : who === "user" ? "jedno konto" : "jedna osoba"}`}
        </button>
        {fresh && (
          <div className="key-fresh">
            <strong>{fresh.key}</strong>
            <span>{daysText(fresh.days)} · {fresh.forEmail ? `tylko ${fresh.forEmail}` : fresh.maxUses === null ? "dla wszystkich" : `${fresh.maxUses} ${fresh.maxUses === 1 ? "osoba" : "osób"}`}{fresh.note ? ` · ${fresh.note}` : ""}</span>
            <button className="ghost" onClick={() => share(fresh)}>{copied ? "Skopiowano ✓" : "Wyślij / kopiuj"}</button>
          </div>
        )}
      </section>
      <section className="card">
        <div className="eyebrow">Klucze</div>
        {!keys ? <p className="muted small">Wczytuję…</p> : !keys.length ? <p className="muted small">Brak kluczy.</p> : (
          <ul className="key-list">
            {keys.map((k) => {
              const full = k.maxUses !== null && k.uses >= k.maxUses;
              return (
                <li key={k.code} className={full ? "used" : ""}>
                  <span>
                    <b>{k.key}</b>
                    <small>
                      {daysText(k.days)} · {k.forEmail ? `tylko ${k.forEmail} · ` : ""}{usesText(k)}{k.note ? ` · ${k.note}` : ""}
                      {k.usedBy.length ? ` · ostatnio: ${k.usedBy.slice(0, 3).join(", ")}` : ""}
                    </small>
                  </span>
                  <span className="key-actions">
                    {!full && <button className="ghost" onClick={() => share(k)}>Wyślij</button>}
                    <button className="ghost danger-text" onClick={() => remove(k)}>{full ? "Usuń" : "Wyłącz"}</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
