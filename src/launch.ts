// Otwieranie aplikacji muzyki / nawigacji z HUD (linki z core/apps.ts).

import { AppLink, Platform } from "./core/apps";

export function platform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS udaje Maca — rozpoznajemy go po ekranie dotykowym.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** Na iPhonie schemat aplikacji; gdy po 1,5 s strona jest nadal widoczna (brak aplikacji) — otwieramy wersję w przeglądarce. */
export function launch(link: AppLink, p: Platform) {
  if (p === "other") {
    window.open(link.web, "_blank", "noopener");
    return;
  }
  if (p === "ios") {
    const timer = setTimeout(() => {
      if (!document.hidden) window.location.href = link.web;
    }, 1500);
    document.addEventListener("visibilitychange", () => clearTimeout(timer), { once: true });
  }
  window.location.href = link.href;
}
