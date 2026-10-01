import { describe, expect, it } from "vitest";
import { applySpeeds, buildCells, cellOf, dirOf } from "./speeds.mjs";

describe("prędkości z jazdy kierowców", () => {
  // Jazda na północ wzdłuż 19°E: odczyt co 5 s, 60 m (43 km/h odbiornik).
  const drive = (user, day, kmh, n = 40) => Array.from({ length: n }, (_, i) => ({ user, t: day * 86_400_000 + i * 5000, lat: 52 + (i * 60) / 111_320, lon: 19, kmh, heading: 0 }));

  it("przejazd = kierowca × dzień × komórka × kierunek; mediana przejazdów; wolne odczyty pomijane", () => {
    const cells = buildCells([...drive(1, 1, 50), ...drive(1, 2, 60), ...drive(2, 1, 70), ...drive(2, 1, 3).map((p) => ({ ...p, t: p.t + 3_600_000 }))]);
    const c = cells.find((x) => x.cell === cellOf(52, 19) && x.dir === dirOf(0));
    expect(c).toMatchObject({ passes: 3, users: 2, kmh: 60 });
  });

  it("odcinek z danymi dostaje prędkość z jazdy i nowy czas; bez danych — czas z mapy", () => {
    // Trasa 2 km na północ: odcinek miejski 1 km (mapa 30 km/h) + 1 km poza miastem (bez danych).
    const points = Array.from({ length: 21 }, (_, i) => [52 + (i * 100) / 111_320, 19, i * 0.1]);
    const route = { points, lengthKm: 2, travelMin: 4, segments: [{ type: "urban", km: 1 }, { type: "rural", km: 1 }] };
    const known = new Map();
    for (let i = 0; i <= 10; i++) known.set(`${cellOf(points[i][0], 19)}|0`, { passes: 6, users: 3, kmh: 20 });
    const r = applySpeeds(route, (cell, dir) => known.get(`${cell}|${dir}`));
    expect(r.segments).toEqual([{ type: "urban", km: 1, kmh: 20 }, { type: "rural", km: 1 }]);
    expect(r.travelMin).toBe(5); // 1 km × 20 km/h = 3 min + 1 km × 2 min/km z mapy
    expect(r.realSpeedShare).toBe(0.5);
    expect(applySpeeds(route, () => ({ passes: 1, users: 1, kmh: 20 }))).toBe(route); // za mało przejazdów
  });
});
