import { describe, expect, it } from "vitest";
import { gapRoute, pickPlace, pickPoi, placeRow, roadLabel } from "./geo.mjs";

describe("placeRow", () => {
  it("miejscowość z nazwą polską; inne rodzaje i bez nazwy pomijane", () => {
    expect(placeRow({ id: "n1", geometry: { type: "Point", coordinates: [19.66, 51.9] }, properties: { place: "town", name: "Stryków" } })).toEqual({ osmId: "n1", kind: "town", lat: 51.9, lon: 19.66, name: "Stryków" });
    expect(placeRow({ id: "n2", geometry: { type: "Point", coordinates: [19, 51] }, properties: { place: "hamlet", name: "X" } })).toBeNull();
    expect(placeRow({ id: "n3", geometry: { type: "Point", coordinates: [19, 51] }, properties: { place: "village" } })).toBeNull();
  });
});

describe("pickPlace", () => {
  const town = { name: "Stryków", kind: "town", lat: 51.9, lon: 19.6 };
  const village = { name: "Niesułków", kind: "village", lat: 51.88, lon: 19.65 };
  it("w miejscowości — ta, w której jesteśmy", () => {
    expect(pickPlace([town, village], { lat: 51.881, lon: 19.651 })).toMatchObject({ name: "Niesułków", inside: true });
    expect(pickPlace([town, village], { lat: 51.905, lon: 19.6 })).toMatchObject({ name: "Stryków", inside: true });
  });
  it("poza — najbliższa z odległością; daleko — nic", () => {
    const r = pickPlace([town], { lat: 51.95, lon: 19.6 });
    expect(r).toMatchObject({ name: "Stryków", inside: false });
    expect(r.km).toBeCloseTo(5.6, 0);
    expect(pickPlace([town], { lat: 52.2, lon: 19.6 })).toBeNull();
  });
});

describe("pickPoi", () => {
  it("najbliższe w 700 m", () => {
    const rows = [{ kind: "mop", name: "MOP Niesułków", lat: 51.9, lon: 19.66 }, { kind: "fuel", name: "Orlen", lat: 51.903, lon: 19.66 }];
    expect(pickPoi(rows, { lat: 51.9005, lon: 19.66 })).toMatchObject({ kind: "mop", name: "MOP Niesułków" });
    expect(pickPoi(rows, { lat: 51.95, lon: 19.66 })).toBeNull();
  });
});

describe("roadLabel", () => {
  it("autostrada, krajowa, wojewódzka, ulica", () => {
    expect(roadLabel(["A2", "Autostrada Wolności", "E30"])).toBe("A2");
    expect(roadLabel(["Łódzka", "14"])).toBe("DK 14, Łódzka");
    expect(roadLabel(["Ozorkowska", "708"])).toBe("DW 708, Ozorkowska");
    expect(roadLabel(["Polna"])).toBe("Polna");
    expect(roadLabel([])).toBeNull();
  });
});

describe("gapRoute", () => {
  it("km i minuty z podsumowania trasy", () => {
    expect(gapRoute({ trip: { summary: { length: 123.45, time: 5430 } } })).toEqual({ km: 123.5, min: 90.5 });
    expect(gapRoute({})).toBeNull();
  });
});
