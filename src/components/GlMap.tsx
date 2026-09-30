import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cachedTile, LatLon, loadTile, TILE, worldPx } from "./MapView";
import { apiUrl } from "../api";
import { decodeMvt } from "../core/mvt";
import { MapPalette, MapTheme, PALETTES, ROAD_ORDER, roadWidth } from "../mapStyle";
import { Vehicle } from "../nav";
import { buildVectorTile, V_STRIDE, VLabel, VTileGeometry } from "./glVector";

// Mapa HUD w WebGL. Dwa źródła: własne kafelki wektorowe (OSM, styl RoadPilot — dzień / noc, zakazy dla pojazdu)
// albo kafelki rastrowe TomTom (poza Polską / bez własnych kafelków). Kamera z pochyleniem i obrotem w macierzy —
// rysuje wyłącznie karta graficzna: co klatkę jedna macierz i wywołania rysowania, nic nie jest ponownie rasteryzowane.
// Wcześniejsza wersja pochylała ogromną warstwę HTML (CSS 3D): Chrome na Androidzie nie nadążał jej rasteryzować
// (migotanie, niedomalowane karty), a Safari na iOS wyczerpywało pamięć.
// Znaczniki (etykiety, strzałki) to kilka elementów SVG w układzie ekranu, przestawianych co klatkę atrybutem transform.

export interface GlLine {
  pts: LatLon[];
  /** RGBA 0–1. */
  color: [number, number, number, number];
  /** Szerokość w px ekranu przy braku pochylenia (perspektywa zwęża linię w oddali — jak w nawigacjach). */
  widthPx: number;
}

export interface GlMarker {
  key: string;
  lat: number;
  lon: number;
  /** Obrót w stopniach na ekranie — dostaje bieżący kierunek mapy (np. strzałka znajomego: heading − bearing). */
  rotate?: (bearing: number) => number;
  /** Prostokąt etykiety (px) do unikania nachodzenia — etykieta nachodząca na wcześniejszą jest chowana. */
  box?: [number, number];
  node: ReactNode;
}

export interface GlVector {
  theme: MapTheme;
  /** Do zakazów: drogi, których pojazd nie spełnia, na czerwono. */
  vehicle: Vehicle;
}

export interface GlMapProps {
  token: string;
  center: LatLon;
  zoom: number;
  bearing?: number;
  pitch?: number;
  anchorY?: number;
  lines: GlLine[];
  markers: GlMarker[];
  /** Pozycja „na teraz” w każdej klatce (przewidywana między odczytami GPS). */
  follow?: () => { lat: number; lon: number; bearing?: number } | undefined;
  /** Własny styl z kafelków wektorowych; brak = kafelki TomTom. */
  vector?: GlVector;
  children?: ReactNode;
}

/** Tyle kafelków trzymamy na karcie graficznej (tekstur albo buforów). */
const TEX_MAX = 160;
/** Ekrany o dużej gęstości: 2× wystarcza, 3× to 2,25× więcej pikseli do wypełnienia. */
const MAX_DPR = 2;
/** Najwyższy poziom własnych kafelków (tilemaker) — wyżej skalujemy je w górę. */
const VT_MAX_Z = 14;
const VT_MIN_Z = 6;
/** Ile etykiet naraz (najbliższe środka, miasta przed wsiami, ulice na końcu). */
const LABELS_MAX = 34;
/** Nazwy ulic dopiero od tego zoomu. */
const STREETS_FROM_ZOOM = 15;

