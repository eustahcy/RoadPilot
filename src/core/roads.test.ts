import { describe, expect, it } from "vitest";
import { matchRoad, nearestPlace, parseRoads, Road, roadLabel } from "./roads";

// Okolice 52° N: 0,001° szerokości ≈ 111 m, 0,001° długości ≈ 68 m.
const P = { lat: 52.0, lon: 21.0 };
const ns = (id: number, lonOff: number, tags: Partial<Road> = {}): Road => ({ id, highway: "primary", geom: [{ lat: 51.99, lon: 21 + lonOff }, { lat: 52.01, lon: 21 + lonOff }], ...tags });
const ew = (id: number, latOff: number, tags: Partial<Road> = {}): Road => ({ id, highway: "residential", geom: [{ lat: 52 + latOff, lon: 20.99 }, { lat: 52 + latOff, lon: 21.01 }], ...tags });

describe("nazwa drogi i miejscowości", () => {
  it("parsuje drogi z geometrią i miejscowości", () => {
    const d = parseRoads({ elements: [
      { type: "way", id: 1, tags: { highway: "motorway", ref: "A2", name: "Autostrada Wolności" }, geometry: [{ lat: 52, lon: 21 }, { lat: 52.01, lon: 21 }] },
      { type: "way", id: 2, tags: { highway: "primary" }, geometry: [{ lat: 52, lon: 21 }] },
      { type: "node", id: 3, lat: 52.1, lon: 21.1, tags: { place: "town", name: "Mińsk Mazowiecki" } },
      { type: "node", id: 4, lat: 52.1, lon: 21.1, tags: { place: "suburb", name: "Osiedle" } },
    ] });
    expect(d.roads.map((r) => r.id)).toEqual([1]);
    expect(d.places).toEqual([{ name: "Mińsk Mazowiecki", kind: "town", lat: 52.1, lon: 21.1 }]);
    expect(roadLabel(d.roads[0])).toBe("A2 · Autostrada Wolności");
  });

  it("wybiera najbliższą drogę; przy skrzyżowaniu tę zgodną z kierunkiem jazdy", () => {
    const roads = [ns(1, 0.0002, { ref: "7" }), ew(2, 0.0001, { name: "Polna" }), ns(3, 0.003, { ref: "S7" })];
    expect(matchRoad(roads, P, 0)?.id).toBe(1);
    expect(matchRoad(roads, P, 90)?.id).toBe(2);
    expect(matchRoad(roads, P, null)?.id).toBe(2);
    expect(matchRoad([ns(3, 0.003)], P, 0)).toBeUndefined();
  });

  it("miejscowość: miasto dalej wygrywa z bliższą wsią", () => {
    const places = [
      { name: "Wieś", kind: "village" as const, lat: 52.02, lon: 21 },
      { name: "Miasto", kind: "city" as const, lat: 52.05, lon: 21 },
    ];
    expect(nearestPlace(places, P)?.name).toBe("Miasto");
    expect(nearestPlace(places, { lat: 52.018, lon: 21 })?.name).toBe("Wieś");
  });
});
