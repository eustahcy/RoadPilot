import { describe, expect, it } from "vitest";
import { breakStopFor } from "./breakstop";

// 80 km/h: km = min × 4/3.
const kmAfter = (min: number) => (min * 80) / 60;
const places = [
  { km: 100, kind: "mop" },
  { km: 300, kind: "services" },
  { km: 330, kind: "parking", truck: true },
  { km: 345, kind: "fuel" },
  { km: 360, kind: "mop" },
];

describe("miejsce na przerwę z zapasem", () => {
  it("najdalszy MOP / parking przed limitem minus zapas", () => {
    // 4 h 30 jazdy = 360 km; zapas 20 min → 333 km: parking TIR 330 km, stacja się nie liczy.
    const r = breakStopFor(places, 0, 270, 20, kmAfter)!;
    expect(r.place.km).toBe(330);
    expect(r.spareMin).toBeGreaterThanOrEqual(20);
  });
  it("większy zapas wybiera wcześniejsze miejsce; brak budżetu — nic", () => {
    expect(breakStopFor(places, 0, 270, 45, kmAfter)!.place.km).toBe(300);
    expect(breakStopFor(places, 0, 15, 20, kmAfter)).toBeUndefined();
  });
});
