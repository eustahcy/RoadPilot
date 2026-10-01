import { describe, expect, it } from "vitest";
import { distanceM } from "./gps";
import { alongRoute, bearingAtKm, HERE, isOffRoute, pushTrail, TrailPoint, trailM, lanesAhead, locate, NAV, nearestOnRoute, nextInstruction, pointAtKm, RoutePoint, routeSlice, speedLimitAt, speedTone } from "./navmatch";

const KM_PER_DEG = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) / 1000;
/** Trasa na północ po południku 0, punkt co 100 m, 10 km. */
const route: RoutePoint[] = Array.from({ length: 101 }, (_, i) => [(i * 0.1) / KM_PER_DEG, 0, i * 0.1]);
const at = (northKm: number, eastM = 0) => ({ lat: northKm / KM_PER_DEG, lon: eastM / 1000 / KM_PER_DEG });

describe("prowadzenie po trasie", () => {
  it("rzutuje pozycję na trasę i mierzy odległość od niej", () => {
    const p = locate(route, at(3.25, 20))!;
    expect(p.km).toBeCloseTo(3.25, 2);
    expect(p.offM).toBeCloseTo(20, 0);
    expect(isOffRoute(p, 10)).toBe(false);
    expect(isOffRoute(locate(route, at(3.25, 150))!, 10)).toBe(true);
  });

  it("z podpowiedzią szuka tylko w oknie wokół poprzedniej pozycji", () => {
    const p = locate(route, at(5.02), 49)!;
    expect(p.km).toBeCloseTo(5.02, 2);
    expect(p.idx).toBe(50);
  });

  it("następny manewr, „następnie” i pasy przed nami", () => {
    const ins = [
      { km: 0, maneuver: "DEPART", text: "Wyjedź" },
      { km: 4, maneuver: "TAKE_EXIT", text: "Zjedź", exit: "42" },
      { km: 4.2, maneuver: "TURN_RIGHT", text: "Skręć w prawo" },
      { km: 9, maneuver: "ARRIVE", text: "Cel" },
    ];
    const n = nextInstruction(ins, 3.2)!;
    expect(n.ins.exit).toBe("42");
    expect(n.inKm).toBeCloseTo(0.8, 6);
    expect(n.then?.maneuver).toBe("TURN_RIGHT");
    expect(nextInstruction(ins, 4.5)!.ins.maneuver).toBe("ARRIVE");
    expect(nextInstruction(ins, 9.5)).toBeUndefined();

    const lanes = [{ km: 3.9, toKm: 4, lanes: [{ dirs: ["STRAIGHT"] }, { dirs: ["RIGHT"], follow: "RIGHT" }] }];
    expect(lanesAhead(lanes, 2)).toBeUndefined(); // 1,9 km przed — jeszcze za wcześnie
    expect(lanesAhead(lanes, 3)!.inKm).toBeCloseTo(0.9, 6);
    expect(lanesAhead(lanes, 4.1)).toBeUndefined(); // za nami
    expect(speedLimitAt([{ km: 0, toKm: 5, kmh: 80 }], 3)).toBe(80);
  });
});

describe("geometria trasy do widoku nawigacji", () => {
  it("punkt i kierunek na danym km", () => {
    expect(pointAtKm(route, 2.35)!.lat).toBeCloseTo(at(2.35).lat, 8);
    expect(bearingAtKm(route, 5)).toBeCloseTo(0, 3); // na północ
    // Zakręt na wschód po 1 km: kierunek 90°
    const turn: RoutePoint[] = [[0, 0, 0], [1 / KM_PER_DEG, 0, 1], [1 / KM_PER_DEG, 1 / KM_PER_DEG, 2]];
    expect(bearingAtKm(turn, 1.5)).toBeCloseTo(90, 0);
  });

  it("fragment trasy z punktami na brzegach", () => {
    const s = routeSlice(route, 1.05, 1.35);
    expect(s).toHaveLength(2 + 3); // brzegi + punkty na 1,1 / 1,2 / 1,3 km
    expect(s[0].lat).toBeCloseTo(at(1.05).lat, 8);
  });
});


describe("ograniczenie prędkości i kolor prędkości", () => {
  const limits = [{ km: 0, toKm: 2, kmh: 50 }, { km: 8, toKm: 10, kmh: 100 }];
  it("w luce trzyma ostatnie znane do NAV.limitCarryKm, potem nic", () => {
    expect(speedLimitAt(limits, 1)).toBe(50);
    expect(speedLimitAt(limits, 2.5)).toBe(50);
    expect(speedLimitAt(limits, 2 + NAV.limitCarryKm + 0.1)).toBeUndefined();
    expect(speedLimitAt(limits, 9)).toBe(100);
    expect(speedLimitAt(limits, 11)).toBe(100);
  });
  it("zielony do limitu, żółty do +5, czerwony wyżej; bez limitu brak oceny", () => {
    expect(speedTone(80, 80)).toBe("ok");
    expect(speedTone(85, 80)).toBe("warn");
    expect(speedTone(86, 80)).toBe("over");
    expect(speedTone(86, undefined)).toBeUndefined();
    expect(speedTone(null, 80)).toBeUndefined();
  });
});

describe("odległość po trasie", () => {
  it("punkt przy trasie: km przed / za nami; daleko od trasy: undefined", () => {
    expect(alongRoute(route, at(7.5, 100), 3)!.km).toBeCloseTo(4.5, 2);
    expect(alongRoute(route, at(1, 0), 3)!.km).toBeCloseTo(-2, 2);
    expect(alongRoute(route, at(7.5, 900), 3)).toBeUndefined();
  });
  it("najbliższy przed nami po trasie pomija te za nami i te obok trasy", () => {
    const items = [{ id: "za", ...at(2) }, { id: "obok", ...at(4, 800) }, { id: "dalej", ...at(8) }, { id: "blisko", ...at(5.5, 50) }];
    const n = nearestOnRoute(items, route, 3)!;
    expect(n.item.id).toBe("blisko");
    expect(n.km).toBeCloseTo(2.5, 2);
    expect(nearestOnRoute([items[0]], route, 3)).toBeUndefined();
  });
});

describe("pushTrail", () => {
  it("punkty co HERE.stepM, ślad przycięty do HERE.keepM", () => {
    let t: TrailPoint[] = [];
    // Co ~11 m na północ: co drugi-trzeci odczyt trafia do śladu.
    for (let i = 0; i < 100; i++) t = pushTrail(t, { lat: 52 + i * 0.0001, lon: 19 });
    expect(t.length).toBeGreaterThan(2);
    for (let i = 1; i < t.length; i++) expect(distanceM({ lat: t[i - 1][0], lon: t[i - 1][1] }, { lat: t[i][0], lon: t[i][1] })).toBeGreaterThanOrEqual(HERE.stepM);
    expect(trailM(t)).toBeLessThan(HERE.keepM + 40);
    expect(trailM(t)).toBeGreaterThan(HERE.keepM - 40);
    expect(t.at(-1)![0]).toBeGreaterThan(52.0095);
  });
});
