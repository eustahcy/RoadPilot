// Stałe powiadomienie „jak Spotify”: cicha pętla audio + Media Session API.
// Dopóki „gra”, Android pokazuje kartę w zasłonie powiadomień i na ekranie blokady, a przeglądarka nie usypia
// aplikacji w tle — dalej działają przypomnienia i liczniki. PWA nie ma usługi w tle jak aplikacja natywna:
// po zamknięciu aplikacji z listy ostatnich (przesunięciu karty) powiadomienie znika.

import { useEffect, useRef } from "react";
import { Plan } from "./core/plan";
import { DriverStatus } from "./core/scenarios";
import { ActiveStop } from "./core/stop";
import { fmtClock, fmtDuration } from "./format";
import { eventLabel } from "./components/Timeline";

export interface OngoingInfo {
  title: string;
  text: string;
}

export const ongoingSupported = typeof window !== "undefined" && "mediaSession" in navigator && typeof Audio !== "undefined";

const ARTWORK = [192, 512].map((n) => ({ src: `${import.meta.env.BASE_URL}icon-${n}.png`, sizes: `${n}x${n}`, type: "image/png" }));

let audio: HTMLAudioElement | null = null;

function player() {
  if (!audio) {
    // Chrome nie pokazuje karty dla nagrań krótszych niż ~5 s — dlatego 10 s ciszy w pętli.
    audio = new Audio(URL.createObjectURL(silentWav(10)));
    audio.loop = true;
  }
  return audio;
}

/** WAV 8 kHz, 8 bit, mono — same próbki 128 (cisza). ~80 kB, generowany w pamięci, bez pliku w cache. */
function silentWav(seconds: number): Blob {
  const rate = 8000;
  const n = rate * seconds;
  const v = new DataView(new ArrayBuffer(44 + n));
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, n, true);
  new Uint8Array(v.buffer, 44).fill(128);
  return new Blob([v.buffer], { type: "audio/wav" });
}

/** Uruchomienie dźwięku musi wyjść z kliknięcia — wołaj z obsługi przycisku. */
export function startOngoing(): Promise<boolean> {
  if (!ongoingSupported) return Promise.resolve(false);
  return player().play().then(() => true, () => false);
}

function stopOngoing() {
  audio?.pause();
  if (!ongoingSupported) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = "none";
}

/** Tekst karty: co teraz robić i kiedy przyjazd. */
export function ongoingInfo(plan: Plan | undefined, status: DriverStatus, stop: ActiveStop | null, now: number): OngoingInfo {
  const arrival = plan?.feasible ? `Przyjazd ${fmtClock(plan.arrival, now)}` : "Brak wykonalnego planu";
  const driveLeft = `jazda dziś: ${fmtDuration(status.driveLeftToday)}`;
  if (stop) {
    const end = stop.start + stop.targetMin * 60_000;
    return { title: end > now ? `Postój do ${fmtClock(end, now)} (${fmtDuration((end - now) / 60_000)})` : "Koniec postoju — możesz ruszać", text: arrival };
  }
  const events = plan?.feasible ? plan.events : [];
  const first = events[0];
  if (!first) return { title: "RoadPilot", text: `${arrival} · ${driveLeft}` };
  if (first.kind !== "drive" && first.kind !== "arrive") {
    return { title: `${eventLabel(first)} do ${fmtClock(first.end, now)}`, text: arrival };
  }
  const next = events.find((e) => e.kind !== "drive");
  const title =
    !next || next.kind === "arrive"
      ? "Jedź — bez postoju do celu"
      : `Jedź · ${eventLabel(next).toLowerCase()} o ${fmtClock(next.start, now)} (za ${fmtDuration(Math.max(0, next.start - now) / 60_000)})`;
  return { title, text: `${arrival} · ${driveLeft}` };
}

/**
 * Trzyma kartę odtwarzacza z aktualnym planem. Po ponownym otwarciu aplikacji przeglądarka blokuje dźwięk
 * bez kliknięcia — wtedy startujemy przy pierwszym dotknięciu ekranu. „Pauza” na karcie wyłącza powiadomienie.
 */
export function useOngoingNotification(enabled: boolean, info: OngoingInfo, onOff: () => void) {
  const offRef = useRef(onOff);
  offRef.current = onOff;

  useEffect(() => {
    if (!enabled || !ongoingSupported) return;
    const retry = () => startOngoing();
    startOngoing().then((ok) => !ok && window.addEventListener("pointerdown", retry, { once: true }));
    const off = () => offRef.current();
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => void startOngoing());
    ms.setActionHandler("pause", off);
    try {
      ms.setActionHandler("stop", off);
    } catch {
      /* starsze przeglądarki nie znają „stop” */
    }
    return () => {
      window.removeEventListener("pointerdown", retry);
      for (const a of ["play", "pause", "stop"] as const) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* jw. */
        }
      }
      stopOngoing();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !ongoingSupported) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: info.title, artist: info.text, album: "RoadPilot", artwork: ARTWORK });
    navigator.mediaSession.playbackState = "playing";
  }, [enabled, info.title, info.text]);
}
