// „Dodaj do ekranu głównego”: na Androidzie (Chrome) systemowe okno instalacji, na iPhonie tylko instrukcja —
// Safari nie daje stronie takiej możliwości.

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chrome wysyła zdarzenie raz, często zanim React się uruchomi — łapiemy je od razu przy wczytaniu modułu.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  notify();
});

/** Uruchomiona z ikony na ekranie głównym (a nie w karcie przeglądarki). */
export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function useInstall() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return {
    installed: isStandalone(),
    /** Przeglądarka pozwala pokazać własne okno instalacji (Chrome / Edge / Samsung Internet). */
    canPrompt: deferred !== null,
    async prompt(): Promise<boolean> {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      await e.prompt();
      const { outcome } = await e.userChoice;
      notify();
      return outcome === "accepted";
    },
  };
}
