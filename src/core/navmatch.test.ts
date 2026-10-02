import { describe, expect, it } from "vitest";
import { distanceM } from "./gps";
import { alongRoute, bearingAtKm, HERE, isOffRoute, junctionZoom, locateTrace, nextOffRoute, travelHeading, OFF_ROUTE_IDLE, pushTrail, TrailPoint, trailM, laneHint, lanesAhead, locate, NAV, nearestOnRoute, nextInstruction, pointAtKm, RoutePoint, routeSlice, speedLimitAt, speedTone } from "./navmatch";
import { milestoneAt, roadAt } from "./navmatch";

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
    expect(lanesAhead(lanes, 3.9 - NAV.lanesAheadKm - 0.1)).toBeUndefined(); // dalej niż NAV.lanesAheadKm — jeszcze nie
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

describe("asystent pasa", () => {
  const L = (...f: (string | undefined)[]) => ({ lanes: f.map((x) => ({ dirs: [x ?? "STRAIGHT"], ...(x ? { follow: x } : {}) })) });
  it("dwa pasy prosto + zjazdowy po prawej → skrajnie prawy", () => {
    expect(laneHint(L(undefined, undefined, "SLIGHT_RIGHT"))).toMatchObject({ side: "right", lanes: [3], total: 3, text: "Jedź skrajnie prawym pasem" });
  });
  it("dwa pasy, prowadzi prawy → prawym; dwa prawe z trzech → prawych pasów", () => {
    expect(laneHint(L(undefined, "RIGHT"))?.text).toBe("Jedź prawym pasem");
    expect(laneHint(L(undefined, "STRAIGHT", "RIGHT"))?.text).toBe("Trzymaj się prawych pasów");
  });
  it("lewy, środkowy; każdy pas prowadzi → brak podpowiedzi", () => {
    expect(laneHint(L("LEFT", undefined, undefined))).toMatchObject({ side: "left", text: "Jedź skrajnie lewym pasem" });
    expect(laneHint(L(undefined, "STRAIGHT", undefined, undefined))).toMatchObject({ side: "middle", text: "Jedź pasem 2 od lewej" });
    expect(laneHint(L("STRAIGHT", "STRAIGHT"))).toBeUndefined();
  });
});

describe("zjazd z trasy → nowa trasa sama", () => {
  const S = 1000;
  const run = (steps: { t: number; off: boolean; offM?: number }[], rerouting = false) => {
    let s = OFF_ROUTE_IDLE;
    const at: number[] = [];
    for (const x of steps) {
      const r = nextOffRoute(s, { off: x.off, offM: x.offM ?? (x.off ? 120 : 10), missing: false, now: x.t, rerouting });
      s = r.state;
      if (r.reroute) at.push(x.t);
    }
    return at;
  };
  it("poza trasą od NAV.rerouteAfterMs — wyznacza sama; pojedynczy odczyt „na trasie” przy progu nie zeruje odliczania", () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({ t: i * S, off: i !== 4 && i !== 7 }));
    expect(run(steps)).toEqual([NAV.rerouteAfterMs]);
  });
  it("daleko od trasy — od razu; nieudana próba powtarzana po NAV.rerouteEveryMs; w trakcie wyznaczania — nie", () => {
    const steps = Array.from({ length: 45 }, (_, i) => ({ t: i * S, off: true, offM: 400 }));
    expect(run(steps)).toEqual([0, NAV.rerouteEveryMs, 2 * NAV.rerouteEveryMs]);
    expect(run(steps, true)).toEqual([]);
  });
  it("powrót na trasę na dłużej niż NAV.backOnRouteMs — odliczanie od nowa", () => {
    const steps = [...Array.from({ length: 5 }, (_, i) => ({ t: i * S, off: true })), ...Array.from({ length: 7 }, (_, i) => ({ t: (5 + i) * S, off: false })), ...Array.from({ length: 5 }, (_, i) => ({ t: (12 + i) * S, off: true }))];
    expect(run(steps)).toEqual([]);
  });
});

