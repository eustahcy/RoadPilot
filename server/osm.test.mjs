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

describe("ograniczenia warunkowe z OSM", () => {
  const way = (tags) => ({ id: "w1", properties: tags, geometry: { type: "LineString", coordinates: [[19, 52], [19.001, 52.001]] } });
  it("maxweight 12 + none @ destination → wiersz masy z warunkiem", () => {
    const [r] = featureRows(way({ maxweight: "12", "maxweight:conditional": "none @ destination" }));
    expect(r).toMatchObject({ kind: "weight", value: 12 });
    expect(JSON.parse(r.cond)).toEqual([{ value: "none", users: ["destination"] }]);
  });
  it("sam zakaz nocny (hgv:conditional) → osobny wiersz hgv bez wartości stałej", () => {
    const rows = featureRows(way({ highway: "residential", "hgv:conditional": "no @ (22:00-06:00)" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "hgv", value: null, raw: "" });
    expect(JSON.parse(rows[0].cond)[0].value).toBe("no");
  });
});

describe("strome odcinki (incline)", () => {
  const way = (tags) => ({ id: "w2", properties: tags, geometry: { type: "LineString", coordinates: [[19, 52], [19.001, 52.001]] } });
  it("≥ 8% → ograniczenie incline z wartością bezwzględną; łagodne i bez liczby pomijane", () => {
    expect(featureRows(way({ incline: "-12%" }))[0]).toMatchObject({ kind: "incline", value: 12 });
    expect(featureRows(way({ incline: "5%" }))).toEqual([]);
    expect(featureRows(way({ incline: "up" }))).toEqual([]);
  });
});
