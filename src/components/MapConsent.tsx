import { useState } from "react";
import { deleteMyMapData, setConsent } from "../collect";

const ASKED_KEY = "roadpilot:consentAsked";

const WHAT = (
  <ul className="consent-list">
    <li><b>Ślad przejazdu</b> — pozycja, prędkość i kierunek co kilkadziesiąt metrów w czasie jazdy, tylko w Polsce, tylko przy włączonym GPS.</li>
    <li><b>Twoje zgłoszenia</b> z HUD — niskie wiadukty, ograniczenia tonażu i prędkości, zakazy, zamknięte drogi, parkingi.</li>
    <li>Cel: własna mapa dróg dla ciężarówek RoadPilot. Nie sprzedajemy danych; zgodę możesz w każdej chwili cofnąć i usunąć wszystko, co przekazałeś.</li>
  </ul>
);

/** Jednorazowa prośba o zgodę na Planie (dla zalogowanych bez zgody) — „Nie teraz” nie pyta ponownie. */
export function ConsentPrompt({ token, onChange }: { token: string; onChange: (on: boolean) => void }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(ASKED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  if (hidden) return null;
  const close = () => {
    try {
      localStorage.setItem(ASKED_KEY, "1");
    } catch {
      /* nic */
    }
    setHidden(true);
  };
  const accept = async () => {
    setBusy(true);
    try {
      await setConsent(token, true);
      onChange(true);
      close();
    } catch {
      setBusy(false);
    }
  };
  return (
    <section className="card consent-card">
      <div className="eyebrow">Mapa RoadPilot</div>
      <h2>Pomóż zbudować mapę dla ciężarówek</h2>
      {WHAT}
      <div className="row-buttons">
        <button className="primary" disabled={busy} onClick={accept}>Zgadzam się</button>
        <button className="ghost" onClick={close}>Nie teraz</button>
      </div>
      <p className="muted small">Zmienisz to w Ustawieniach → Dane i prywatność.</p>
    </section>
  );
}

/** Ustawienia → Dane: zgoda na mapę, usunięcie przekazanych danych. */
export function MapDataSection({ token, consent, onChange }: { token: string | null; consent: boolean; onChange: (on: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!token) {
    return (
      <section className="card">
        <div className="eyebrow">Mapa RoadPilot</div>
        <p className="muted">Przekazywanie danych do mapy RoadPilot wymaga konta.</p>
      </section>
    );
  }
  const toggle = async (on: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await setConsent(token, on);
      onChange(on);
    } catch {
      setMsg("Nie udało się zapisać — sprawdź internet.");
    } finally {
      setBusy(false);
    }
  };
  const wipe = async () => {
    if (!confirm("Usunąć z serwera wszystkie Twoje ślady i zgłoszenia oraz cofnąć zgodę?")) return;
    setBusy(true);
    try {
      await deleteMyMapData(token);
      onChange(false);
      setMsg("Usunięto. Zgoda cofnięta.");
    } catch {
      setMsg("Nie udało się usunąć — sprawdź internet.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div className="eyebrow">Mapa RoadPilot</div>
      <h2>{consent ? "Pomagasz budować mapę" : "Przekazywanie danych wyłączone"}</h2>
      {WHAT}
      <div className="row-buttons">
        {consent ? (
          <button className="ghost" disabled={busy} onClick={() => toggle(false)}>Cofnij zgodę</button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => toggle(true)}>Zgadzam się</button>
        )}
        <button className="ghost danger-text" disabled={busy} onClick={wipe}>Usuń moje dane z mapy</button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}
