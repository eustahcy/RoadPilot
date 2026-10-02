import { describe, expect, it } from "vitest";
import { decodePolyline6, limitHere, osrmLanes, parseValhalla, roadInfo, traceChunks, tracePoints, traceRequest, valhallaRequest } from "./valhalla.mjs";

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
  it("unikanie płatnych, autostrad i promów", () => {
    const v = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, adr: "none", maxKmh: 90 };
    const t = valhallaRequest({ lat: 52, lon: 19 }, { lat: 54, lon: 18 }, { ...v, avoid: { tolls: true, motorways: false, ferries: true } }).costing_options.truck;
    expect(t).toMatchObject({ use_tolls: 0, use_ferry: 0 });
    expect(t.use_highways).toBeUndefined();
    expect(valhallaRequest({ lat: 52, lon: 19 }, { lat: 54, lon: 18 }, v).costing_options.truck.use_tolls).toBeUndefined();
  });
  it("punkty pośrednie jako „through” — bez alternatyw", () => {
    const v = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500, axles: 5, adr: "none", maxKmh: 90 };
    const q = valhallaRequest({ lat: 52, lon: 19 }, { lat: 54, lon: 18 }, v, [], 2, "fastest", [{ lat: 53, lon: 18.5 }]);
    expect(q.locations).toEqual([{ lat: 52, lon: 19 }, { lat: 53, lon: 18.5, type: "through" }, { lat: 54, lon: 18 }]);
    expect(q.alternates).toBeUndefined();
  });
});

describe("ograniczenia i obszar zabudowany z trace_attributes", () => {
  it("kawałki trasy do 150 km dzielą punkt na styku", () => {
    const pts = Array.from({ length: 401 }, (_, i) => [52, 19, i]);
    const c = traceChunks(pts);
    expect(c.map((x) => [x.fromKm, x.toKm])).toEqual([[0, 150], [150, 300], [300, 400]]);
  });

  it("znak 70 bez tagu PL:urban między odcinkami w mieście = nadal zabudowany; autostrada z klasy drogi", () => {
    const zones = new Map([[1, "u"], [3, "u"], [5, "r"]]);
    const edges = [
      { way_id: 1, length: 1, speed_limit: 50, road_class: "primary" },
      { way_id: 2, length: 1, speed_limit: 70, road_class: "primary" },
      { way_id: 3, length: 1, speed_limit: 50, road_class: "primary" },
      { way_id: 4, length: 1, speed_limit: 90, road_class: "primary" },
      { way_id: 5, length: 1, road_class: "primary" },
      { way_id: 6, length: 2, speed_limit: 140, road_class: "motorway" },
    ];
    const r = roadInfo([{ fromKm: 0, toKm: 7, edges }], zones);
    expect(r.roads).toEqual([{ km: 0, toKm: 3, kind: "urban" }, { km: 3, toKm: 5, kind: "rural" }, { km: 5, toKm: 7, kind: "motorway" }]);
    expect(r.speedLimits).toEqual([{ km: 0, toKm: 1, kmh: 50 }, { km: 1, toKm: 2, kmh: 70 }, { km: 2, toKm: 3, kmh: 50 }, { km: 3, toKm: 4, kmh: 90 }, { km: 5, toKm: 7, kmh: 140 }]);
  });
});

describe("limitHere", () => {
  it("ślad GPS → km narastająco, dopasowanie map_snap, ograniczenie do końca śladu", () => {
    const pts = tracePoints([[52, 19], [52.001, 19], [52.002, 19]]);
    expect(pts[2][2]).toBeCloseTo(0.222, 2);
    expect(traceRequest(pts, true).shape_match).toBe("map_snap");
    expect(traceRequest(pts).shape_match).toBe("walk_or_snap");
    const edges = [{ way_id: 1, length: 0.1, speed_limit: 90, road_class: "primary" }, { way_id: 2, length: 0.12, speed_limit: 50, road_class: "primary" }];
    const r = limitHere(pts, edges, new Map([[2, "u"]]));
    expect(r.km).toBeCloseTo(0.222, 2);
    expect(r.speedLimits.at(-1).kmh).toBe(50);
    expect(r.roads.at(-1).kind).toBe("urban");
  });
});

