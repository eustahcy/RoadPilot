import { describe, expect, it } from "vitest";
import { applyGapAnswer, gapSegments, GapReview, needsReview } from "./gapfix";
import type { DayLog } from "./history";
import type { DriverState } from "./plan";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 2, 8, 0);
const before: DriverState = { shiftStart: T0 - 6 * 60 * MIN, drivenTodayMin: 300, sinceBreakMin: 200, splitBreakTaken: false, extensionsLeft: 2, reducedRestsLeft: 3, weekDrivenMin: 1200, prevWeekDrivenMin: 2000 } as DriverState;
// Luka 2 h (08:00–10:00), 80 km; oszacowanie: 60 min jazdy, 60 min postoju.
const gap = { start: T0, end: T0 + 120 * MIN, km: 80, driveMin: 60, road: true };

/** Historia po oszacowaniu: 60 min jazdy w luce + 30 min jazdy po niej (do 10:30), szacowany postój w luce. */
const history = (): DayLog[] => [{ date: "2026-10-02", start: T0 - 60 * MIN, end: T0 + 150 * MIN, driveMin: 60 + 60 + 30, km: 200, stops: [{ start: T0, end: T0 + 60 * MIN, est: true }], gaps: [gap] }];

describe("luka — co robił kierowca", () => {
  const review: GapReview = { gap, before, driveTotal: 120 };

  it("pytamy o luki ≥ 15 min z przesunięciem ≥ 1 km", () => {
    expect(needsReview(gap)).toBe(true);
    expect(needsReview({ ...gap, km: 0.3 })).toBe(false);
    expect(needsReview({ ...gap, end: T0 + 10 * MIN })).toBe(false);
  });

  it("pauza 45 min na końcu i jazda: przerwa zaliczona, po luce 30 min jazdy", () => {
    const r = applyGapAnswer(review, { kind: "both", pauseMin: 45, pauseAt: "end" }, history(), T0 + 150 * MIN, null);
    expect(r.driver.sinceBreakMin).toBe(30);
    expect(r.driver.drivenTodayMin).toBe(300 + 75 + 30);
    expect(r.history[0].driveMin).toBe(60 + 75 + 30);
    expect(r.history[0].stops).toEqual([{ start: T0 + 75 * MIN, end: T0 + 120 * MIN }]);
    expect(r.history[0].gaps![0]).toMatchObject({ driveMin: 75, answered: true });
  });

  it("jazda cały czas: bez przerwy, ciągła jazda rośnie (ograniczona do 270)", () => {
    const r = applyGapAnswer(review, { kind: "drive" }, history(), T0 + 150 * MIN, null);
    expect(r.driver.drivenTodayMin).toBe(300 + 120 + 30);
    expect(r.driver.sinceBreakMin).toBe(270);
  });

  it("pauza na początku: najpierw postój 45 min, potem jazda — przerwa przed jazdą", () => {
    expect(gapSegments(gap, { kind: "both", pauseMin: 45, pauseAt: "start" }).map((s) => s.kind)).toEqual(["stop", "drive"]);
    const r = applyGapAnswer(review, { kind: "both", pauseMin: 45, pauseAt: "start" }, history(), T0 + 150 * MIN, null);
    expect(r.driver.sinceBreakMin).toBe(75 + 30);
  });
});
