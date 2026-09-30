import { FormEvent, ReactNode, useState } from "react";
import { api, Auth } from "../api";

type Mode = "login" | "register" | "forgot";

/** Logowanie, rejestracja i przypomnienie hasła. Konto jest opcjonalne — „Bez konta” zostawia dane tylko w telefonie. */
export function AuthScreen({ onAuth, onGuest }: { onAuth: (a: Auth) => void; onGuest: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "register" && password !== password2) return setError("Hasła nie są takie same.");
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        // Link w e-mailu prowadzi z powrotem tutaj — na ten sam adres aplikacji.
        await api("POST", "/password/forgot", { email, appUrl: `${location.origin}${location.pathname}` });
        setSent(email);
      } else {
        const body = mode === "login" ? { email, password } : { email, password, name };
        onAuth(await api<Auth>("POST", mode === "login" ? "/login" : "/register", body));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setSent(null);
  };

  return (
    <AuthFrame>
      <div className="auth-tabs" role="tablist">
        <button role="tab" aria-selected={mode === "login"} className={mode !== "register" ? "active" : ""} onClick={() => switchTo("login")}>Logowanie</button>
        <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchTo("register")}>Rejestracja</button>
      </div>

      <form className="card auth-form" onSubmit={submit}>
        {mode === "forgot" && (
          <div>
            <h2>Nie pamiętasz hasła?</h2>
            <p className="muted small">Podaj e-mail konta — wyślemy link do ustawienia nowego hasła.</p>
          </div>
        )}
        {mode === "register" && (
          <label className="field">
            <span className="field-label">Imię (opcjonalnie)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
          </label>
        )}
        <label className="field">
          <span className="field-label">E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required inputMode="email" />
        </label>
        {mode !== "forgot" && (
          <label className="field">
            <span className="field-label">Hasło</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : undefined} />
            {mode === "register" && <span className="field-hint">Co najmniej 8 znaków.</span>}
          </label>
        )}
        {mode === "register" && (
          <label className="field">
            <span className="field-label">Powtórz hasło</span>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {sent && <p className="auth-ok" role="status">Jeśli konto {sent} istnieje, wysłaliśmy na nie link do zmiany hasła (ważny 1 h). Sprawdź też folder spam.</p>}
        <button className="primary full" type="submit" disabled={busy}>
          {busy ? "Chwileczkę…" : mode === "login" ? "Zaloguj się" : mode === "register" ? "Załóż konto" : sent ? "Wyślij ponownie" : "Wyślij link"}
        </button>
        {mode === "login" && <button type="button" className="text-btn" onClick={() => switchTo("forgot")}>Nie pamiętasz hasła?</button>}
        {mode === "forgot" && <button type="button" className="text-btn" onClick={() => switchTo("login")}>Wróć do logowania</button>}
        {mode !== "forgot" && (
          <p className="muted small">
            {mode === "login"
              ? "Jeśli konto ma już zapisane dane, zastąpią one te z tego telefonu."
              : "Dane z tego telefonu (trasa, tachograf, historia) zostaną zapisane na nowym koncie."}
          </p>
        )}
      </form>

      <button className="text-btn auth-skip" onClick={onGuest}>Kontynuuj bez konta — dane tylko w tym telefonie</button>
    </AuthFrame>
  );
}

/** Nowe hasło z linku w e-mailu (?reset=token). Po zmianie od razu logujemy. */
export function ResetPasswordScreen({ token, onAuth, onCancel }: { token: string; onAuth: (a: Auth) => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== password2) return setError("Hasła nie są takie same.");
    setBusy(true);
    setError(null);
    try {
      onAuth(await api<Auth>("POST", "/password/reset", { token, password }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <form className="card auth-form" onSubmit={submit}>
        <div>
          <h2>Ustaw nowe hasło</h2>
          <p className="muted small">Po zmianie wszystkie urządzenia zostaną wylogowane — zaloguj się na nich nowym hasłem.</p>
        </div>
        <label className="field">
          <span className="field-label">Nowe hasło</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
          <span className="field-hint">Co najmniej 8 znaków.</span>
        </label>
        <label className="field">
          <span className="field-label">Powtórz hasło</span>
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary full" type="submit" disabled={busy}>{busy ? "Chwileczkę…" : "Zapisz hasło i zaloguj"}</button>
        <button type="button" className="text-btn" onClick={onCancel}>Anuluj</button>
      </form>
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-box">
        <div className="brand auth-brand">Road<span>Pilot</span></div>
        <p className="eyebrow">Asystent planowania jazdy</p>
        {children}
      </div>
    </div>
  );
}