const VS = `
attribute vec2 a_pos;
attribute vec2 a_norm;
attribute float a_dist;
uniform mat4 u_m;
uniform vec4 u_rect;
uniform float u_hw;
uniform float u_scale;
varying vec2 v_uv;
varying float v_dist;
void main() {
  v_uv = a_pos;
  vec2 p = u_rect.xy + a_pos * u_rect.zw + a_norm * (u_hw / u_scale);
  v_dist = a_dist * u_rect.z * u_scale;
  gl_Position = u_m * vec4(p, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec4 u_color;
uniform vec4 u_color2;
uniform float u_dash;
uniform float u_dashOn;
uniform float u_useTex;
varying vec2 v_uv;
varying float v_dist;
void main() {
  vec4 c = u_color;
  if (u_dash > 0.0 && mod(v_dist, u_dash) > u_dashOn) c = u_color2;
  vec4 t = texture2D(u_tex, v_uv);
  gl_FragColor = mix(c, t, u_useTex);
}`;

type Mat = Float32Array;
const I = (): Mat => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** a·b (kolumnowo, jak w WebGL). */
function mul(a: Mat, b: Mat): Mat {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
const translate = (x: number, y: number) => { const m = I(); m[12] = x; m[13] = y; return m; };
const scaleM = (s: number) => { const m = I(); m[0] = s; m[5] = s; return m; };
/** Jak CSS rotateX: góra ekranu (y < 0) odchyla się w głąb. */
const rotateX = (deg: number) => { const m = I(); const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
/** Jak CSS rotate (zgodnie z ruchem wskazówek przy y w dół). */
const rotateZ = (deg: number) => { const m = I(); const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; };
/** Jak CSS perspective(p): w = 1 − z/p. */
const perspective = (p: number) => { const m = I(); m[11] = -1 / p; return m; };
/** Piksele ekranu (y w dół) → clip space; z zerujemy (bez bufora głębi). */
const toClip = (w: number, h: number) => { const m = I(); m[0] = 2 / w; m[5] = -2 / h; m[10] = 0; m[12] = -1; m[13] = 1; return m; };

interface Cam {
  /** Macierz: piksele poziomu z względem punktu odniesienia → clip. */
  m: Mat;
  w: number;
  h: number;
}

/** Ta sama kamera co dawniej w CSS: translate(ax, ay) rotateX(pitch) rotate(−bearing) translate(−pozycja) scale. */
function camera(w: number, h: number, ax: number, ay: number, pitch: number, bearing: number, dx: number, dy: number, scale: number): Cam {
  let m = mul(toClip(w, h), translate(ax, ay));
  if (pitch > 0) m = mul(m, perspective(h * 1.05));
  m = mul(m, rotateX(pitch));
  m = mul(m, rotateZ(-bearing));
  m = mul(m, translate(-dx, -dy));
  m = mul(m, scaleM(scale));
  return { m, w, h };
}

/** Punkt (px poziomu z względem odniesienia) → piksele ekranu; undefined za kamerą. */
function project(c: Cam, x: number, y: number): [number, number] | undefined {
  const m = c.m;
  const cx = m[0] * x + m[4] * y + m[12];
  const cy = m[1] * x + m[5] * y + m[13];
  const cw = m[3] * x + m[7] * y + m[15];
  if (cw <= 0.01) return undefined;
  return [((cx / cw + 1) / 2) * c.w, ((1 - cy / cw) / 2) * c.h];
}

/** Linie z aplikacji (trasa, korki) → trójkąty w formacie [x, y, nx, ny, d]; szerokość nadaje shader. */
function buildLines(lines: GlLine[], z: number, cx: number, cy: number): { data: Float32Array; ranges: { start: number; count: number; color: GlLine["color"]; widthPx: number }[] } {
  const out: number[] = [];
  const ranges: { start: number; count: number; color: GlLine["color"]; widthPx: number }[] = [];
  for (const l of lines) {
    const start = out.length / V_STRIDE;
    const pts = l.pts.map((p) => { const [x, y] = worldPx(p, z); return [x - cx, y - cy]; });
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      out.push(x0, y0, nx, ny, 0, x0, y0, -nx, -ny, 0, x1, y1, nx, ny, 0, x1, y1, nx, ny, 0, x0, y0, -nx, -ny, 0, x1, y1, -nx, -ny, 0);
      if (i < pts.length - 1) {
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
          out.push(x1, y1, 0, 0, 0, x1, y1, Math.cos(a0), Math.sin(a0), 0, x1, y1, Math.cos(a1), Math.sin(a1), 0);
        }
      }
    }
    ranges.push({ start, count: out.length / V_STRIDE - start, color: l.color, widthPx: l.widthPx });
  }
  return { data: new Float32Array(out), ranges };
}

