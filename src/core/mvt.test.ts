import { describe, expect, it } from "vitest";
import { decodeMvt } from "./mvt";

/** Minimalny koder protobuf do testu: varint, pole z bajtami. */
const varint = (v: number) => { const out: number[] = []; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v); return out; };
const bytes = (field: number, b: number[]) => [...varint((field << 3) | 2), ...varint(b.length), ...b];
const str = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);
const zz = (v: number) => varint(v < 0 ? -2 * v - 1 : 2 * v);

describe("decodeMvt", () => {
  it("warstwa z linią i atrybutami", () => {
    // Feature: tags [0,0] (class=primary), type 2, geometria MoveTo(0,0) LineTo(10,5)
    // komenda = (liczba << 3) | id: MoveTo = 1, LineTo = 2, ClosePath = 7
    const geom = [...varint((1 << 3) | 1), ...zz(0), ...zz(0), ...varint((1 << 3) | 2), ...zz(10), ...zz(5)];
    const feature = [...bytes(2, [0, 0]), ...varint((3 << 3) | 0), 2, ...bytes(4, geom)];
    const value = str(1, "primary");
    const layer = [...varint((15 << 3) | 0), 2, ...str(1, "road"), ...bytes(2, feature), ...str(3, "class"), ...bytes(4, value), ...varint((5 << 3) | 0), ...varint(4096)];
    const tile = new Uint8Array(bytes(3, layer));
    const layers = decodeMvt(tile);
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe("road");
    expect(layers[0].features[0]).toEqual({ type: 2, props: { class: "primary" }, geom: [[0, 0, 10, 5]] });
  });
  it("wielokąt z ClosePath domyka pierścień", () => {
    const geom = [...varint((1 << 3) | 1), ...zz(1), ...zz(1), ...varint((2 << 3) | 2), ...zz(4), ...zz(0), ...zz(0), ...zz(4), ...varint((1 << 3) | 7)];
    const feature = [...varint((3 << 3) | 0), 3, ...bytes(4, geom)];
    const layer = [...str(1, "water"), ...bytes(2, feature)];
    const [l] = decodeMvt(new Uint8Array(bytes(3, layer)));
    expect(l.features[0].geom[0]).toEqual([1, 1, 5, 1, 5, 5, 1, 1]);
  });
});
