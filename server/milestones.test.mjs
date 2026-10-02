import { describe, expect, it } from "vitest";
import { milestoneRow, parseMilestone, routeMilestones } from "./milestones.mjs";

describe("słupki kilometrowe", () => {
  it("parsuje km w różnych zapisach", () => {
    expect(parseMilestone("432")).toBe(432);
    expect(parseMilestone("432,5")).toBe(432.5);
    expect(parseMilestone("432+400")).toBeCloseTo(432.4);
    expect(parseMilestone("abc")).toBeNull();
  });
  it("wiersz z OSM i rzut na trasę", () => {
    const row = milestoneRow({ geometry: { coordinates: [19, 52.009] }, properties: { distance: "358", ref: "A1" } });
    expect(row).toMatchObject({ km: 358, ref: "A1" });
    const route = Array.from({ length: 21 }, (_, i) => [52 + i * 0.0009, 19, i * 0.1]);
    expect(routeMilestones(route, [row, { ...row, lon: 19.01 }])).toEqual([{ km: 1, v: 358, ref: "A1" }]);
  });
});
