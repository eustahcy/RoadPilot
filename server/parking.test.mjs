import { describe, expect, it } from "vitest";
import { boxAround, cleanParking, distanceM, parkingView } from "./parking.mjs";

describe("cleanParking", () => {
  it("zaokrągla pozycję i przycina tekst", () => {
    expect(cleanParking({ lat: 52.1234567, lon: 21.7654321, status: 2, label: "  Magazyn   DC2 ", note: " plac  na 10 aut " })).toEqual({
      lat: 52.12346, lon: 21.76543, label: "Magazyn DC2", status: 2, note: "plac na 10 aut",
    });
  });
  it("odrzuca brak pozycji i nieznany status", () => {
    expect(() => cleanParking({ status: 2 })).toThrow("Brak położenia celu.");
    expect(() => cleanParking({ lat: 52, lon: 21, status: 5 })).toThrow("Wybierz, czy jest parking.");
    expect(() => cleanParking({ lat: 52, lon: 21 })).toThrow("Wybierz, czy jest parking.");
  });
  it("status 0 (brak parkingu) jest poprawny", () => {
    expect(cleanParking({ lat: 52, lon: 21, status: 0 }).status).toBe(0);
  });
});

describe("boxAround", () => {
  it("obejmuje punkty w promieniu", () => {
    const b = boxAround(52, 21, 300);
    const p = { lat: 52.001, lon: 21.002 };
    expect(distanceM({ lat: 52, lon: 21 }, p)).toBeLessThan(300);
    expect(p.lat).toBeLessThan(b.maxLat);
    expect(p.lon).toBeLessThan(b.maxLon);
  });
});

describe("parkingView", () => {
  const at = { lat: 52, lon: 21 };
  const row = (o) => ({ id: 1, user_id: 7, lat: 52, lon: 21, status: 2, note: "", label: "", updated_at: "2026-09-30T10:00:00Z", up: 0, down: 0, my_vote: null, ...o });

  it("odrzuca opinie spoza promienia i sortuje po potwierdzeniach", () => {
    const v = parkingView([row({ id: 1, up: 1 }), row({ id: 2, up: 5, down: 1 }), row({ id: 3, lat: 52.01 })], at, 9);
    expect(v.items.map((o) => o.id)).toEqual([2, 1]);
    expect(v.items[0]).toMatchObject({ distanceM: 0, mine: false, myVote: 0 });
  });
  it("podsumowanie pomija opinie z przewagą zaprzeczeń", () => {
    const v = parkingView([row({ id: 1, status: 2 }), row({ id: 2, status: 0, down: 3, up: 1 }), row({ id: 3, status: 1 })], at, 7);
    expect(v.summary).toEqual({ yes: 1, limited: 1, no: 0 });
    expect(v.items.every((o) => o.mine)).toBe(true);
  });
});