describe("osrmLanes — pasy z Valhalli (format OSRM)", () => {
  // Trasa na północ, punkt co ~111 m.
  const pts = Array.from({ length: 200 }, (_, i) => [52 + i * 0.001, 19, i * 0.11132]);
  const lane = (indications, valid, valid_indication) => ({ indications, valid, ...(valid_indication ? { valid_indication } : {}) });
  const json = (inters) => ({ routes: [{ legs: [{ steps: [{ intersections: inters }] }] }] });

  it("zjazd: dwa pasy prosto, trzeci w prawo — prowadzi prawy, km z pozycji skrzyżowania", () => {
    const r = osrmLanes(json([{ location: [19, 52.05], lanes: [lane(["straight"], false), lane(["straight"], false), lane(["slight right"], true, "slight right")] }]), pts);
    expect(r).toHaveLength(1);
    expect(r[0].km).toBeCloseTo(5.566, 2);
    expect(r[0].lanes).toEqual([{ dirs: ["STRAIGHT"] }, { dirs: ["STRAIGHT"] }, { dirs: ["SLIGHT_RIGHT"], follow: "SLIGHT_RIGHT" }]);
  });

  it("mijany zjazd (pasy prosto prowadzą, zjazd nie) i powtórka w tym samym miejscu — pomijane", () => {
    const pass = [lane(["straight"], true, "straight"), lane(["straight"], true, "straight"), lane(["slight right"], false)];
    const exit = [lane(["straight"], false), lane(["slight right"], true, "slight right")];
    const r = osrmLanes(json([{ location: [19, 52.01], lanes: pass }, { location: [19, 52.03], lanes: exit }, { location: [19, 52.0302], lanes: exit }]), pts);
    expect(r.map((x) => x.km.toFixed(1))).toEqual(["3.3"]);
  });

  it("rozjazd (dwa pasy odchodzą) i manewr z trasy przy mijanym pasie — pokazane", () => {
    const split = [lane(["straight"], true, "straight"), lane(["straight"], true, "straight"), lane(["right"], false), lane(["right"], false)];
    const pass = [lane(["straight"], true, "straight"), lane(["straight"], true, "straight"), lane(["slight right"], false)];
    const r = osrmLanes(json([{ location: [19, 52.01], lanes: split }, { location: [19, 52.03], lanes: pass }, { location: [19, 52.05], lanes: pass }]), pts, 0, [{ km: 5.6, maneuver: "KEEP_LEFT" }]);
    expect(r.map((x) => x.km.toFixed(1))).toEqual(["1.1", "5.6"]);
  });

  it("wszystkie pasy prowadzą trasą, jeden pas, daleko od trasy — pomijane; kilka strzałek na pasie", () => {
    const r = osrmLanes(json([
      { location: [19, 52.01], lanes: [lane(["straight"], true), lane(["straight"], true)] },
      { location: [19, 52.02], lanes: [lane(["straight"], true)] },
      { location: [19.01, 52.03], lanes: [lane(["left"], false), lane(["straight"], true)] },
      { location: [19, 52.04], lanes: [lane(["left"], false), lane(["straight", "right"], true, "right")] },
    ]), pts);
    expect(r.map((x) => x.lanes)).toEqual([[{ dirs: ["LEFT"] }, { dirs: ["STRAIGHT", "RIGHT"], follow: "RIGHT" }]]);
  });
});

describe("turnAngle — kąt manewru z kierunków Valhalli", () => {
  it("w prawo dodatni, w lewo ujemny, przez północ, zawracanie", async () => {
    const { turnAngle } = await import("./valhalla.mjs");
    expect(turnAngle(258, 328)).toBe(70);
    expect(turnAngle(350, 50)).toBe(60);
    expect(turnAngle(350, 277)).toBe(-73);
    expect(turnAngle(10, 190)).toBe(180);
  });
});

describe("sharpCurves — ciasne łuki drogi", () => {
  it("łuk o promieniu ~15 m poza manewrem → zakręt; ten sam przy manewrze i prosta — nie", async () => {
    const { sharpCurves } = await import("./valhalla.mjs");
    // Prosta 200 m na północ, łuk 90° o promieniu 15 m w prawo, prosta 200 m na wschód.
    const M = 111_320, lat0 = 52, kx = M * Math.cos((lat0 * Math.PI) / 180);
    const xy = [];
    for (let y = 0; y <= 200; y += 10) xy.push([0, y]);
    for (let a = 5; a <= 90; a += 5) xy.push([15 - 15 * Math.cos((a * Math.PI) / 180), 200 + 15 * Math.sin((a * Math.PI) / 180)]);
    for (let x = 25; x <= 215; x += 10) xy.push([x, 215]);
    const pts = xy.map(([x, y]) => ({ latitude: lat0 + y / M, longitude: 19 + x / kx }));
    const km = [0];
    for (let i = 1; i < xy.length; i++) km.push(km[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]) / 1000);
    const c = sharpCurves(pts, km, []);
    expect(c).toHaveLength(1);
    expect(c[0].radiusM).toBeLessThan(25);
    expect(c[0].km).toBeGreaterThan(0.19);
    expect(c[0].km).toBeLessThan(0.23);
    expect(sharpCurves(pts, km, [{ km: 0.21, maneuver: "TURN_RIGHT" }])).toEqual([]);
  });
});
