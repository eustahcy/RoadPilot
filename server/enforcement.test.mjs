import { describe, expect, it } from "vitest";
import { enforcementRows, parseOpl } from "./enforcement.mjs";

const opl = [
  "n1 v1 dV c1 t2022-01-01T00:00:00Z i1 ux Thighway=speed_camera,maxspeed=50 x19.0 y52.0",
  "n2 v1 dV c1 t2022-01-01T00:00:00Z i1 ux T x19.0 y51.99",
  "n3 v1 dV c1 t2022-01-01T00:00:00Z i1 ux Thighway=speed_camera x20.0 y53.0",
  "n4 v1 dV c1 t2022-01-01T00:00:00Z i1 ux T x21.0 y50.0",
  "n5 v1 dV c1 t2022-01-01T00:00:00Z i1 ux T x21.0 y50.05",
  "r10 v1 dV c1 t2022-01-01T00:00:00Z i1 ux Tenforcement=maxspeed,type=enforcement Mn2@from,n1@device",
  "r11 v1 dV c1 t2022-01-01T00:00:00Z i1 ux Tenforcement=average_speed,maxspeed=90,maxspeed:hgv=70,ref=PNW.O.2.001,type=enforcement Mn4@from,w7@section,n5@to",
  "r12 v1 dV c1 t2022-01-01T00:00:00Z i1 ux Tenforcement=toll,type=enforcement Mn4@device",
].map(parseOpl);

describe("OSM → fotoradary i odcinkowe pomiary", () => {
  it("czyta OPL z tagami i członkami (z kodowaniem %xx%)", () => {
    expect(parseOpl("r9 v1 Tname=A%20%B,type=enforcement Mn1@from,w2@section")).toMatchObject({ type: "r", id: "9", tags: { name: "A B" }, members: [{ type: "n", id: "1", role: "from" }, { type: "w", id: "2", role: "section" }] });
  });

  it("relacja z kierunkiem, fotoradar bez relacji, odcinek z limitem dla ciężarówek; pomija inne rodzaje", () => {
    const rows = enforcementRows(opl);
    expect(rows).toEqual([
      expect.objectContaining({ osmId: "r10", kind: "camera", value: 50, lat: 52, lon: 19, fromLat: 51.99, fromLon: 19 }),
      expect.objectContaining({ osmId: "r11", kind: "section", value: 70, lat: 50, toLat: 50.05, ref: "PNW.O.2.001" }),
      expect.objectContaining({ osmId: "n3", kind: "camera", value: null, fromLat: null }),
    ]);
  });
});
