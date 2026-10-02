import { useEffect, useState } from "react";
import { api } from "../api";

// „Wsparcie” — kim jestem i jak pomóc w rozwoju RoadPilot (menu ⋯ w Nawigacji, Ustawienia → Wsparcie, stopka).
// Link do wpłat ustawia administrator (Administracja → Ustawienia aplikacji), aplikacja pobiera go z GET /api/config.

const CACHE = "roadpilot:supportUrl";

/** Link do wpłat (Revolut) — z pamięci telefonu od razu, odświeżany z serwera raz na otwarcie. */
export function useSupportUrl(): string {
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(CACHE) ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    let alive = true;
    api<{ supportUrl: string }>("GET", "/config")
      .then((c) => {
        if (!alive) return;
        setUrl(c.supportUrl ?? "");
        try { localStorage.setItem(CACHE, c.supportUrl ?? ""); } catch { /* bez pamięci */ }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return url;
}

export function SupportContent() {
  const url = useSupportUrl();
  return (
    <div className="support">
      <div className="support-hero">
        <div className="support-avatar" aria-hidden>D</div>
        <div>
          <h2>Cześć, jestem Damian</h2>
          <p>28 lat · kierowca zawodowy · twórca RoadPilot</p>
        </div>
      </div>
      <p>
        Na co dzień jeżdżę zawodowo, a w wolnym czasie oddaję się swojej pasji — programowaniu. Z połączenia tych dwóch światów
        powstaje <b>RoadPilot</b>: narzędzie, które ma pomagać kierowcom zawodowym w codziennej pracy — w planowaniu przerw
        i odpoczynków, w nawigacji dla ciężarówek i w omijaniu tego, co na trasie potrafi zepsuć dzień.
      </p>
      <div className="support-costs">
        <div><b>Serwery i mapy</b><span>własny silnik tras, mapy i dane drogowe — co miesiąc niemałe koszty</span></div>
        <div><b>Aplikacje Android i iOS</b><span>wydanie pełnoprawnych aplikacji w sklepach to kolejne duże wydatki</span></div>
      </div>
      <h3>Jak możesz pomóc?</h3>
      <ul className="support-ways">
        <li><b>Korzystaj z RoadPilot na co dzień.</b> Każda trasa, zgłoszenie fotoradaru, robót czy brakującego parkingu sprawia, że aplikacja jest lepsza dla wszystkich.</li>
        <li><b>Poleć ją innym kierowcom.</b> Im nas więcej, tym dokładniejsze korki, prędkości i ostrzeżenia.</li>
        <li><b>Wesprzyj dobrowolną wpłatą.</b> Nic nie musisz — ale każda złotówka idzie na rozwój i utrzymanie projektu.</li>
      </ul>
      {url ? (
        <a className="support-pay primary" href={url} target="_blank" rel="noopener noreferrer">♥ Wesprzyj RoadPilot</a>
      ) : (
        <p className="muted small">Link do wpłat pojawi się tu wkrótce.</p>
      )}
      <p className="support-thanks">Dziękuję, że jesteś z nami. Szerokiej drogi! 🚛</p>
    </div>
  );
}
