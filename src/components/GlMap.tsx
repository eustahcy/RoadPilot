import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cachedTile, LatLon, loadTile, TILE, worldPx } from "./MapView";

// Mapa HUD w WebGL: kafelki jako tekstury, trasa jako trójkąty, kamera z pochyleniem i obrotem w macierzy.
// Wcześniejsza wersja pochylała ogromną warstwę HTML z setkami <img> (CSS 3D) — Chrome na Androidzie nie nadążał jej
// rasteryzować, gdy ruszała się co klatkę (migotanie, niedomalowane karty), a Safari na iOS wyczerpywało pamięć.
// Tu rysuje wyłącznie karta graficzna: co klatkę jedna macierz i kilkadziesiąt wywołań rysowania, nic nie jest
// ponownie rasteryzowane. Znaczniki (etykiety, strzałki) to kilka elementów SVG w układzie ekranu, przestawianych
// co klatkę atrybutem transform.

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
  node: ReactNode;
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
  children?: ReactNode;
}

/** Tyle kafelków (tekstur) trzymamy na karcie graficznej. */
const TEX_MAX = 160;
/** Ekrany o dużej gęstości: 2× wystarcza, 3× to 2,25× więcej pikseli do wypełnienia. */
const MAX_DPR = 2;

const VS = `
attribute vec2 a_pos;
uniform mat4 u_m;
uniform vec4 u_rect;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  gl_Position = u_m * vec4(p, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec4 u_color;
uniform float u_useTex;
varying vec2 v_uv;
void main() {
  vec4 t = texture2D(u_tex, v_uv);
  gl_FragColor = mix(u_color, t, u_useTex);
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

/** Polilinia → trójkąty (prostokąt na odcinek + koło na złączeniu, żeby zakręty nie miały wcięć). */
function buildLines(lines: GlLine[], z: number, cx: number, cy: number, scale: number): { data: Float32Array; ranges: { start: number; count: number; color: [number, number, number, number] }[] } {
  const out: number[] = [];
  const ranges: { start: number; count: number; color: GlLine["color"] }[] = [];
  for (const l of lines) {
    const start = out.length / 2;
    const hw = l.widthPx / 2 / scale;
    const pts = l.pts.map((p) => { const [x, y] = worldPx(p, z); return [x - cx, y - cy]; });
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * hw, ny = (dx / len) * hw;
      out.push(x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 + nx, y1 + ny, x1 + nx, y1 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny);
      if (i < pts.length - 1) {
        // Złączenie: 8 trójkątów koła o promieniu hw.
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
          out.push(x1, y1, x1 + Math.cos(a0) * hw, y1 + Math.sin(a0) * hw, x1 + Math.cos(a1) * hw, y1 + Math.sin(a1) * hw);
        }
      }
    }
    ranges.push({ start, count: out.length / 2 - start, color: l.color });
  }
  return { data: new Float32Array(out), ranges };
}

interface TileRect { k: string; x: number; y: number; size: number; d: number }

export function GlMapView({ token, center, zoom, bearing = 0, pitch = 0, anchorY = 0.5, lines, markers, follow, children }: GlMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
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
  // Zasięg kafelków: przy pochyleniu daleki pas u góry zakrywa „niebo” (CSS), więc 1,8 przekątnej wystarcza.
  const reach = Math.hypot(size.w, size.h) * (pitch > 0 ? 1.8 : 0.75);
  const half = reach / scale;
  // Punkt odniesienia współrzędnych (małe liczby dla float32) — przenoszony, gdy odjedziemy o ćwierć zasięgu.
  const origin = useRef<{ z: number; x: number; y: number } | null>(null);
  const o = origin.current;
  if (!o || o.z !== z || Math.hypot(pxX - o.x, pxY - o.y) > half / 4) origin.current = { z, x: pxX, y: pxY };
  const { x: cx, y: cy } = origin.current!;

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
        out.push({ k, x: tx * tsize - cx, y: ty * tsize - cy, size: tsize, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  };
  const tiles = level(z, false);
  const backdrop = [...(z > 3 ? level(z - 1, true) : []), ...(z < 18 ? level(z + 1, true).slice(0, 120) : [])];
  const geometry = useMemo(() => buildLines(lines, z, cx, cy, scale), [lines, z, cx, cy, scale]);
  const markerPx = useMemo(() => markers.map((m) => { const [x, y] = worldPx(m, z); return { m, x: x - cx, y: y - cy }; }), [markers, z, cx, cy]);

  // Wszystko, czego pętla klatek potrzebuje, w jednym ref — render Reacta tylko go podmienia.
  const frame = useRef({ token, size, z, scale, cx, cy, pxX, pxY, pitch, bearing, anchorY, tiles, backdrop, geometry, markerPx, follow });
  frame.current = { token, size, z, scale, cx, cy, pxX, pxY, pitch, bearing, anchorY, tiles, backdrop, geometry, markerPx, follow };
  const markerEls = useRef(new Map<string, SVGGElement>());

  useEffect(() => {
    const cv = canvas.current!;
    const gl = cv.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) return;
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
    const uM = gl.getUniformLocation(prog, "u_m");
    const uRect = gl.getUniformLocation(prog, "u_rect");
    const uColor = gl.getUniformLocation(prog, "u_color");
    const uUseTex = gl.getUniformLocation(prog, "u_useTex");
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const lineBuf = gl.createBuffer()!;
    let lineData: Float32Array | null = null;
    gl.enableVertexAttribArray(aPos);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    // Tekstury kafelków: klucz → tekstura albo "loading"; LRU do TEX_MAX.
    const tex = new Map<string, WebGLTexture | "loading">();
    const ensure = (k: string, tok: string) => {
      const have = tex.get(k);
      if (have) return have === "loading" ? null : have;
      tex.set(k, "loading");
      const url = loadTile(k, tok);
      const onUrl = (u: string | null) => {
        if (!u) { tex.delete(k); return; }
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
        img.src = u;
      };
      if (typeof url === "string") onUrl(url);
      else if (url) url.then(onUrl);
      else tex.delete(k);
      return null;
    };
    const touch = (k: string, t: WebGLTexture) => { tex.delete(k); tex.set(k, t); };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const f = frame.current;
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const W = Math.round(f.size.w * dpr), H = Math.round(f.size.h * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const now = f.follow?.();
      const [nx, ny] = now ? worldPx(now, f.z) : [f.pxX, f.pxY];
      const b = now?.bearing ?? f.bearing;
      const cam = camera(f.size.w, f.size.h, f.size.w / 2, f.size.h * f.anchorY, f.pitch, b, (nx - f.cx) * f.scale, (ny - f.cy) * f.scale, f.scale);
      gl.uniformMatrix4fv(uM, false, cam.m);

      // Kafelki: podkład z sąsiednich poziomów, potem bieżący poziom (od najbliższych).
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uUseTex, 1);
      for (const t of [...f.backdrop, ...f.tiles]) {
        const tx = ensure(t.k, f.token);
        if (!tx) continue;
        touch(t.k, tx);
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.uniform4f(uRect, t.x, t.y, t.size, t.size);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // Linie (trasa, korki) — bufor podmieniany tylko, gdy geometria się zmieni.
      gl.uniform1f(uUseTex, 0);
      gl.uniform4f(uRect, 0, 0, 1, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      if (lineData !== f.geometry.data) {
        lineData = f.geometry.data;
        gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.DYNAMIC_DRAW);
      }
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      for (const r of f.geometry.ranges) {
        const [cr, cg, cb, ca] = r.color;
        gl.uniform4f(uColor, cr * ca, cg * ca, cb * ca, ca);
        gl.drawArrays(gl.TRIANGLES, r.start, r.count);
      }

      // Znaczniki: kilka elementów SVG w układzie ekranu.
      for (const { m, x, y } of f.markerPx) {
        const el = markerEls.current.get(m.key);
        if (!el) continue;
        const p = project(cam, x, y);
        if (!p) { el.setAttribute("display", "none"); continue; }
        el.removeAttribute("display");
        el.setAttribute("transform", `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})${m.rotate ? ` rotate(${m.rotate(b).toFixed(1)})` : ""}`);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const v of tex.values()) if (v !== "loading") gl.deleteTexture(v);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div ref={box} className="gl-map">
      <canvas ref={canvas} className="gl-canvas" />
      <svg ref={svg} className="gl-markers" aria-hidden>
        {markers.map((m) => (
          <g key={m.key} ref={(el) => { if (el) markerEls.current.set(m.key, el); else markerEls.current.delete(m.key); }} display="none">
            {m.node}
          </g>
        ))}
      </svg>
      {children}
      <span className="map-credit">© TomTom</span>
    </div>
  );
}
