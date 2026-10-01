// Komunikaty głosowe nawigacji (Web Speech API, po polsku): manewry, pas ruchu, bramki i ostrzeżenia o ograniczeniach na trasie.
// Każdy komunikat raz na próg; progi zależą od prędkości (na autostradzie wcześniej).

import { useEffect, useRef } from "react";
import { LaneSection, laneHint, lanesAhead, NavInstruction } from "./core/navmatch";
import { isAlert, RoutePoi, RouteWarning, warningText } from "./nav";

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

// Android (Chrome, Samsung Internet) podaje listę głosów dopiero po chwili (zdarzenie voiceschanged), a bez
// jawnie wybranego głosu czyta domyślnym głosem telefonu — na Samsungu często angielskim. Dlatego czekamy na listę
// i zawsze ustawiamy polski głos, jeśli telefon go ma.
let plVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

const isPolish = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase().startsWith("pl");

function pickVoice() {
  if (!voiceSupported()) return;
  const all = speechSynthesis.getVoices();
  if (!all.length) return;
  voicesLoaded = true;
  const pl = all.filter(isPolish);
  // Najpierw Google (najlepsza jakość na Androidzie), potem głos lokalny, potem jakikolwiek polski.
  plVoice = pl.find((v) => /google/i.test(v.name)) ?? pl.find((v) => v.localService) ?? pl[0] ?? null;
}

if (voiceSupported()) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

/** Telefon podał listę głosów i nie ma w niej polskiego — komunikaty będą po angielsku (trzeba doinstalować). */
export function polishVoiceMissing() {
  if (!voiceSupported()) return false;
  if (!voicesLoaded) pickVoice();
  return voicesLoaded && !plVoice;
}

export function speak(text: string) {
  if (!voiceSupported()) return;
  if (!plVoice) pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pl-PL";
  if (plVoice) u.voice = plVoice;
  u.rate = 1.02;
  speechSynthesis.speak(u);
}

