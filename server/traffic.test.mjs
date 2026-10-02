import { describe, expect, it } from "vitest";
import { incidentSections, trafficBoxes } from "./traffic.mjs";

// Prosta trasa na północ: punkt co ~111 m (0.001° szerokości), 200 km.
const route = Array.from({ length: 1801 }, (_, i) => [52 + i * 0.001, 19, i * 0.11132]);
const line = (fromLat, toLat, lon = 19) => ({ type: "LineString", coordinates: [[lon, fromLat], [lon, (fromLat + toLat) / 2], [lon, toLat]] });

describe("incidentSections", () => {
  it("korek w naszym kierunku → odcinek z km, opóźnieniem i stopniem", () => {
    const s = incidentSections(route, [{ geometry: line(52.5, 52.52), properties: { id: "a", iconCategory: 6, magnitudeOfDelay: 3, delay: 900, length: 2226 } }]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ delayMin: 15, level: 3, cause: "jam" });
    expect(s[0].km).toBeCloseTo(55.66, 1);
    expect(s[0].toKm).toBeCloseTo(57.89, 1);
  });
  it("druga jezdnia (przeciwny kierunek), droga obok i inne kategorie — pomijane", () => {
    const s = incidentSections(route, [
      { geometry: line(52.52, 52.5), properties: { id: "b", iconCategory: 6, magnitudeOfDelay: 3, delay: 900, length: 2226 } },
      { geometry: line(52.5, 52.52, 19.01), properties: { id: "c", iconCategory: 6, magnitudeOfDelay: 3, delay: 900, length: 2226 } },
      { geometry: line(52.5, 52.52), properties: { id: "d", iconCategory: 2, magnitudeOfDelay: 1, length: 2226 } },
    ]);
    expect(s).toEqual([]);
  });
  it("zamknięcie i roboty; to samo zdarzenie z dwóch prostokątów tylko raz", () => {
    const closed = { geometry: line(52.7, 52.71), properties: { id: "e", iconCategory: 8, magnitudeOfDelay: 4, length: 1113 } };
    const s = incidentSections(route, [closed, { geometry: line(52.3, 52.31), properties: { id: "f", iconCategory: 9, magnitudeOfDelay: 0, length: 1113 } }, closed]);
    expect(s.map((x) => [x.cause, x.level])).toEqual([["roadwork", 1], ["closed", 4]]);
  });
});

describe("trafficBoxes", () => {
  it("prosta trasa 200 km mieści się w jednym–dwóch prostokątach do 10 000 km²", () => {
    const boxes = trafficBoxes(route);
    expect(boxes.length).toBeLessThanOrEqual(2);
    expect(boxes[0].minLat).toBeLessThan(52);
    expect(boxes[boxes.length - 1].maxLat).toBeGreaterThan(53.8);
  });
});
