// Pływające okienko (obraz w obrazie): prędkość, przyjazd i na zmianę czas do przerwy / odpoczynku / końca pracy.
// Strona nie może pokazać własnego okienka nad innymi aplikacjami — rysujemy je na <canvas>, puszczamy jako
// strumień wideo i otwieramy to wideo w trybie obrazu w obrazie (Chrome / Android, Safari / iOS).
// Po zamknięciu aplikacji system może uśpić stronę: wtedy liczby w okienku stają — pokazujemy to (prędkość „—”).

import { useEffect, useRef, useState } from "react";
import { fmtDuration } from "./core/scenarios";
import { fmtClock } from "./format";

export interface FloatLine {
  label: string;
  /** Chwila (ms): pokazujemy „za X” (until) albo godzinę (clock). */
  at: number;
  kind: "until" | "clock";
}

export interface FloatInfo {
  /** km/h i chwila odczytu — starszy niż STALE_MS odczyt to „—”. */
  kmh: number | null;
  kmhAt: number;
  arrival?: number;
  /** Wiersze pokazywane na zmianę. */
  lines: FloatLine[];
}

const W = 480;
const H = 270;
const STALE_MS = 10_000;
/** Co tyle zmienia się dolny wiersz. */
const ROTATE_MS = 5_000;

type WebkitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

let canvas: HTMLCanvasElement | null = null;
let video: WebkitVideo | null = null;

function setup() {
  if (video) return video;
  canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  video = document.createElement("video") as WebkitVideo;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  // iOS otwiera obraz w obrazie tylko dla wideo w dokumencie — trzymamy je niewidoczne.
  Object.assign(video.style, { position: "fixed", width: "2px", height: "2px", opacity: "0", pointerEvents: "none", bottom: "0", left: "0" });
  document.body.appendChild(video);
  video.srcObject = canvas.captureStream();
  return video;
}

export function floatingSupported(): boolean {
  if (typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) return false;
  if (document.pictureInPictureEnabled) return true;
  const v = document.createElement("video") as WebkitVideo;
  return typeof v.webkitSupportsPresentationMode === "function" && v.webkitSupportsPresentationMode("picture-in-picture");
}

/** Tekst w zadanej szerokości — czcionka maleje, aż się zmieści (np. „jutro 06:52”, „10 h 15 min”). */
function fitText(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px: number, weight = 800) {
  let size = px;
  do {
    c.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    size -= 2;
  } while (c.measureText(text).width > maxW && size > 12);
  c.fillText(text, x, y);
}

function draw(info: FloatInfo, now: number) {
  const c = canvas!.getContext("2d")!;
  c.fillStyle = "#0b1218";
  c.fillRect(0, 0, W, H);
  const font = (px: number, weight = 800) => `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  // Prędkość po lewej.
  const fresh = info.kmh !== null && now - info.kmhAt <= STALE_MS;
  c.textAlign = "center";
  c.fillStyle = fresh ? "#44f07c" : "#4a5a66";
  c.font = font(fresh && info.kmh! >= 100 ? 118 : 140);
  c.fillText(fresh ? String(Math.round(info.kmh!)) : "—", 125, 165);
  c.fillStyle = fresh ? "#44f07c" : "#4a5a66";
  c.font = font(28, 750);
  c.fillText("km/h", 125, 210);

  c.strokeStyle = "rgba(140,175,195,.3)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(250, 40);
  c.lineTo(250, 230);
  c.stroke();

  // Po prawej: przyjazd i wiersz na zmianę.
  c.textAlign = "left";
  const x = 272;
  c.fillStyle = "#9aabb8";
  c.font = font(22, 700);
  c.fillText("PRZYJAZD", x, 72);
  c.fillStyle = "#eef3f6";
  fitText(c, info.arrival !== undefined ? fmtClock(info.arrival, now) : "—", x, 124, W - x - 14, 54);

  const lines = info.lines;
  if (lines.length) {
    const line = lines[Math.floor(now / ROTATE_MS) % lines.length];
    const left = (line.at - now) / 60_000;
    c.fillStyle = "#9aabb8";
    fitText(c, line.label.toUpperCase(), x, 172, W - x - 14, 22, 700);
    c.fillStyle = line.kind === "until" && left <= 30 ? "#e8b44c" : "#f5a524";
    fitText(c, line.kind === "clock" ? fmtClock(line.at, now) : left <= 1 ? "teraz" : fmtDuration(left), x, 218, W - x - 14, 40);
    // Kropki: który wiersz z ilu.
    const idx = Math.floor(now / ROTATE_MS) % lines.length;
    lines.forEach((_, i) => {
      c.fillStyle = i === idx ? "#eef3f6" : "#3d4c57";
      c.beginPath();
      c.arc(x + 4 + i * 16, 246, 4, 0, Math.PI * 2);
      c.fill();
    });
  }
}

/**
 * Okienko otwiera się tylko po dotknięciu (wymóg przeglądarek). Póki jest otwarte, rysujemy co 0,5 s
 * z najświeższych danych (ref) — w tle przeglądarka może to spowolnić albo zatrzymać.
 */
export function useFloating(info: FloatInfo, prepare: boolean) {
  const latest = useRef(info);
  latest.current = info;
  const [active, setActive] = useState(false);

  // Wideo gra (wyciszone) zawczasu — iOS otwiera obraz w obrazie tylko od razu w dotknięciu, bez czekania.
  useEffect(() => {
    if (!prepare || !floatingSupported()) return;
    const v = setup();
    draw(latest.current, Date.now());
    v.play().catch(() => {});
  }, [prepare]);

  useEffect(() => {
    if (!active) return;
    const tick = () => draw(latest.current, Date.now());
    tick();
    const id = setInterval(tick, 500);
    const v = video!;
    const onLeave = () => setActive(false);
    const onMode = () => v.webkitPresentationMode !== "picture-in-picture" && setActive(false);
    v.addEventListener("leavepictureinpicture", onLeave);
    v.addEventListener("webkitpresentationmodechanged", onMode);
    return () => {
      clearInterval(id);
      v.removeEventListener("leavepictureinpicture", onLeave);
      v.removeEventListener("webkitpresentationmodechanged", onMode);
    };
  }, [active]);

  const open = async () => {
    const v = setup();
    draw(latest.current, Date.now());
    // iOS: synchronicznie w dotknięciu — po await Safari odmawia.
    if (!document.pictureInPictureEnabled && v.webkitSetPresentationMode) {
      v.play().catch(() => {});
      v.webkitSetPresentationMode("picture-in-picture");
      setActive(true);
      return;
    }
    await v.play().catch(() => {});
    if (document.pictureInPictureEnabled && v.requestPictureInPicture) {
      if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
      await v.requestPictureInPicture();
    } else {
      throw new Error("Ta przeglądarka nie obsługuje pływającego okienka.");
    }
    setActive(true);
  };

  const close = async () => {
    const v = video;
    if (!v) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
    else if (v.webkitPresentationMode === "picture-in-picture") v.webkitSetPresentationMode?.("inline");
    setActive(false);
  };

  return {
    supported: floatingSupported(),
    active,
    async toggle() {
      try {
        if (active) await close();
        else await open();
      } catch (e) {
        alert(e instanceof Error && e.message.startsWith("Ta przeglądarka") ? e.message : "Nie udało się otworzyć pływającego okienka.");
      }
    },
  };
}
