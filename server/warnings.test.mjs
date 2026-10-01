import { describe, expect, it } from "vitest";
import { applyVotes, dropCopiedBridgeHeights, routeAlerts, routeBoxes, routeWarnings } from "./warnings.mjs";

const KM_PER_DEG = 111.32;
/** Trasa na północ po 19° E od 52° N, punkt co 100 m, 5 km. */
const route = Array.from({ length: 51 }, (_, i) => [52 + (i * 0.1) / KM_PER_DEG, 19, i * 0.1]);
const vehicle = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500 };
const lat = (km) => 52 + km / KM_PER_DEG;
const eastDeg = (m) => m / 1000 / (KM_PER_DEG * Math.cos((52 * Math.PI) / 180));

describe("ostrzeżenia na trasie", () => {
  it("wiadukt niższy niż pojazd na trasie — ostrzega; wyższy lub obok trasy — nie", () => {
    const w = routeWarnings(route, [
      { source: "osm", id: "n1", kind: "height", value: 3.6, lat: lat(2), lon: 19 },
      { source: "osm", id: "n2", kind: "height", value: 4.5, lat: lat(3), lon: 19 },
      { source: "osm", id: "n3", kind: "height", value: 3.2, lat: lat(4), lon: 19 + eastDeg(300) },
    ], vehicle);
    expect(w).toEqual([expect.objectContaining({ id: "n1", kind: "height", value: 3.6, km: expect.closeTo(2, 2) })]);
  });

  it("most nad trasą (w poprzek) nie ostrzega o masie; ograniczenie wzdłuż trasy — tak", () => {
    const across = { source: "osm", id: "w1", kind: "weight", value: 10, lat: lat(1), lon: 19, geom: [[lat(1), 19 - eastDeg(200)], [lat(1), 19], [lat(1), 19 + eastDeg(200)]] };
    const along = { source: "osm", id: "w2", kind: "weight", value: 10, lat: lat(3.1), lon: 19, geom: [[lat(3), 19], [lat(3.1), 19], [lat(3.2), 19]] };
    const w = routeWarnings(route, [across, along], vehicle);
    expect(w.map((x) => x.id)).toEqual(["w2"]);
    expect(w[0].km).toBeCloseTo(3, 2);
  });

  it("zakazy i zgłoszenia zawsze; to samo miejsce raz; prostokąty wzdłuż trasy", () => {
    const w = routeWarnings(route, [
      { source: "report", id: 7, kind: "truck_ban", value: null, lat: lat(1), lon: 19 },
      { source: "osm", id: "w9", kind: "hgv", value: null, lat: lat(1.5), lon: 19 },
      { source: "osm", id: "w10", kind: "hgv", value: null, lat: lat(1.55), lon: 19 },
    ], vehicle);
    expect(w.map((x) => x.id)).toEqual(["7", "w9"]);
    const boxes = routeBoxes(route, 2);
    expect(boxes).toHaveLength(3);
    expect(boxes[0].minLat).toBeLessThan(52);
  });
});

describe("omijanie ograniczeń w silniku RoadPilot", () => {
  it("twarde ograniczenia do wykluczenia; zakaz tranzytu przy celu nie blokuje", async () => {
    const { blockingPoints } = await import("./warnings.mjs");
    const w = [
      { km: 10, source: "osm", id: "w1", kind: "axle", value: 10, raw: "10", lat: 52, lon: 19 },
      { km: 20, source: "osm", id: "w2", kind: "hgv", value: null, raw: "destination", lat: 52.1, lon: 19 },
      { km: 99, source: "osm", id: "w3", kind: "hgv", value: null, raw: "destination", lat: 52.9, lon: 19 },
      { km: 50, source: "report", id: "4", kind: "closed", value: null, raw: "", lat: 52.5, lon: 19 },
    ];
    expect(blockingPoints(w, 100).map((p) => p.key)).toEqual(["osm:w1:axle", "osm:w2:hgv", "report:4:closed"]);
  });
});

describe("fałszywe alarmy na węzłach", () => {
  it("krótki odcinek drogi przecinającej trasę (skrzyżowanie / węzeł) nie ostrzega", async () => {
    const { routeWarnings } = await import("./warnings.mjs");
    const KM = 111.32, lat = (km) => 52 + km / KM, east = (m) => m / 1000 / (KM * Math.cos((52 * Math.PI) / 180));
    const route = Array.from({ length: 51 }, (_, i) => [52 + (i * 0.1) / KM, 19, i * 0.1]);
    const veh = { heightM: 4, widthM: 2.55, lengthM: 16.5, weightKg: 40000, axleWeightKg: 11500 };
    // 2 punkty: 21 m i 41 m od trasy, w poprzek — jak DK62 przy A1
    const crossing = { source: "osm", id: "w62", kind: "axle", value: 10, lat: lat(2), lon: 19, geom: [[lat(2), 19 + east(21)], [lat(2) - 0.0001, 19 + east(80)]] };
    // ukośny odcinek blisko trasy (50°) — też nie
    const diagonal = { source: "osm", id: "wd", kind: "axle", value: 10, lat: lat(3), lon: 19, geom: [[lat(3), 19], [lat(3.01), 19 + east(12)], [lat(3.02), 19 + east(24)]] };
    expect(routeWarnings(route, [crossing, diagonal], veh)).toEqual([]);
  });
});

