import { describe, expect, it } from "vitest";
import { DriverState } from "./plan";
import { endStop, nextStopThreshold, planAfterStop, stopCredit, stopEnd, suggestedStop } from "./stop";

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0);

const driver = (over: Partial<DriverState> = {}): DriverState => ({
  shiftStart: NOW - 300 * MIN,
  drivenTodayMin: 250,
  sinceBreakMin: 250,
  splitBreakTaken: false,
  extensionsLeft: 2,
  reducedRestsLeft: 3,
  weekDrivenMin: 1000,
  prevWeekDrivenMin: 0,
  ...over,
});

describe("ręczny postój", () => {
  it("proponuje 45 min, a po 15-minutowej części 30 min", () => {
    expect(suggestedStop(driver())).toBe(45);
    expect(suggestedStop(driver({ splitBreakTaken: true }))).toBe(30);
  });

  it("zalicza wg faktycznej długości", () => {
    const d = driver();
    expect([10, 15, 44, 45, 539, 540, 660].map((m) => stopCredit(d, m))).toEqual(["none", "splitFirst", "splitFirst", "break", "break", "reducedRest", "dailyRest"]);
    expect(stopCredit(driver({ splitBreakTaken: true }), 30)).toBe("break");
    expect(stopCredit(driver({ splitBreakTaken: true }), 20)).toBe("none");
  });

  it("podaje następny próg", () => {
    expect(nextStopThreshold(driver(), 5)).toEqual({ at: 15, credit: "splitFirst" });
    expect(nextStopThreshold(driver(), 20)).toEqual({ at: 45, credit: "break" });
    expect(nextStopThreshold(driver({ splitBreakTaken: true }), 5)).toEqual({ at: 30, credit: "break" });
    expect(nextStopThreshold(driver(), 600)).toEqual({ at: 660, credit: "dailyRest" });
    expect(nextStopThreshold(driver(), 700)).toBeUndefined();
  });

  it("krótsza przerwa niż planowana: 20 min z 45 zalicza tylko 15-minutową część", () => {
    const d = endStop(driver(), { start: NOW, targetMin: 45 }, NOW + 20 * MIN);
    expect(d.splitBreakTaken).toBe(true);
    expect(d.sinceBreakMin).toBe(250);
  });

  it("dłuższa przerwa: 9 h 30 min zamiast 45 min = skrócony odpoczynek dzienny", () => {
    const end = NOW + 570 * MIN;
    const d = endStop(driver(), { start: NOW, targetMin: 45 }, end);
    expect(d).toMatchObject({ shiftStart: end, drivenTodayMin: 0, sinceBreakMin: 0, reducedRestsLeft: 2 });
  });

  it("koniec przed startem nic nie zmienia", () => {
    const d = driver();
    expect(endStop(d, { start: NOW, targetMin: 45 }, NOW - MIN)).toBe(d);
  });

  it("plan w trakcie: liczy od końca planowanej przerwy, a gdy już dłużej — od teraz", () => {
    const stop = { start: NOW, targetMin: 45 };
    const a = planAfterStop(driver(), stop, NOW + 10 * MIN);
    expect(a.from).toBe(NOW + 45 * MIN);
    expect(a.driver.sinceBreakMin).toBe(0);
    const b = planAfterStop(driver(), stop, NOW + 60 * MIN);
    expect(b.from).toBe(NOW + 60 * MIN);
  });
});

describe("postój bez limitu", () => {
  const T0 = Date.UTC(2026, 8, 30, 12, 0);
  const drv = { shiftStart: T0 - 300 * MIN, drivenTodayMin: 270, sinceBreakMin: 270, splitBreakTaken: false, extensionsLeft: 2, reducedRestsLeft: 3, weekDrivenMin: 270, prevWeekDrivenMin: 0 };

  it("plan liczy od teraz z zaliczonym czasem postoju", () => {
    const stop = { start: T0, targetMin: null };
    expect(stopEnd(stop)).toBeUndefined();
    const short = planAfterStop(drv, stop, T0 + 20 * MIN);
    expect(short.from).toBe(T0 + 20 * MIN);
    expect(short.driver.splitBreakTaken).toBe(true);
    const long = planAfterStop(drv, stop, T0 + 50 * MIN);
    expect(long.driver.sinceBreakMin).toBe(0);
  });
});
