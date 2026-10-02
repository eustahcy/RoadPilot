import { describe, expect, it } from "vitest";
import { liveSections } from "./livetraffic.mjs";

// Prosta trasa na północ wzdłuż południka 19°: 10 km, punkt co 100 m (1 km ≈ 0,008993° szerokości).
const DEG_PER_KM = 1 / 111.195;
const route = Array.from({ length: 101 }, (_, i) => [52 + i * 0.1 * DEG_PER_KM, 19, i * 0.1]);
const seg = [{ type: "motorway", km: 10 }];
const at = (km, kmh, heading = 0, dLon = 0) => ({ lat: 52 + km * DEG_PER_KM, lon: 19 + dLon, kmh, heading });

describe("korki z jazdy kierowców RoadPilot", () => {
  it("wolna jazda na kawałku trasy = korek z opóźnieniem", () => {
    const rows = [];
    for (let km = 3; km < 5; km += 0.1) rows.push(at(km, 12));
    const [s, ...rest] = liveSections(route, seg, rows);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({ km: 3, toKm: 5, level: 3, cause: "jam", kmh: 12 });
    // 2 km po 12 zamiast 80 km/h: 10 min − 1,5 min.
    expect(s.delayMin).toBeCloseTo(8.5, 0);
  });

  it("zwykła jazda i przeciwny kierunek (druga jezdnia) nie są korkiem", () => {
    const rows = [];
    for (let km = 3; km < 5; km += 0.1) rows.push(at(km, 78), at(km, 8, 180, 0.0004));
    expect(liveSections(route, seg, rows)).toEqual([]);
  });

  it("spowolnienie (roboty) — żółte, z minutami opóźnienia", () => {
    const rows = [];
    for (let km = 6; km < 9; km += 0.1) rows.push(at(km, 45));
    const [s] = liveSections(route, seg, rows);
    expect(s).toMatchObject({ level: 2, km: 6, toKm: 9 });
    expect(s.delayMin).toBeGreaterThan(1);
  });
});
