import { describe, expect, it } from "vitest";
import { featureRows, parseValue } from "./osm.mjs";

describe("OSM → ograniczenia dla ciężarówek", () => {
  it("czyta wartości w różnych zapisach", () => {
    expect(parseValue("3.6", "m")).toBe(3.6);
    expect(parseValue("3,6 m", "m")).toBe(3.6);
    expect(parseValue("12'6\"", "m")).toBe(3.81);
    expect(parseValue("7.5 t", "t")).toBe(7.5);
    expect(parseValue("15 st", "t")).toBe(13.61);
    expect(parseValue("60 mph", "km/h")).toBe(96.56);
    expect(parseValue("none", "m")).toBeNull();
    expect(parseValue("default", "t")).toBeNull();
  });

  it("jeden obiekt → kilka ograniczeń; most; pomija bez ograniczeń", () => {
    const way = { type: "Feature", id: "w42", geometry: { type: "LineString", coordinates: [[19, 52], [19.001, 52.001], [19.002, 52.002]] }, properties: { maxweight: "15", maxaxleload: "8", bridge: "yes", name: "Most" } };
    const rows = featureRows(way);
    expect(rows.map((r) => [r.kind, r.value])).toEqual([["weight", 15], ["axle", 8]]);
    expect(rows[0]).toMatchObject({ osmId: "w42", bridge: 1, name: "Most", lat: 52.001, lon: 19.001 });
    expect(featureRows({ type: "Feature", id: "n1", geometry: { type: "Point", coordinates: [19, 52] }, properties: { highway: "crossing" } })).toEqual([]);
    expect(featureRows({ type: "Feature", id: "w2", geometry: { type: "LineString", coordinates: [[19, 52], [19.1, 52]] }, properties: { hgv: "no" } })[0]).toMatchObject({ kind: "hgv", value: null, raw: "no" });
    expect(featureRows({ type: "Feature", id: "w3", geometry: { type: "LineString", coordinates: [[19, 52], [19.1, 52]] }, properties: { hgv: "yes" } })).toEqual([]);
  });
});
