import { describe, expect, it } from "vitest";
import { compareReports } from "./compare.mjs";

const m = (metres) => metres / 111_320; // przesunięcie na północ w stopniach

describe("zgłoszenia a OSM", () => {
  it("brak w OSM, zgodne, różne; potwierdzenia od kilku kierowców", () => {
    const reports = [
      { id: 1, userId: 1, kind: "height", value: 3.5, lat: 52, lon: 19, at: 3 },
      { id: 2, userId: 2, kind: "height", value: 3.5, lat: 52 + m(20), lon: 19, at: 2 }, // to samo miejsce, inny kierowca
      { id: 3, userId: 1, kind: "height", value: 3.8, lat: 53, lon: 19, at: 1 },
      { id: 4, userId: 1, kind: "weight", value: 10, lat: 54, lon: 19, at: 1 },
      { id: 5, userId: 1, kind: "parking", value: null, lat: 50, lon: 19, at: 1 },
    ];
    const osm = [
      { id: "w1", kind: "height", value: 3.5, raw: "3.5", lat: 52 + m(30), lon: 19 },
      { id: "n2", kind: "height", value: 4.0, raw: "4", lat: 53 + m(10), lon: 19 },
    ];
    const r = compareReports(reports, osm);
    expect(r.map((x) => [x.id, x.status])).toEqual([[4, "missing"], [3, "diff"], [5, "info"], [1, "match"]]);
    expect(r.find((x) => x.id === 1)).toMatchObject({ confirmations: 2, drivers: 2, osmId: "w1" });
    expect(r.find((x) => x.id === 3)).toMatchObject({ osmValue: 4, distM: 10 });
  });
});
