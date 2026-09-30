// Dekoder kafelków wektorowych (Mapbox Vector Tile, protobuf) — bez zależności. Tylko to, czego potrzebuje
// własny styl mapy: warstwy, typ geometrii, atrybuty i współrzędne w jednostkach kafelka (0…extent).

export interface MvtFeature {
  type: 1 | 2 | 3; // 1 = punkt, 2 = linia, 3 = wielokąt
  props: Record<string, string | number | boolean>;
  /** Pierścienie / linie: tablice [x0, y0, x1, y1, …] w jednostkach kafelka. */
  geom: number[][];
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

class Reader {
  pos = 0;
  constructor(public buf: Uint8Array) {}
  varint(): number {
    let r = 0, shift = 0, b: number;
    do {
      b = this.buf[this.pos++];
      // Powyżej 2^31 zwykłe przesunięcia bitowe się psują — mnożenie zamiast <<.
      r += shift < 28 ? (b & 0x7f) << shift : (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b >= 0x80);
    return r;
  }
  zigzag(): number {
    const v = this.varint();
    return v % 2 === 1 ? -(v + 1) / 2 : v / 2;
  }
  bytes(): Uint8Array {
    const n = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.bytes());
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`MVT: nieznany typ pola ${wire}`);
  }
  f32(): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }
}

function readValue(buf: Uint8Array): string | number | boolean {
  const r = new Reader(buf);
  let v: string | number | boolean = "";
  while (r.pos < buf.length) {
    const tag = r.varint();
    const field = tag >> 3, wire = tag & 7;
    if (field === 1) v = r.string();
    else if (field === 2) v = r.f32();
    else if (field === 3) v = r.f64();
    else if (field === 4 || field === 5) v = r.varint();
    else if (field === 6) v = r.zigzag();
    else if (field === 7) v = r.varint() !== 0;
    else r.skip(wire);
  }
  return v;
}

/** Komendy geometrii: MoveTo (1), LineTo (2), ClosePath (7); współrzędne to delty zigzag. */
function readGeometry(buf: Uint8Array): number[][] {
  const r = new Reader(buf);
  const out: number[][] = [];
  let cur: number[] | null = null;
  let x = 0, y = 0;
  while (r.pos < buf.length) {
    const c = r.varint();
    const cmd = c & 7, n = c >> 3;
    if (cmd === 1) {
      for (let i = 0; i < n; i++) {
        x += r.zigzag();
        y += r.zigzag();
        cur = [x, y];
        out.push(cur);
      }
    } else if (cmd === 2) {
      for (let i = 0; i < n; i++) {
        x += r.zigzag();
        y += r.zigzag();
        cur!.push(x, y);
      }
    } else if (cmd === 7) {
      if (cur && cur.length >= 2) cur.push(cur[0], cur[1]);
    } else throw new Error(`MVT: nieznana komenda ${cmd}`);
  }
  return out;
}

function readLayer(buf: Uint8Array): MvtLayer {
  const r = new Reader(buf);
  const layer: MvtLayer = { name: "", extent: 4096, features: [] };
  const keys: string[] = [];
  const values: (string | number | boolean)[] = [];
  const raw: Uint8Array[] = [];
  while (r.pos < buf.length) {
    const tag = r.varint();
    const field = tag >> 3, wire = tag & 7;
    if (field === 1) layer.name = r.string();
    else if (field === 2) raw.push(r.bytes());
    else if (field === 3) keys.push(r.string());
    else if (field === 4) values.push(readValue(r.bytes()));
    else if (field === 5) layer.extent = r.varint();
    else r.skip(wire);
  }
  for (const fb of raw) {
    const fr = new Reader(fb);
    const f: MvtFeature = { type: 2, props: {}, geom: [] };
    while (fr.pos < fb.length) {
      const tag = fr.varint();
      const field = tag >> 3, wire = tag & 7;
      if (field === 2) {
        const tb = fr.bytes();
        const tr = new Reader(tb);
        while (tr.pos < tb.length) {
          const k = keys[tr.varint()], v = values[tr.varint()];
          if (k !== undefined && v !== undefined) f.props[k] = v;
        }
      } else if (field === 3) f.type = fr.varint() as MvtFeature["type"];
      else if (field === 4) f.geom = readGeometry(fr.bytes());
      else fr.skip(wire);
    }
    layer.features.push(f);
  }
  return layer;
}

export function decodeMvt(data: ArrayBuffer | Uint8Array): MvtLayer[] {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(buf);
  const layers: MvtLayer[] = [];
  while (r.pos < buf.length) {
    const tag = r.varint();
    const field = tag >> 3, wire = tag & 7;
    if (field === 3) layers.push(readLayer(r.bytes()));
    else r.skip(wire);
  }
  return layers;
}
