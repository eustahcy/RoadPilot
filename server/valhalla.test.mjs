import { describe, expect, it } from "vitest";
import { decodePolyline6, parseValhalla, valhallaRequest } from "./valhalla.mjs";

/** Koder polyline6 — do zbudowania odpowiedzi testowej. */
function encode(points) {
  let out = "", pLat = 0, pLon = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = "";
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lon] of points) {
    const a = Math.round(lat * 1e6), b = Math.round(lon * 1e6);
    out += enc(a - pLat) + enc(b - pLon);
    pLat = a; pLon = b;
  }
  return out;
}

describe("silnik RoadPilot (Valhalla)", () => {
  it("dekoduje polyline6", () => {
    expect(decodePolyline6(encode([[52.123456, 19.654321], [52.2, 19.7]]))).toEqual([{ latitude: 52.123456, longitude: 19.654321 }, { latitude: 52.2, longitude: 19.7 }]);
  });

  it("odpowiedź Valhalla → trasa jak z TomTom: odcinki wg prędkości, manewry z km", () => {
    const shape = encode(Array.from({ length: 11 }, (_, i) => [52 + i * 0.01, 19]));
    const json = { trip: { summary: { length: 11.12, time: 600 }, legs: [{ shape, maneuvers: [
      { type: 1, instruction: "Jedź na północ.", begin_shape_index: 0, length: 1.112, time: 120, street_names: ["Polna"] },
      { type: 20, instruction: "Zjedź w prawo.", begin_shape_index: 1, length: 8.896, time: 400, sign: { exit_number_elements: [{ text: "42" }], exit_toward_elements: [{ text: "Gdańsk" }] } },
      { type: 26, instruction: "Wjedź na rondo.", begin_shape_index: 9, length: 1.112, time: 80, roundabout_exit_count: 2 },
      { type: 4, instruction: "Cel.", begin_shape_index: 10, length: 0, time: 0 },
    ] }] } };
    const r = parseValhalla(json);
    expect(r.engine).toBe("roadpilot");
    expect(r.lengthKm).toBe(11.12);
    expect(r.travelMin).toBe(10);
    expect(r.segments.map((s) => s.type)).toEqual(["urban", "motorway", "rural"]);
    expect(r.instructions[1]).toMatchObject({ maneuver: "MOTORWAY_EXIT_RIGHT", exit: "42", signpost: "Gdańsk" });
    expect(r.instructions[1].km).toBeCloseTo(1.112, 2);
    expect(r.instructions[2]).toMatchObject({ maneuver: "ROUNDABOUT_RIGHT", roundaboutExit: "2" });
    expect(r.points.at(-1)[2]).toBeCloseTo(11.12, 2);
  });

  it("zapytanie dla ciężarówki z danymi pojazdu", () => {
    const q = valhallaRequest({ lat: 52, lon: 19 }, { lat: 54, lon: 18 }, { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, adr: "D", maxKmh: 90 });
    expect(q.costing).toBe("truck");
    expect(q.costing_options.truck).toMatchObject({ height: 4, weight: 40, axle_load: 11.5, hazmat: true, top_speed: 90, use_truck_route: true });
    expect(q.costing_options.truck.shortest).toBeUndefined();
    const v = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, adr: "none", maxKmh: 90 };
    expect(valhallaRequest({ lat: 52, lon: 19 }, { lat: 54, lon: 18 }, v, [], 0, "shortest").costing_options.truck.shortest).toBe(true);
    expect(valhallaRequest({ lat: 52, lon: 19 }, { lat: 54, lon: 18 }, v, [], 0, "eco").costing_options.truck.shortest).toBeUndefined();
  });
});