interface TileRect { k: string; lz: number; x: number; y: number; size: number; d: number }

interface VTileGpu { buf: WebGLBuffer; batches: VTileGeometry["batches"]; labels: VLabel[] }

const LABEL_RANK: Record<VLabel["kind"], number> = { city: 0, town: 1, ref: 2, village: 3, hamlet: 4, street: 5 };
/** Kąt etykiety wzdłuż drogi na ekranie: zawsze czytelny (nigdy do góry nogami). */
const readable = (deg: number) => { let a = ((deg % 360) + 540) % 360 - 180; if (a > 90) a -= 180; if (a < -90) a += 180; return a; };

export function GlMapView({ token, center, zoom, bearing = 0, pitch = 0, anchorY = 0.5, lines, markers, follow, vector, children }: GlMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  // Rośnie, gdy dojdzie kafelek wektorowy — wtedy przeliczamy etykiety.
  const [tileGen, setTileGen] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const z = Math.max(3, Math.min(18, Math.floor(zoom)));
  const scale = 2 ** (zoom - z);
  const [pxX, pxY] = worldPx(center, z);
  // Zasięg kafelków: przy pochyleniu daleki pas u góry zakrywa „niebo” (CSS), a pod kafelkami leży „ziemia”.
  const reach = Math.hypot(size.w, size.h) * (pitch > 0 ? 1.8 : 0.75);
  const half = reach / scale;
  // Punkt odniesienia współrzędnych (małe liczby dla float32) — przenoszony, gdy odjedziemy o ćwierć zasięgu.
  const origin = useRef<{ z: number; x: number; y: number } | null>(null);
  const o = origin.current;
  if (!o || o.z !== z || Math.hypot(pxX - o.x, pxY - o.y) > half / 4) origin.current = { z, x: pxX, y: pxY };
  const { x: cx, y: cy } = origin.current!;

  /** Kafelki poziomu `lz` w zasięgu (koło, nie kwadrat), od najbliższych; położenie w px poziomu z względem odniesienia. */
  const level = (lz: number, cachedOnly: boolean): TileRect[] => {
    const f = 2 ** (z - lz);
    const tsize = TILE * f;
    const n = 2 ** lz;
    const out: TileRect[] = [];
    for (let ty = Math.floor((pxY - half) / tsize); ty <= Math.floor((pxY + half) / tsize); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor((pxX - half) / tsize); tx <= Math.floor((pxX + half) / tsize); tx++) {
        const x = tx * tsize - pxX;
        const y = ty * tsize - pxY;
        const d = Math.hypot(Math.max(x, Math.min(0, x + tsize)), Math.max(y, Math.min(0, y + tsize)));
        if (d > half) continue;
        const k = `${lz}/${((tx % n) + n) % n}/${ty}`;
        if (cachedOnly && !cachedTile(k)) continue;
        out.push({ k, lz, x: tx * tsize - cx, y: ty * tsize - cy, size: tsize, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  };
  const vz = Math.max(VT_MIN_Z, Math.min(VT_MAX_Z, z));
  const tiles = vector ? level(vz, false) : level(z, false);
  const backdrop = vector ? [] : [...(z > 3 ? level(z - 1, true) : []), ...(z < 18 ? level(z + 1, true).slice(0, 120) : [])];
  const geometry = useMemo(() => buildLines(lines, z, cx, cy), [lines, z, cx, cy]);
  const palette: MapPalette = PALETTES[vector?.theme ?? "night"];
  const vehicleKey = vector ? JSON.stringify(vector.vehicle) : "";

  // Kafelki wektorowe na GPU: klucz → bufor + partie + etykiety; „loading” w trakcie pobierania, null = pusty.
  const vtiles = useRef(new Map<string, VTileGpu | "loading" | null>());
  // Zmiana pojazdu zmienia, które drogi są zakazami — kafelki trzeba zbudować od nowa.
  const vehicleRef = useRef(vehicleKey);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  if (vehicleRef.current !== vehicleKey) {
    vehicleRef.current = vehicleKey;
    const gl = glRef.current;
    for (const v of vtiles.current.values()) if (v && v !== "loading" && gl) gl.deleteBuffer(v.buf);
    vtiles.current.clear();
  }

  // Etykiety z widocznych kafelków: najbliższe środka, bez powtórzeń nazw, miasta przed wsiami.
  const vlabels = useMemo<GlMarker[]>(() => {
    if (!vector) return [];
    const f = 2 ** (z - vz);
    const cand: { m: GlMarker; rank: number; d: number }[] = [];
    const seen = new Set<string>();
    for (const t of tiles) {
      const vt = vtiles.current.get(t.k);
      if (!vt || vt === "loading") continue;
      for (const l of vt.labels) {
        if (l.kind === "street" && zoom < STREETS_FROM_ZOOM) continue;
        const id = l.kind === "street" ? `${l.kind}:${l.text}:${t.k}` : `${l.kind}:${l.text}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const x = t.x + l.x * f, y = t.y + l.y * f;
        const d = Math.hypot(x - (pxX - cx), y - (pxY - cy));
        // Punkt → współrzędne geograficzne przez odwrotność worldPx nie jest potrzebny: markery przyjmują lat/lon,
        // więc liczymy je z px poziomu z.
        const n = TILE * 2 ** z;
        const lon = ((x + cx) / n) * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + cy)) / n))) * 180) / Math.PI;
        const w = l.text.length * (l.kind === "ref" ? 8 : l.kind === "street" ? 6.6 : 7.5) + 12;
        const node = l.kind === "ref"
          ? <g className="vl-ref"><rect x={-w / 2} y={-10} width={w} height={20} rx={4} /><text y={5}>{l.text}</text></g>
          : l.kind === "street"
            ? <text className="vl-street" y={-4}>{l.text}</text>
            : <text className={`vl-place vl-${l.kind}`}>{l.text}</text>;
        const angle = l.angle;
        const rotate = l.kind === "street" && angle !== undefined ? (b: number) => readable(angle - b) : undefined;
        cand.push({ m: { key: `vl:${id}`, lat, lon, node, rotate, box: [w, l.kind === "ref" ? 22 : 18] }, rank: LABEL_RANK[l.kind], d });
      }
    }
    return cand.sort((a, b) => a.rank - b.rank || a.d - b.d).slice(0, LABELS_MAX).map((c) => c.m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vector?.theme, tileGen, tiles.map((t) => t.k).join(","), z, cx, cy, zoom >= STREETS_FROM_ZOOM]);
  const allMarkers = vector ? [...vlabels, ...markers] : markers;
  const markerPx = useMemo(() => allMarkers.map((m) => { const [x, y] = worldPx(m, z); return { m, x: x - cx, y: y - cy }; }), [allMarkers, z, cx, cy]);

  // Wszystko, czego pętla klatek potrzebuje, w jednym ref — render Reacta tylko go podmienia.
  const frame = useRef({ token, size, z, vz, scale, cx, cy, pxX, pxY, pitch, bearing, anchorY, tiles, backdrop, geometry, markerPx, follow, vector, palette, half, zoom });
  frame.current = { token, size, z, vz, scale, cx, cy, pxX, pxY, pitch, bearing, anchorY, tiles, backdrop, geometry, markerPx, follow, vector, palette, half, zoom };
  const markerEls = useRef(new Map<string, SVGGElement>());
  const bump = useRef(() => setTileGen((g) => g + 1)).current;

  useEffect(() => {
    const cv = canvas.current!;
    const gl = cv.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: true });
    if (!gl) return;
    glRef.current = gl;
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    const aNorm = gl.getAttribLocation(prog, "a_norm");
    const aDist = gl.getAttribLocation(prog, "a_dist");
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uM = u("u_m"), uRect = u("u_rect"), uColor = u("u_color"), uColor2 = u("u_color2"), uDash = u("u_dash"), uDashOn = u("u_dashOn"), uUseTex = u("u_useTex"), uHw = u("u_hw"), uScale = u("u_scale");
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0]), gl.STATIC_DRAW);
    const lineBuf = gl.createBuffer()!;
    let lineData: Float32Array | null = null;
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aNorm);
    gl.enableVertexAttribArray(aDist);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const bind = (buf: WebGLBuffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const B = V_STRIDE * 4;
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, B, 0);
      gl.vertexAttribPointer(aNorm, 2, gl.FLOAT, false, B, 8);
      gl.vertexAttribPointer(aDist, 1, gl.FLOAT, false, B, 16);
    };
    const color = (loc: WebGLUniformLocation | null, c: [number, number, number, number]) => gl.uniform4f(loc, c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]);

    // Tekstury kafelków rastrowych: klucz → tekstura albo "loading"; LRU do TEX_MAX.
    const tex = new Map<string, WebGLTexture | "loading">();
    const ensureTex = (k: string, tok: string) => {
      const have = tex.get(k);
      if (have) return have === "loading" ? null : have;
      tex.set(k, "loading");
      const onUrl = (url: string | null) => {
        if (!url) { tex.delete(k); return; }
        const img = new Image();
        img.onload = () => {
          if (!tex.has(k)) return;
          const t = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          tex.delete(k);
          tex.set(k, t);
          while (tex.size > TEX_MAX) {
            const [old, v] = tex.entries().next().value!;
            if (v !== "loading") gl.deleteTexture(v);
            tex.delete(old);
          }
        };
        img.onerror = () => tex.delete(k);
        img.src = url;
      };
      const url = loadTile(k, tok);
      if (typeof url === "string") onUrl(url);
      else if (url) url.then(onUrl);
      else tex.delete(k);
      return null;
    };

    // Kafelki wektorowe: pobranie (z tokenem), dekodowanie, geometria dla pojazdu, bufor na GPU; LRU do TEX_MAX.
    const ensureVec = (k: string, tok: string, vehicle: Vehicle) => {
      const have = vtiles.current.get(k);
      if (have !== undefined) return have === "loading" ? null : have;
      vtiles.current.set(k, "loading");
      const key = vehicleRef.current;
      fetch(apiUrl(`/vtiles/${k}`), { headers: { Authorization: `Bearer ${tok}` } })
        .then(async (r) => {
          if (r.status === 204 || r.status === 404) return null;
          if (!r.ok) throw new Error(String(r.status));
          return buildVectorTile(decodeMvt(await r.arrayBuffer()), vehicle);
        })
        .then((g) => {
          if (vehicleRef.current !== key || vtiles.current.get(k) !== "loading") return;
          if (!g || !g.data.length) { vtiles.current.set(k, null); return; }
          const buf = gl.createBuffer()!;
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW);
          vtiles.current.delete(k);
          vtiles.current.set(k, { buf, batches: g.batches, labels: g.labels });
          while (vtiles.current.size > TEX_MAX) {
            const [old, v] = vtiles.current.entries().next().value!;
            if (v && v !== "loading") gl.deleteBuffer(v.buf);
            vtiles.current.delete(old);
          }
          if (g.labels.length) bump();
        })
        .catch(() => vtiles.current.delete(k)); // brak sieci — spróbujemy przy następnym ruchu
      return null;
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const f = frame.current;
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const W = Math.round(f.size.w * dpr), H = Math.round(f.size.h * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      const now = f.follow?.();
      const [nx, ny] = now ? worldPx(now, f.z) : [f.pxX, f.pxY];
      const b = now?.bearing ?? f.bearing;
      const cam = camera(f.size.w, f.size.h, f.size.w / 2, f.size.h * f.anchorY, f.pitch, b, (nx - f.cx) * f.scale, (ny - f.cy) * f.scale, f.scale);
      gl.uniformMatrix4fv(uM, false, cam.m);
      gl.uniform1f(uScale, f.scale);
      gl.uniform1f(uDash, 0);
      gl.uniform1f(uHw, 0);

      // „Ziemia” w kolorze mapy daleko poza kafelkami — przy pochyleniu daleki pas to jednolity kolor pod mgłą.
      bind(quad);
      gl.uniform1f(uUseTex, 0);
      color(uColor, f.palette.ground);
      const far = f.half * 12;
      gl.uniform4f(uRect, f.pxX - f.cx - far, f.pxY - f.cy - far, far * 2, far * 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (f.vector) {
        const p = f.palette;
        const fz = 2 ** (f.z - f.vz);
        const ready: { t: TileRect; vt: VTileGpu }[] = [];
        for (const t of f.tiles) {
          const vt = ensureVec(t.k, f.token, f.vector.vehicle);
          if (vt) ready.push({ t, vt });
        }
        // Kolejność warstw: najpierw wszystkie kafelki jednej warstwy, potem następna — bez szwów na granicach kafelków.
        type Pass = { key: string; color: [number, number, number, number]; hw: number; color2?: [number, number, number, number]; dash?: number; dashOn?: number };
        const passes: Pass[] = [
          { key: "landuse:wood", color: p.landuse.wood, hw: 0 }, { key: "landuse:grass", color: p.landuse.grass, hw: 0 },
          { key: "landuse:residential", color: p.landuse.residential, hw: 0 }, { key: "landuse:industrial", color: p.landuse.industrial, hw: 0 },
          { key: "water", color: p.water, hw: 0 }, { key: "building", color: p.building, hw: 0 },
          { key: "waterway", color: p.waterway, hw: Math.max(1, roadWidth("secondary", f.zoom) * 0.6) },
          { key: "railway", color: p.railway, hw: 1 },
        ];
        for (const cls of ROAD_ORDER) passes.push({ key: `casing:${cls}`, color: p.casing, hw: roadWidth(cls, f.zoom) / 2 + 1 });
        for (const cls of ROAD_ORDER) {
          const hw = roadWidth(cls, f.zoom) / 2;
          passes.push({ key: `road:${cls}`, color: p.road[cls], hw });
          passes.push({ key: `ban:limit:${cls}`, color: p.banA, hw, color2: p.banB, dash: 16, dashOn: 11 });
          passes.push({ key: `ban:ban:${cls}`, color: p.banA, hw, color2: p.banB, dash: 20, dashOn: 10 });
        }
        for (const pass of passes) {
          color(uColor, pass.color);
          gl.uniform1f(uHw, pass.hw);
          if (pass.dash) { color(uColor2, pass.color2!); gl.uniform1f(uDash, pass.dash); gl.uniform1f(uDashOn, pass.dashOn!); } else gl.uniform1f(uDash, 0);
          const isFill = pass.hw === 0;
          for (const { t, vt } of ready) {
            const batch = vt.batches.find((x) => x.key === pass.key);
            if (!batch) continue;
            bind(vt.buf);
            gl.uniform4f(uRect, t.x, t.y, fz, fz);
            if (!isFill) { gl.drawArrays(gl.TRIANGLES, batch.start, batch.count); continue; }
            // Wypełnienie przez szablon: wachlarze odwracają bit (parzystość), potem kolor tam, gdzie bit = 1 (i zerowanie).
            gl.enable(gl.STENCIL_TEST);
            gl.colorMask(false, false, false, false);
            // INVERT odwraca wszystkie bity maski — ograniczamy ją do jednego bitu, żeby porównanie z 1 działało.
            gl.stencilMask(0x1);
            gl.stencilFunc(gl.ALWAYS, 0, 0x1);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
            gl.drawArrays(gl.TRIANGLES, batch.start, batch.count);
            gl.colorMask(true, true, true, true);
            gl.stencilFunc(gl.EQUAL, 1, 0x1);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
            bind(quad);
            gl.uniform4f(uRect, t.x, t.y, TILE * fz, TILE * fz);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.disable(gl.STENCIL_TEST);
          }
        }
        gl.uniform1f(uDash, 0);
      } else {
        // Kafelki rastrowe: podkład z sąsiednich poziomów, potem bieżący poziom (od najbliższych).
        bind(quad);
        gl.uniform1f(uUseTex, 1);
        for (const t of [...f.backdrop, ...f.tiles]) {
          const tx = ensureTex(t.k, f.token);
          if (!tx) continue;
          tex.delete(t.k);
          tex.set(t.k, tx);
          gl.bindTexture(gl.TEXTURE_2D, tx);
          gl.uniform4f(uRect, t.x, t.y, t.size, t.size);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.uniform1f(uUseTex, 0);
      }

      // Linie z aplikacji (trasa, korki) — bufor podmieniany tylko, gdy geometria się zmieni.
      gl.uniform4f(uRect, 0, 0, 1, 1);
      bind(lineBuf);
      if (lineData !== f.geometry.data) {
        lineData = f.geometry.data;
        gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.DYNAMIC_DRAW);
      }
      for (const r of f.geometry.ranges) {
        color(uColor, r.color);
        gl.uniform1f(uHw, r.widthPx / 2);
        gl.drawArrays(gl.TRIANGLES, r.start, r.count);
      }

      // Znaczniki: kilka elementów SVG w układzie ekranu. Etykiety z prostokątem: nachodząca na wcześniejszą — chowana.
      const placed: [number, number, number, number][] = [];
      for (const { m, x, y } of f.markerPx) {
        const el = markerEls.current.get(m.key);
        if (!el) continue;
        const pt = project(cam, x, y);
        if (!pt) { el.setAttribute("display", "none"); continue; }
        const rot = m.rotate ? m.rotate(b) : 0;
        if (m.box) {
          // Obrócona etykieta: przybliżamy prostokąt osiowy (zamiana boków powyżej 45°).
          const swap = Math.abs(rot) > 45;
          const bw = swap ? m.box[1] : m.box[0], bh = swap ? m.box[0] : m.box[1];
          const r: [number, number, number, number] = [pt[0] - bw / 2, pt[1] - bh, pt[0] + bw / 2, pt[1] + bh / 2];
          if (r[2] < 0 || r[0] > f.size.w || r[3] < 0 || r[1] > f.size.h || placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) { el.setAttribute("display", "none"); continue; }
          placed.push(r);
        }
        el.removeAttribute("display");
        el.setAttribute("transform", `translate(${pt[0].toFixed(1)} ${pt[1].toFixed(1)})${m.rotate ? ` rotate(${rot.toFixed(1)})` : ""}`);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const v of tex.values()) if (v !== "loading") gl.deleteTexture(v);
      for (const v of vtiles.current.values()) if (v && v !== "loading") gl.deleteBuffer(v.buf);
      vtiles.current.clear();
      glRef.current = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={box} className={`gl-map ${vector ? `theme-${vector.theme}` : ""}`} style={{ "--label": palette.labelText, "--halo": palette.labelHalo } as React.CSSProperties}>
      <canvas ref={canvas} className="gl-canvas" />
      <svg className="gl-markers" aria-hidden>
        {allMarkers.map((m) => (
          <g key={m.key} ref={(el) => { if (el) markerEls.current.set(m.key, el); else markerEls.current.delete(m.key); }} display="none">
            {m.node}
          </g>
        ))}
      </svg>
      {children}
      <span className="map-credit">{vector ? "© OpenStreetMap" : "© TomTom"}</span>
    </div>
  );
}
