import { describe, expect, it } from "vitest";
import { cleanPoints, cleanReport } from "./collect.mjs";

const NOW = Date.UTC(2026, 8, 30, 12);

describe("zbieranie danych do mapy", () => {
  it("zapisuje tylko punkty z Polski, z ostatnich 7 dni, z rozsądną prędkością", () => {
    const rows = cleanPoints([
      [NOW - 1000, 52.2297, 21.0122, 78.4, 91.6], // Warszawa
      [NOW - 1000, 52.52, 13.405, 80, 90], // Berlin — poza Polską
      [NOW - 8 * 86_400_000, 52.2, 21, 80, 0], // za stary
      [NOW - 1000, 52.2, 21, 300, 0], // prędkość bez sensu → null
    ], NOW);
    expect(rows).toEqual([[NOW - 1000, 52.2297, 21.0122, 78, 92], [NOW - 1000, 52.2, 21, null, 0]]);
    expect(() => cleanPoints(new Array(1001).fill([NOW, 52, 21]), NOW)).toThrow();
  });

  it("zgłoszenia: wartość w granicach, tylko Polska", () => {
    expect(cleanReport({ kind: "height", lat: 52.2, lon: 21, value: 3.8, heading: 90 })).toMatchObject({ kind: "height", value: 3.8, heading: 90 });
    expect(() => cleanReport({ kind: "height", lat: 52.2, lon: 21, value: 12 })).toThrow(/1.5–6 m/);
    expect(() => cleanReport({ kind: "closed", lat: 52.52, lon: 13.4 })).toThrow(/Polsce/);
    expect(cleanReport({ kind: "closed", lat: 52.2, lon: 21 }).value).toBeNull();
  });
});