describe("fotoradary i kontrole na trasie", () => {
  it("fotoradar w naszym kierunku ostrzega, w przeciwnym nie; bez kierunku — zawsze", () => {
    const a = routeAlerts(route, [
      { source: "osm", id: "r1", kind: "camera", value: 70, lat: lat(2), lon: 19 + eastDeg(10), from_lat: lat(1.8), from_lon: 19 },
      { source: "osm", id: "r2", kind: "camera", value: 70, lat: lat(3), lon: 19 - eastDeg(10), from_lat: lat(3.2), from_lon: 19 },
      { source: "osm", id: "n3", kind: "camera", value: null, lat: lat(4), lon: 19, from_lat: null, from_lon: null },
      { source: "osm", id: "n4", kind: "camera", value: null, lat: lat(4.5), lon: 19 + eastDeg(200) },
    ]);
    expect(a.map((x) => x.id)).toEqual(["r1", "n3"]);
    expect(a[0]).toMatchObject({ kind: "camera", value: 70, km: expect.closeTo(2, 2) });
  });

  it("zgłoszenie kontroli: kierunek z kursu zgłaszającego", () => {
    const a = routeAlerts(route, [
      { source: "report", id: 1, kind: "police", value: null, lat: lat(1), lon: 19, heading: 5 },
      { source: "report", id: 2, kind: "itd", value: null, lat: lat(2), lon: 19, heading: 180 },
      { source: "report", id: 3, kind: "itd", value: null, lat: lat(3), lon: 19, heading: null },
    ]);
    expect(a.map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("odcinkowy pomiar: początek i koniec na trasie w tej kolejności", () => {
    const a = routeAlerts(route, [
      { source: "osm", id: "r5", kind: "section", value: 70, lat: lat(1), lon: 19, to_lat: lat(3.5), to_lon: 19 },
      { source: "osm", id: "r6", kind: "section", value: 70, lat: lat(4), lon: 19, to_lat: lat(2), to_lon: 19 },
    ]);
    expect(a).toEqual([expect.objectContaining({ id: "r5", km: expect.closeTo(1, 2), toKm: expect.closeTo(3.5, 2) })]);
  });
});

describe("głosy na fotoradary i kontrole", () => {
  const a = [
    { source: "report", id: "1", kind: "police" },
    { source: "report", id: "2", kind: "itd" },
    { source: "osm", id: "n3", kind: "camera" },
    { source: "osm", id: "n4", kind: "camera" },
  ];
  it("kontrola znika po ostatnim „nie ma”, fotoradar dopiero przy wyraźnej przewadze", () => {
    const votes = new Map([
      ["report:1", { up: 1, down: 1, lastUp: 100, lastDown: 200 }],
      ["report:2", { up: 1, down: 1, lastUp: 300, lastDown: 200 }],
      ["osm:n3", { up: 0, down: 3, lastUp: null, lastDown: 1 }],
      ["osm:n4", { up: 2, down: 3, lastUp: 1, lastDown: 1 }],
    ]);
    expect(applyVotes(a, votes).map((w) => w.id)).toEqual(["2", "n4"]);
  });
});

describe("wysokość na moście przepisana z drogi pod nim (błąd w OSM)", () => {
  // Estakada Kwiatkowskiego (most, 3,5 m) i ulica Leszczynki pod nią (3,5 m) — dane z OSM.
  const estakada = { kind: "height", value: 3.5, bridge: 1, lat: 54.52732, lon: 18.48189, geom: [[54.52714, 18.48173], [54.52732, 18.48189], [54.52748, 18.48201]] };
  const leszczynki = { kind: "height", value: 3.5, bridge: 0, lat: 54.52721, lon: 18.48193, geom: [[54.52757, 18.48101], [54.52736, 18.48159], [54.52721, 18.48193], [54.5272, 18.48201]] };
  it("most z tą samą wartością co droga pod nim — pomijany; droga pod spodem zostaje", () => {
    expect(dropCopiedBridgeHeights([estakada, leszczynki])).toEqual([leszczynki]);
  });
  it("prawdziwe ograniczenie na moście (inna wartość albo nic pod spodem) — zostaje", () => {
    expect(dropCopiedBridgeHeights([estakada, { ...leszczynki, value: 3.2 }])).toHaveLength(2);
    expect(dropCopiedBridgeHeights([estakada])).toEqual([estakada]);
  });
});