/** „300 metrów”, „1,5 kilometra”, „2 kilometry”. */
export function spokenDist(km: number) {
  if (km < 0.95) {
    const m = Math.max(50, Math.round((km * 1000) / 50) * 50);
    return `${m} metrów`;
  }
  const v = Math.round(km * 2) / 2;
  if (v === 1) return "1 kilometr";
  if (!Number.isInteger(v)) return `${String(v).replace(".", ",")} kilometra`;
  return `${v} ${v % 10 >= 2 && v % 10 <= 4 && (v < 10 || v > 20) ? "kilometry" : "kilometrów"}`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Progi zapowiedzi (km) — przy większej prędkości pierwsza wcześniej. */
function thresholds(kmh: number | null) {
  return (kmh ?? 0) >= 70 ? [2, 0.5, 0.08] : [0.5, 0.2, 0.05];
}

const ALERT_SPEECH: Record<string, string> = {
  camera: "fotoradar",
  red_light: "kamera na czerwonym świetle",
  section: "odcinkowy pomiar prędkości",
  police: "kontrola policji",
  itd: "kontrola ITD",
};

/** „Uwaga. Za 500 metrów fotoradar. Ograniczenie 70.” / „… odcinkowy pomiar prędkości na 3 kilometry. …” */
function alertSpeech(w: RouteWarning, d: number, limit: number | null | undefined) {
  const len = w.toKm !== undefined ? ` na ${spokenDist(w.toKm - w.km)}` : "";
  return `Uwaga. Za ${spokenDist(d)} ${ALERT_SPEECH[w.kind] ?? "kontrola"}${len}.${limit ? ` Ograniczenie ${limit}.` : ""}`;
}

/** Odcinkowy pomiar w nawigacji: limit dla naszego pojazdu i średnia z przejazdu (gdy już go skończyliśmy). */
export type SectionVoice = (w: RouteWarning) => { limit?: number; avgKmh?: number };

/**
 * Mówi zapowiedzi manewrów i ostrzeżeń. `next` = następny manewr i odległość do niego; `warnings` z km trasy;
 * `km` — pozycja na trasie.
 */
/** Asystent pasa: podpowiedź mówimy raz, gdy do miejsca wyboru pasa zostało tyle km (autostrada / reszta). */
const LANE_SAY_KM = { fast: 1.2, slow: 0.35 } as const;
/** Bramki zapowiadamy raz z tej odległości. */
const TOLL_SAY_KM = 1;

export function useNavVoice(enabled: boolean, next: { ins: NavInstruction; inKm: number } | undefined, km: number | undefined, warnings: RouteWarning[] | undefined, kmh: number | null, section?: SectionVoice, lanes?: LaneSection[], pois?: RoutePoi[]) {
  const said = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled || !voiceSupported() || km === undefined) return;
    if (next) {
      const [far, mid, now] = thresholds(kmh);
      const key = `${next.ins.km}`;
      const text = lower(next.ins.text.replace(/\.$/, ""));
      let stage: string | null = null;
      if (next.inKm <= now) stage = "now";
      else if (next.inKm <= mid) stage = "mid";
      else if (next.inKm <= far && next.inKm > mid) stage = "far";
      if (stage && !said.current.has(`${key}:${stage}`)) {
        // Zapowiedź dalsza wyklucza późniejsze etapy tego samego manewru, jeśli już są „za nami”.
        said.current.add(`${key}:${stage}`);
        speak(stage === "now" ? next.ins.text : `Za ${spokenDist(next.inKm)} ${text}.`);
      }
    }
    // Pas ruchu: np. zjazd z pasem, który dopiero się zacznie — „Jedź skrajnie prawym pasem” z wyprzedzeniem.
    const ls = lanes && lanesAhead(lanes, km);
    const hint = ls && laneHint(ls);
    if (ls && hint && ls.inKm <= ((kmh ?? 0) >= 70 ? LANE_SAY_KM.fast : LANE_SAY_KM.slow) && !said.current.has(`l:${ls.km}`)) {
      said.current.add(`l:${ls.km}`);
      speak(`${hint.text}.`);
    }
    for (const p of pois ?? []) {
      const d = p.km - km;
      if (p.kind === "toll" && d > 0 && d <= TOLL_SAY_KM && !said.current.has(`t:${p.id}`)) {
        said.current.add(`t:${p.id}`);
        speak(`Za ${spokenDist(d)} bramki.`);
      }
    }
    for (const w of warnings ?? []) {
      const d = w.km - km;
      const key = `w:${w.source}:${w.id}:${w.kind}`;
      if (d > 0 && d <= 1 && !said.current.has(key)) {
        said.current.add(key);
        speak(isAlert(w) ? alertSpeech(w, d, w.kind === "section" && section ? section(w).limit : w.value) : `Uwaga. ${warningText(w).replace(/(\d),(\d)/g, "$1 przecinek $2").replace(" m", " metra").replace(" t", " ton")} za ${spokenDist(d)}.`);
      }
      if (w.toKm !== undefined && km >= w.km && km - w.km < 0.3 && km < w.toKm && !said.current.has(`${key}:start`)) {
        said.current.add(`${key}:start`);
        const limit = section?.(w).limit;
        speak(`Początek odcinkowego pomiaru prędkości.${limit ? ` Limit ${limit}.` : ""}`);
      }
      if (w.toKm !== undefined && km >= w.toKm && km - w.toKm < 0.3 && said.current.has(`${key}:start`) && !said.current.has(`${key}:end`)) {
        said.current.add(`${key}:end`);
        const avg = section?.(w).avgKmh;
        speak(`Koniec odcinkowego pomiaru prędkości.${avg ? ` Średnia ${Math.round(avg)}.` : ""}`);
      }
    }
  }, [enabled, next?.ins.km, next && Math.round(next.inKm * 100), km && Math.round(km * 20), kmh && Math.round(kmh / 10)]);
}
