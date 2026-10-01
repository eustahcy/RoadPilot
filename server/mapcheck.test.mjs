import { describe, expect, it } from "vitest";
import { badTurnClusters, suspectPasses, violates } from "./mapcheck.mjs";

describe("podejrzane ograniczenia z jazdy kierowców", () => {
  // Droga na północ 200 m z ograniczeniem wysokości 3,5 m.
  const r = { key: "osm:w1:height", kind: "height", value: 3.5, raw: "3.5", geom: [[52, 19], [52.0018, 19]] };
  const truck = { heightM: 4, weightKg: 40000 };
  const van = { heightM: 2.5, weightKg: 3500 };
  const along = (user, heading = 0, lon = 19) => ({ user, lat: 52.0009, lon, heading, kmh: 50 });
  it("przejazd wzdłuż drogi pojazdem, który nie spełnia — liczy się; niższy pojazd, w poprzek (most), z boku — nie", () => {
    const vehicles = new Map([[1, truck], [2, truck], [3, van]]);
    const passes = suspectPasses([r], [along(1), along(2, 180), along(3), along(1, 90), along(2, 0, 19.001)], vehicles);
    expect([...passes.get("osm:w1:height")]).toEqual([1, 2]);
  });
  it("violates: wysokość, masa, zakaz (dojazd — nie)", () => {
    expect(violates({ kind: "weight", value: 12 }, truck)).toBe(true);
    expect(violates({ kind: "hgv", raw: "destination" }, truck)).toBe(false);
  });
});

describe("zły manewr", () => {
  it("zgłoszenia w tym samym miejscu i kierunku od dwóch kierowców → potwierdzony; inny kierunek — osobno", () => {
    const g = badTurnClusters([
      { user: 1, lat: 52, lon: 19, heading: 90, note: "Skręć w lewo w Polną" },
      { user: 2, lat: 52.0001, lon: 19, heading: 100 },
      { user: 1, lat: 52, lon: 19.0001, heading: 270 },
    ]);
    expect(g.map((x) => [x.users, x.confirmed])).toEqual([[2, true], [1, false]]);
    expect(g[0].note).toBe("Skręć w lewo w Polną");
  });
});
