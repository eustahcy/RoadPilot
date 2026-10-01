import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";

// Mapa z kafelków TomTom (styl nocny) przez RoadPilot API — bez zewnętrznych bibliotek.
// Kafelki 512 px; współrzędne Web Mercator. Warstwa z kafelkami i nakładkami obraca się (kierunek jazdy w górę)
// i pochyla (widok jak w nawigacji); strzałka „my” jest poza warstwą, zawsze w tym samym miejscu ekranu.

export const TILE = 512;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Punkt świata w pikselach przy danym zoomie (kafelki 512 px). */
export function worldPx(p: LatLon, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const s = Math.sin((p.lat * Math.PI) / 180);
  return [((p.lon + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

export function fromWorldPx(x: number, y: number, zoom: number): LatLon {
  const scale = TILE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon };
}

// Kafelki pobieramy z nagłówkiem sesji (fetch → blob URL) — <img src> nie wysyła tokenu.
const blobs = new Map<string, string | Promise<string | null>>();
const BLOBS_MAX = 400;

export function loadTile(key: string, token: string): Promise<string | null> | string | null {
  const hit = blobs.get(key);
  if (hit !== undefined) return hit;
  const p = fetch(apiUrl(`/tiles/${key}.png`), { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => {
      const url = b ? URL.createObjectURL(b) : null;
      if (url) blobs.set(key, url);
      else blobs.delete(key); // błąd (limit, brak sieci) — spróbujemy przy następnym ruchu
      if (blobs.size > BLOBS_MAX) {
        const [old, v] = blobs.entries().next().value!;
        if (typeof v === "string") URL.revokeObjectURL(v);
        blobs.delete(old);
      }
      return url;
    })
    .catch(() => {
      blobs.delete(key);
      return null;
    });
  blobs.set(key, p);
  return p;
}

function Tile({ k, token, style }: { k: string; token: string; style: CSSProperties }) {
  const first = loadTile(k, token);
  const [src, setSrc] = useState<string | null>(typeof first === "string" ? first : null);
  useEffect(() => {
    const v = loadTile(k, token);
    if (typeof v === "string") setSrc(v);
    else if (v) {
      let alive = true;
      v.then((u) => alive && setSrc(u));
      return () => {
        alive = false;
      };
    }
  }, [k, token]);
  return src ? <img className="map-tile" src={src} style={style} alt="" draggable={false} /> : <span className="map-tile empty" style={style} />;
}

export interface MapViewProps {
  token: string;
  center: LatLon;
  zoom: number;
  /** Kierunek w górę ekranu (stopnie od północy). */
  bearing?: number;
  /** Pochylenie (stopnie) — 0 = z góry. */
  pitch?: number;
  /** Gdzie na ekranie jest `center` (część wysokości) — w nawigacji niżej, żeby widzieć drogę przed sobą. */
  anchorY?: number;
  /** Nakładki rysowane w układzie mapy: dostają funkcję px(punkt) → współrzędne SVG. */
  overlay?: (px: (p: LatLon) => [number, number], zoom: number) => ReactNode;
  /** Elementy na ekranie (nie obracane), np. strzałka „my”. */
  children?: ReactNode;
  /** Przesuwanie i przybliżanie palcem / myszą (podgląd). */
  onMove?: (center: LatLon, zoom: number) => void;
  className?: string;
  /**
   * Pozycja „na teraz” (przewidywana między odczytami GPS) — wołana w każdej klatce; przesuwa i obraca warstwę
   * bezpośrednio w DOM, bez ponownego renderu. Kafelki leżą względem stałego punktu odniesienia (przenoszonego
   * dopiero, gdy odjedziemy daleko), a do bieżącej pozycji dowozi je transformacja warstwy.
   */
  follow?: () => { lat: number; lon: number; bearing?: number } | undefined;
}

export function MapView({ token, center, zoom, bearing = 0, pitch = 0, anchorY = 0.5, overlay, children, onMove, className = "", follow }: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Przesuwanie palcem / myszą i przybliżanie (szczypanie, kółko) — tylko gdy jest onMove.
  const gestures = useMapGestures((g) => onMove?.(...moveView({ center, zoom }, g, { w: size.w, h: size.h, anchorY, bearing, pitch })));

  const z = Math.max(3, Math.min(18, Math.floor(zoom)));
  const scale = 2 ** (zoom - z);
  const [pxX, pxY] = worldPx(center, z);
  // Warstwa większa niż ekran: po obrocie i pochyleniu nie może być pustych rogów. Przy pochyleniu daleki pas
  // u góry zakrywa „niebo” (HUD), więc zasięg 1,6 wystarcza — większy dawał warstwę ~10 000 px na telefonie,
  // której Android nie nadążał rysować (niedomalowane karty, migotanie, na iOS brak pamięci).
  const reach = Math.hypot(size.w, size.h) * (pitch > 0 ? 1.6 : 0.75);
  const half = reach / scale;
  // Punkt odniesienia kafelków (cx, cy): przy płynnej mapie zostaje w miejscu, aż odjedziemy o ćwierć zasięgu.
  const origin = useRef<{ z: number; x: number; y: number } | null>(null);
  const o = origin.current;
  if (!follow || !o || o.z !== z || Math.hypot(pxX - o.x, pxY - o.y) > half / 4) origin.current = { z, x: pxX, y: pxY };
  const [cx, cy] = [origin.current!.x, origin.current!.y];
  // Obrót bez „długiej drogi” przez 360° (359° → 1° to obrót o 2°, nie o −358°).
  const turn = useRef(bearing);
  const unwrap = (b: number) => {
    turn.current += ((b - turn.current + 540) % 360) - 180;
    return turn.current;
  };
  /** Kafelki poziomu `lz` w zasięgu (koło, nie kwadrat), od najbliższych — te ładują się pierwsze. */
  const level = (lz: number, cachedOnly: boolean) => {
    const f = 2 ** (z - lz); // rozmiar kafelka poziomu lz w pikselach poziomu z (w jednostkach TILE)
    const size = TILE * f;
    const n = 2 ** lz;
    const out: { k: string; x: number; y: number; size: number; d: number }[] = [];
    for (let ty = Math.floor((cy - half) / size); ty <= Math.floor((cy + half) / size); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor((cx - half) / size); tx <= Math.floor((cx + half) / size); tx++) {
        const x = tx * size - cx;
        const y = ty * size - cy;
        const d = Math.hypot(Math.max(x, Math.min(0, x + size)), Math.max(y, Math.min(0, y + size)));
        if (d > half) continue;
        const k = `${lz}/${((tx % n) + n) % n}/${ty}`;
        if (cachedOnly && typeof blobs.get(k) !== "string") continue;
        out.push({ k, x, y, size, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  };
  const tiles = level(z, false);
  // Zanim przyjdą kafelki nowego poziomu (przybliżanie / oddalanie), pod spodem leżą już pobrane z sąsiednich.
  const backdrop = [...(z > 3 ? level(z - 1, true) : []), ...(z < 18 ? level(z + 1, true).slice(0, 150) : [])];
  const px = (p: LatLon): [number, number] => {
    const [x, y] = worldPx(p, z);
    return [(x - cx) * scale, (y - cy) * scale];
  };
  const ax = size.w / 2;
  const ay = size.h * anchorY;
  /** Transformacja warstwy dla pozycji `p` (px poziomu z) i kierunku — to samo w renderze i w każdej klatce. */
  const layerTransform = (x: number, y: number, b: number) => `translate(${ax}px, ${ay}px) rotateX(${pitch}deg) rotate(${-unwrap(b)}deg) translate(${(-(x - cx) * scale).toFixed(1)}px, ${(-(y - cy) * scale).toFixed(1)}px)`;
  const now = follow?.();
  const [nx, ny] = now ? worldPx(now, z) : [pxX, pxY];
  const layer: CSSProperties = { transform: layerTransform(nx, ny, now?.bearing ?? bearing) };
  // Między renderami (odczyt GPS co ~1 s) warstwę dowozi pętla klatek — zapis jednego stylu, bez Reacta.
  const layerRef = useRef<HTMLDivElement>(null);
  const geom = useRef({ z, layerTransform, bearing });
  geom.current = { z, layerTransform, bearing };
  useEffect(() => {
    if (!follow) return;
    let id = 0;
    const tick = () => {
      const p = follow();
      const el = layerRef.current;
      if (p && el) {
        const g = geom.current;
        const [x, y] = worldPx(p, g.z);
        el.style.transform = g.layerTransform(x, y, p.bearing ?? g.bearing);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [follow]);

  return (
    <div
      ref={box}
      className={`map-view ${onMove ? "interactive" : ""} ${className}`}
      style={{ perspective: pitch > 0 ? `${Math.round(size.h * 1.05)}px` : undefined, perspectiveOrigin: `50% ${anchorY * 100}%` }}
      {...(onMove ? gestures : {})}
    >
      <div className="map-layer" ref={layerRef} style={layer}>
        {backdrop.map((t) => (
          <img key={`b${t.k}`} className="map-tile" src={blobs.get(t.k) as string} style={{ left: t.x * scale, top: t.y * scale, width: t.size * scale, height: t.size * scale }} alt="" draggable={false} />
        ))}
        {tiles.map((t) => (
          <Tile key={t.k} k={t.k} token={token} style={{ left: t.x * scale, top: t.y * scale, width: TILE * scale, height: TILE * scale }} />
        ))}
        {overlay && (
          <svg className="map-overlay" style={{ left: -reach, top: -reach, width: reach * 2, height: reach * 2 }} viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`}>
            {overlay(px, zoom)}
          </svg>
        )}
      </div>
      {children}
      <span className="map-credit">© TomTom</span>
    </div>
  );
}

/** Ruch mapy z gestu: przesunięcie (px ekranu) i zmiana zoomu (log2) wokół punktu (ax, ay) względem ramki. */
export interface MapGesture {
  dx: number;
  dy: number;
  dz: number;
  ax: number;
  ay: number;
}

export const MIN_VIEW_ZOOM = 4;
/** Przytrzymanie palca na mapie (ms) — np. „dodaj punkt do trasy”. */
export const LONG_PRESS_MS = 600;
export const MAX_VIEW_ZOOM = 18;

/**
 * Nowy środek i zoom po geście. Punkt pod palcem zostaje pod palcem: przesunięcie ekranu obracamy o kierunek mapy
 * (warstwa jest obrócona o −bearing), a przy pochyleniu pion ekranu to więcej świata (ok. 1/cos) — przybliżenie przy kotwicy.
 */
export function moveView(view: { center: LatLon; zoom: number }, g: MapGesture, o: { w: number; h: number; anchorY?: number; bearing?: number; pitch?: number }): [LatLon, number] {
  const b = ((o.bearing ?? 0) * Math.PI) / 180;
  const tilt = 1 / Math.max(0.3, Math.cos(((o.pitch ?? 0) * Math.PI) / 180));
  const toWorld = (x: number, y: number): [number, number] => [x * Math.cos(b) - y * tilt * Math.sin(b), x * Math.sin(b) + y * tilt * Math.cos(b)];
  const zoom = Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, view.zoom + g.dz));
  const k = 2 ** (zoom - view.zoom);
  const [cx, cy] = worldPx(view.center, view.zoom);
  const [px, py] = toWorld(g.dx, g.dy);
  // Przesunięcie punktu zakotwiczenia (palec / środek szczypania) od środka widoku — po zoomie ma zostać w miejscu.
  const [ox, oy] = toWorld(g.ax - o.w / 2, g.ay - o.h * (o.anchorY ?? 0.5));
  const nx = cx - px + ox * (1 - 1 / k);
  const ny = cy - py + oy * (1 - 1 / k);
  return [fromWorldPx(nx * k, ny * k, zoom), zoom];
}

/**
 * Gesty mapy bez bibliotek: jeden palec / mysz = przesuwanie, dwa palce = szczypanie (zoom + przesuwanie),
 * kółko = zoom wokół kursora. Po przeciągnięciu tłumi kliknięcie (np. wybór trasy dotknięciem linii).
 */
export function useMapGestures(apply: (g: MapGesture) => void, onStart?: () => void, extra: { onTap?: (x: number, y: number, e: React.PointerEvent) => void; onLongPress?: (x: number, y: number) => void } = {}) {
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const cb = useRef({ apply, onStart, ...extra });
  cb.current = { apply, onStart, ...extra };
  /** Przytrzymanie: timer od dotknięcia jednym palcem; ruch, drugi palec albo puszczenie go kasuje. */
  const hold = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const stopHold = () => {
    if (hold.current) clearTimeout(hold.current.id);
    hold.current = null;
  };
  const local = (e: { clientX: number; clientY: number; currentTarget: EventTarget }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pair = () => {
    const [a, b] = [...pts.current.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      if (!pts.current.size) moved.current = 0;
      const p = local(e);
      pts.current.set(e.pointerId, p);
      stopHold();
      if (pts.current.size === 1) {
        const id = window.setTimeout(() => {
          if (hold.current && moved.current <= 6) {
            moved.current = 1000; // po przytrzymaniu puszczenie nie jest już dotknięciem
            cb.current.onLongPress?.(p.x, p.y);
          }
          hold.current = null;
        }, LONG_PRESS_MS);
        hold.current = { id, x: p.x, y: p.y, at: Date.now() };
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const prev = pts.current.get(e.pointerId);
      if (!prev) return;
      const before = pts.current.size === 2 ? pair() : null;
      const p = local(e);
      pts.current.set(e.pointerId, p);
      if (before) {
        stopHold();
        const after = pair();
        const dz = before.d > 0 && after.d > 0 ? Math.log2(after.d / before.d) : 0;
        moved.current += Math.hypot(after.mx - before.mx, after.my - before.my) + Math.abs(dz) * 100;
        if (moved.current > 6) cb.current.onStart?.();
        cb.current.apply({ dx: after.mx - before.mx, dy: after.my - before.my, dz, ax: after.mx, ay: after.my });
      } else if (pts.current.size === 1) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        // Drobne drgnięcie palca przy dotknięciu to jeszcze nie przesuwanie — do progu trzymamy punkt startu.
        if (moved.current <= 6 && Math.hypot(dx, dy) <= 6) {
          pts.current.set(e.pointerId, prev);
          return;
        }
        moved.current += Math.hypot(dx, dy);
        stopHold();
        cb.current.onStart?.();
        cb.current.apply({ dx, dy, dz: 0, ax: p.x, ay: p.y });
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const h = hold.current;
      const single = pts.current.size === 1;
      pts.current.delete(e.pointerId);
      stopHold();
      if (single && h && moved.current <= 6 && Date.now() - h.at < LONG_PRESS_MS) cb.current.onTap?.(h.x, h.y, e);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      pts.current.delete(e.pointerId);
      stopHold();
    },
    onWheel: (e: React.WheelEvent) => {
      const p = local(e);
      cb.current.onStart?.();
      cb.current.apply({ dx: 0, dy: 0, dz: -Math.sign(e.deltaY) * 0.5, ax: p.x, ay: p.y });
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (moved.current > 6) e.stopPropagation();
    },
  };
}

/** Adres blob kafelka, jeśli już pobrany (do rysowania w WebGL i podkładu z sąsiednich poziomów). */
export function cachedTile(key: string): string | undefined {
  const v = blobs.get(key);
  return typeof v === "string" ? v : undefined;
}
