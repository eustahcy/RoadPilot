import { useState } from "react";
import { platform } from "../launch";
import { useInstall } from "../install";

/** Przycisk w nagłówku — znika, gdy aplikacja jest już uruchomiona z ekranu głównego. */
export function InstallButton() {
  const install = useInstall();
  const [help, setHelp] = useState(false);
  if (install.installed) return null;
  const onClick = async () => {
    // Android: systemowe okno; gdy go nie ma (np. już odrzucone) — instrukcja.
    if (install.canPrompt) await install.prompt();
    else setHelp(true);
  };
  return (
    <>
      <button className="install-btn" onClick={onClick} title="Dodaj RoadPilot do ekranu głównego" aria-label="Dodaj do ekranu głównego">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM12 8v8M8 12h8" /></svg>
        <span>Zainstaluj</span>
      </button>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </>
  );
}

function InstallHelp({ onClose }: { onClose: () => void }) {
  const ios = platform() === "ios";
  return (
    <div className="install-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="install-body" role="dialog" aria-label="Dodaj do ekranu głównego">
        <button className="install-close" aria-label="Zamknij" onClick={onClose}>×</button>
        <h2>Dodaj RoadPilot do ekranu głównego</h2>
        <p className="muted">Otworzysz go jak aplikację — na pełnym ekranie, bez pasków przeglądarki (HUD będzie większy).</p>
        {ios ? (
          <ol className="install-steps">
            <li>Otwórz tę stronę w <b>Safari</b>.</li>
            <li>Stuknij <b>Udostępnij</b> <ShareIcon /> na dole (lub u góry na iPadzie).</li>
            <li>Przewiń i wybierz <b>„Do ekranu początkowego”</b>.</li>
            <li>Stuknij <b>„Dodaj”</b> — ikona RoadPilot pojawi się na ekranie.</li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>Otwórz menu przeglądarki <b>⋮</b> (prawy górny róg).</li>
            <li>Wybierz <b>„Zainstaluj aplikację”</b> lub <b>„Dodaj do ekranu głównego”</b>.</li>
            <li>Potwierdź — ikona RoadPilot pojawi się na ekranie.</li>
          </ol>
        )}
        <button className="primary full" onClick={onClose}>Rozumiem</button>
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg className="install-share" viewBox="0 0 24 24" aria-label="ikona Udostępnij">
      <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />
    </svg>
  );
}