describe("dopasowanie po śladzie i kierunek jazdy", () => {
  const M = 111_320;
  // Trasa: 2 km na północ wzdłuż 19°E, potem z powrotem na południe 30 m obok (pętla / zjazd w drugą stronę).
  const north = Array.from({ length: 21 }, (_, i) => [52 + (i * 100) / M, 19, i * 0.1] as RoutePoint);
  const back = Array.from({ length: 21 }, (_, i) => [52 + ((20 - i) * 100) / M, 19 + 30 / (M * Math.cos((52 * Math.PI) / 180)), 2.03 + i * 0.1] as RoutePoint);
  const route = [...north, ...back];
  const fix = (m: number, lonM = 0, kmh: number | null = 60, heading: number | null = 0) => ({ lat: 52 + m / M, lon: 19 + lonM / (M * Math.cos((52 * Math.PI) / 180)), kmh, heading });

  it("jadąc na północ 20 m od obu nitek trasy — dopasowanie do nitki w naszym kierunku (km ~0,5, nie ~3,5)", () => {
    const p = locateTrace(route, [fix(400, 18), fix(450, 18), fix(500, 18)]);
    expect(p!.km).toBeCloseTo(0.5, 1);
  });
  it("pojedynczy odczyt 120 m obok — mediana śladu trzyma na trasie", () => {
    const p = locateTrace(route, [fix(400, -2), fix(450, -3), fix(500, -120)]);
    expect(p!.offM).toBeLessThan(10);
  });
  it("kierunek: z odbiornika od 15 km/h, wolniej z przesunięcia ≥ 20 m, na postoju brak", () => {
    expect(travelHeading([fix(0, 0, 50, 10)])).toBe(10);
    expect(travelHeading([fix(0, 0, 8, 200), fix(30, 0, 8, 200)])).toBeCloseTo(0, 0);
    expect(travelHeading([fix(0, 0, 2, 200), fix(5, 0, 2, 120)])).toBeNull();
  });
});

describe("przybliżenie przed manewrem", () => {
  const ins = (km: number, maneuver: string, extra = {}) => ({ km, maneuver, text: "", ...extra });
  it("skręt za 300 m +1,6, rondo / dwa manewry +2,2, prosto i daleko — 0", () => {
    expect(junctionZoom([ins(1.3, "TURN_RIGHT")], [], 1)).toBe(1.6);
    expect(junctionZoom([ins(1.3, "ROUNDABOUT_RIGHT")], [], 1)).toBe(2.2);
    expect(junctionZoom([ins(1.3, "TURN_RIGHT"), ins(1.5, "TURN_LEFT")], [], 1)).toBe(2.2);
    expect(junctionZoom([ins(2, "TURN_RIGHT")], [], 1)).toBe(0);
    expect(junctionZoom([ins(1.2, "STRAIGHT")], [], 1)).toBe(0);
  });
});

describe("droga i pikietaż nad paskiem", () => {
  it("roadAt: numer i patron z ostatniego manewru", () => {
    const ins = [{ km: 0, maneuver: "DEPART", text: "", street: "Katowicka" }, { km: 5, maneuver: "STRAIGHT", text: "", street: "A1", names: ["A1", "E 75", "Autostrada Bursztynowa"] }];
    expect(roadAt(ins, 2)).toEqual({ ref: undefined, name: "Katowicka" });
    expect(roadAt(ins, 7)).toEqual({ ref: "A1", name: "Autostrada Bursztynowa" });
  });
  it("milestoneAt: interpolacja, kierunek malejący i inna droga pomijana", () => {
    const ms = [{ km: 10, v: 432, ref: "S19" }, { km: 11, v: 431, ref: "S19" }, { km: 11.5, v: 88, ref: "91" }, { km: 12, v: 430, ref: "S19" }];
    expect(milestoneAt(ms, 10.5, "S19")).toBeCloseTo(431.5);
    expect(milestoneAt(ms, 13, "S19")).toBeCloseTo(429);
    expect(milestoneAt(ms, 20, "S19")).toBeUndefined();
  });
});
