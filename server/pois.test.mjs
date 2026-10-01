import { describe, expect, it } from "vitest";
import { poiRow, routePois } from "./pois.mjs";

describe("poiRow", () => {
  it("stacja paliw z punktu", () => {
    expect(poiRow({ id: "n1", properties: { amenity: "fuel", brand: "Orlen", "fuel:HGV_diesel": "yes" }, geometry: { type: "Point", coordinates: [19.1, 52.2] } })).toEqual({
      osmId: "n1", kind: "fuel", lat: 52.2, lon: 19.1, name: "Orlen", truck: 1,
    });
  });
  it("MOP z wielokąta — środek obrysu", () => {
    const r = poiRow({ id: "w2", properties: { highway: "rest_area", name: "MOP Wiśniowa Góra" }, geometry: { type: "Polygon", coordinates: [[[19, 52], [19.002, 52], [19.002, 52.002], [19, 52.002], [19, 52]]] } });
    expect(r).toMatchObject({ kind: "mop", lat: 52.001, lon: 19.001, truck: 0 });
  });
  it("parking tylko dla ciężarówek, bez prywatnych i hgv=no", () => {
    expect(poiRow({ id: "w3", properties: { amenity: "parking" }, geometry: { type: "Point", coordinates: [19, 52] } })).toBeNull();
    expect(poiRow({ id: "w4", properties: { amenity: "parking", hgv: "designated" }, geometry: { type: "Point", coordinates: [19, 52] } })?.kind).toBe("parking");
    expect(poiRow({ id: "w5", properties: { amenity: "fuel", access: "private" }, geometry: { type: "Point", coordinates: [19, 52] } })).toBeNull();
    expect(poiRow({ id: "w6", properties: { highway: "services", hgv: "no" }, geometry: { type: "Point", coordinates: [19, 52] } })).toBeNull();
  });
});

describe("routePois", () => {
  // Trasa na północ wzdłuż południka 19°, ok. 11 km.
  const route = [[52, 19, 0], [52.05, 19, 5.56], [52.1, 19, 11.12]];

  it("km, strona drogi i odległość od trasy", () => {
    const rows = [
      { osm_id: "a", kind: "fuel", name: "Orlen", truck: 1, lat: 52.02, lon: 19.001 }, // ~68 m na wschód = po prawej
      { osm_id: "b", kind: "mop", name: "MOP", truck: 0, lat: 52.07, lon: 18.999 }, // po lewej
      { osm_id: "c", kind: "fuel", name: "Daleko", truck: 0, lat: 52.05, lon: 19.02 }, // 1,4 km od trasy
      { osm_id: "d", kind: "fuel", name: "Sąsiednia ulica", truck: 0, lat: 52.06, lon: 19.0028 }, // ~190 m — za daleko dla stacji
    ];
    const p = routePois(route, rows);
    expect(p.map((x) => [x.id, x.side])).toEqual([["a", "right"], ["b", "left"]]);
    expect(p[0].km).toBeCloseTo(2.224, 2);
    expect(p[0].offM).toBeGreaterThan(50);
  });

  it("MOP ze stacją i parkingiem w jednym miejscu → jedna pinezka MOP", () => {
    const rows = [
      { osm_id: "s", kind: "services", name: "MOP", truck: 0, lat: 52.03, lon: 19.001 },
      { osm_id: "p", kind: "parking", name: "", truck: 1, lat: 52.031, lon: 19.0012 },
      { osm_id: "f", kind: "fuel", name: "BP", truck: 0, lat: 52.0305, lon: 19.001 },
    ];
    expect(routePois(route, rows).map((x) => x.id)).toEqual(["s"]);
  });
});
