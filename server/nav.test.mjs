import { describe, expect, it } from "vitest";
import { parseRoute, parseRoutes, parseSearch, routeError, routeUrl, vehicleParams } from "./nav.mjs";

/** Punkty co ~1,11 km na północ (0,01°) wzdłuż południka 0. */
const pts = (n) => Array.from({ length: n }, (_, i) => ({ latitude: i * 0.01, longitude: 0 }));

const fixture = {
  routes: [{
    summary: { lengthInMeters: 5560, travelTimeInSeconds: 600, trafficDelayInSeconds: 60 },
    legs: [{ points: pts(6) }],
    sections: [
      { sectionType: "URBAN", startPointIndex: 0, endPointIndex: 1 },
      { sectionType: "MOTORWAY", startPointIndex: 2, endPointIndex: 4 },
      { sectionType: "LANES", startPointIndex: 3, endPointIndex: 4, lanes: [{ directions: ["STRAIGHT"], follow: "STRAIGHT" }, { directions: ["RIGHT"] }] },
      { sectionType: "SPEED_LIMIT", startPointIndex: 2, endPointIndex: 4, maxSpeedLimitInKmh: 80 },
      { sectionType: "TRAFFIC", startPointIndex: 1, endPointIndex: 3, simpleCategory: "JAM", magnitudeOfDelay: 2, delayInSeconds: 240, effectiveSpeedInKmh: 18 },
    ],
    guidance: { instructions: [
      { pointIndex: 0, maneuver: "DEPART", message: "Wyjedź" },
      { pointIndex: 4, maneuver: "TAKE_EXIT", message: "Zjedź <exitNumber>42</exitNumber> w kierunku <signpostText>Gdańsk</signpostText>", exitNumber: "42", signpostText: "Gdańsk", turnAngleInDecimalDegrees: 30 },
    ] },
  }],
};

describe("nawigacja TomTom", () => {
  it("dzieli trasę na odcinki wg typu drogi dla silnika przerw", () => {
    const r = parseRoute(fixture);
    expect(r.lengthKm).toBe(5.56);
    expect(r.travelMin).toBe(10);
    expect(r.trafficMin).toBe(1);
    // 5 odcinków po 1,112 km: miasto, poza miastem, 2 × autostrada, poza miastem
    expect(r.segments.map((s) => s.type)).toEqual(["urban", "rural", "motorway", "rural"]);
    expect(r.segments.reduce((a, s) => a + s.km, 0)).toBeCloseTo(5.56, 2);
    expect(r.segments[2].km).toBeCloseTo(2.224, 2);
  });

  it("manewry, pasy i ograniczenia z km od startu, tekst bez znaczników", () => {
    const r = parseRoute(fixture);
    expect(r.instructions[1]).toMatchObject({ maneuver: "TAKE_EXIT", text: "Zjedź 42 w kierunku Gdańsk", exit: "42", signpost: "Gdańsk", angle: 30 });
    expect(r.instructions[1].km).toBeCloseTo(4.448, 2);
    expect(r.lanes).toEqual([{ km: expect.closeTo(3.336, 2), toKm: expect.closeTo(4.448, 2), lanes: [{ dirs: ["STRAIGHT"], follow: "STRAIGHT" }, { dirs: ["RIGHT"] }] }]);
    expect(r.speedLimits[0]).toMatchObject({ kmh: 80 });
    expect(r.points[0]).toEqual([0, 0, 0]);
    expect(r.points[r.points.length - 1][2]).toBeCloseTo(5.56, 2);
  });

  it("dane pojazdu → parametry TomTom; ADR ustawia kod tunelowy", () => {
    const v = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, maxKmh: 90, adr: "D" };
    const q = vehicleParams(v);
    expect(q.get("travelMode")).toBe("truck");
    expect(q.get("vehicleHeight")).toBe("4");
    expect(q.get("vehicleAdrTunnelRestrictionCode")).toBe("D");
    expect(() => vehicleParams({ ...v, heightM: 9 })).toThrow(/heightM/);
  });

  it("rodzaj trasy w adresie TomTom; nieznany → fastest", () => {
    const v = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, maxKmh: 90, adr: "none" };
    const type = (t) => new URL(routeUrl({ lat: 52, lon: 21 }, { lat: 53, lon: 21 }, v, "k", 0, t)).searchParams.get("routeType");
    expect(type("shortest")).toBe("shortest");
    expect(type("eco")).toBe("eco");
    expect(type("bogus")).toBe("fastest");
    expect(type()).toBe("fastest");
  });

  it("wyszukiwanie i błędy", () => {
    expect(parseSearch({ results: [{ poi: { name: "BCT" }, address: { freeformAddress: "Kontenerowa 7, Gdańsk", country: "Polska" }, position: { lat: 54.5, lon: 18.6 } }] }))
      .toEqual([{ label: "BCT", sub: "Kontenerowa 7, Gdańsk, Polska", lat: 54.5, lon: 18.6 }]);
    expect(routeError({ detailedError: { message: "NO_ROUTE_FOUND" } })).toMatch(/Nie ma trasy dla tego pojazdu/);
  });

  it("korki na trasie i trasy alternatywne", () => {
    const r = parseRoute(fixture);
    expect(r.traffic).toEqual([{ km: expect.closeTo(1.112, 2), toKm: expect.closeTo(3.336, 2), delayMin: 4, level: 2, cause: "jam", kmh: 18 }]);
    const both = parseRoutes({ routes: [fixture.routes[0], { ...fixture.routes[0], summary: { ...fixture.routes[0].summary, lengthInMeters: 6000 } }] });
    expect(both.map((x) => x.lengthKm)).toEqual([5.56, 6]);
  });
});

describe("routeUrl z punktami pośrednimi", () => {
  it("dokłada punkty do ścieżki i wyłącza alternatywy", () => {
    const v = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, maxKmh: 90, adr: "none" };
    const u = new URL(routeUrl({ lat: 52, lon: 21 }, { lat: 53, lon: 21 }, v, "k", 2, "fastest", [{ lat: 52.5, lon: 20.5 }]));
    expect(u.pathname).toContain("/calculateRoute/52,21:52.5,20.5:53,21/json");
    expect(u.searchParams.get("maxAlternatives")).toBeNull();
  });
});
