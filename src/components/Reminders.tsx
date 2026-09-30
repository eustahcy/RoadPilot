import { useEffect, useState } from "react";
import { ParkingHint, Plan } from "../core/plan";
import { fmtTime } from "../format";
import { ongoingSupported, startOngoing } from "../ongoing";
import { eventLabel } from "./Timeline";

interface Reminder {
  at: number;
  title: string;
  body: string;
}

const ICON = `${import.meta.env.BASE_URL}icon.svg`;
const supported = typeof window !== "undefined" && "Notification" in window && window.isSecureContext;

/**
 * Przypomnienia o parkingu i postojach. Działają, dopóki aplikacja jest otwarta
 * (bez serwera push — zgodnie z założeniem „brak backendu”).
 */
export function Reminders({ plan, parking }: { plan: Plan; parking?: ParkingHint }) {
  const [enabled, setEnabled] = useState(() => supported && Notification.permission === "granted" && readFlag());

  const reminders: Reminder[] = [];
  if (parking) reminders.push({ at: parking.searchFrom, title: "Czas szukać parkingu", body: `${eventLabel(parking.stop)} o ${fmtTime(parking.stop.start)}.` });
  for (const e of plan.events) {
    if (e.kind === "break" || e.kind === "rest" || e.kind === "weeklyRest") {
      reminders.push({ at: e.start, title: `${eventLabel(e)} — teraz`, body: e.reason });
      reminders.push({ at: e.end, title: "Koniec postoju", body: "Możesz ruszać dalej." });
    }
  }
  const key = reminders.map((r) => r.at).join(",");

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const timers = reminders
      .filter((r) => r.at > now && r.at - now < 2 ** 31 - 1)
      .map((r) => setTimeout(() => notify(r), r.at - now));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  const toggle = async () => {
    if (enabled) {
      setEnabled(false);
      writeFlag(false);
      return;
    }
    const perm = await Notification.requestPermission();
    const ok = perm === "granted";
    setEnabled(ok);
    writeFlag(ok);
  };

  return (
    <section className="card reminders">
      <div>
        <div className="eyebrow">Przypomnienia</div>
        <p className="muted">
          {supported
            ? enabled
              ? `Włączone: ${reminders.filter((r) => r.at > Date.now()).length} przypomnień dla wskazanego scenariusza (gdy aplikacja jest otwarta).`
              : "Powiadomienie, gdy trzeba szukać parkingu, zacząć i skończyć postój."
            : "Powiadomienia wymagają połączenia HTTPS — na tym adresie są niedostępne."}
        </p>
      </div>
      {supported && Notification.permission !== "denied" && (
        <button className={enabled ? "ghost" : "primary"} onClick={toggle}>{enabled ? "Wyłącz" : "Włącz"}</button>
      )}
    </section>
  );
}

/** Stałe powiadomienie w zasłonie (karta odtwarzacza) — aplikacja działa po zminimalizowaniu i przy wygaszonym ekranie. */
export function OngoingCard({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  // Dźwięk startujemy bezpośrednio w kliknięciu — inaczej przeglądarka go zablokuje.
  const toggle = async () => {
    if (on) return onChange(false);
    if (await startOngoing()) onChange(true);
  };
  return (
    <section className="card reminders">
      <div>
        <div className="eyebrow">Stałe powiadomienie</div>
        <p className="muted">
          {ongoingSupported
            ? on
              ? "Włączone: następna czynność i przyjazd są w powiadomieniach i na ekranie blokady. Aplikacja działa w tle, dopóki nie zamkniesz jej z listy ostatnich. „Pauza” na karcie je wyłącza."
              : "Karta jak w odtwarzaczu muzyki — RoadPilot działa w tle po zminimalizowaniu i przy wygaszonym ekranie."
            : "Ta przeglądarka nie obsługuje karty odtwarzacza (Media Session)."}
        </p>
      </div>
      {ongoingSupported && <button className={on ? "ghost" : "primary"} onClick={toggle}>{on ? "Wyłącz" : "Włącz"}</button>}
    </section>
  );
}

async function notify(r: Reminder) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(r.title, { body: r.body, icon: ICON, tag: `rp-${r.at}` });
    else new Notification(r.title, { body: r.body, icon: ICON });
  } catch {
    /* ignoruj — przypomnienia są pomocnicze */
  }
}

function readFlag() {
  try {
    return localStorage.getItem("roadpilot:reminders") === "1";
  } catch {
    return false;
  }
}

function writeFlag(v: boolean) {
  try {
    localStorage.setItem("roadpilot:reminders", v ? "1" : "0");
  } catch {
    /* brak zapisu */
  }
}
