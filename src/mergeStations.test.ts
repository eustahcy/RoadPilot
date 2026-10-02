import { describe, expect, it } from "vitest";
import { mergeStations } from "./components/PoiIcons";

describe("stacja przy MOP-ie = jedno miejsce", () => {
  it("stacja po tej samej stronie obok MOP-u znika, MOP dostaje markę", () => {
    const pois = [
      { km: 74.9, kind: "mop" as const, side: "left" as const, name: "MOP Lubień Południe" },
      { km: 74.95, kind: "fuel" as const, side: "left" as const, name: "Circle K" },
      { km: 75, kind: "fuel" as const, side: "right" as const, name: "Orlen" },
      { km: 103.2, kind: "services" as const, side: "left" as const, name: "MOP Machnacz", brand: "Orlen" },
    ];
    const out = mergeStations(pois);
    expect(out.map((p) => `${p.kind}:${p.name}:${p.brand ?? ""}`)).toEqual(["services:MOP Lubień Południe:Circle K", "fuel:Orlen:", "services:MOP Machnacz:Orlen"]);
  });
});
