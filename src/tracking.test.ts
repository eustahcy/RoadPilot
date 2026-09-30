import { describe, expect, it } from "vitest";
import { distanceM, Fix } from "./core/gps";
import { defaultState } from "./state";
import { applyFix, finishStop, startStop } from "./tracking";

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0);
const KM_PER_DEG = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) / 1000;
const fix = (min: number, km: number): Fix => ({ t: NOW + min * MIN, lat: km / KM_PER_DEG, lon: 0, accuracy: 10, speed: null });

/** Stan po `min` minutach postoju w miejscu (odczyt co 15 s), zaczynając od jazdy 250 min. */
function parked(min: number) {
  let s = defaultState(NOW);
  s = { ...s, settings: { ...s.settings, gps: true }, driver: { ...s.driver, drivenTodayMin: 250, sinceBreakMin: 250 } };
  for (let m = 0; m <= min; m += 0.25) s = applyFix(s, fix(m, 0));
  return s;
}

/** Ruszamy: 1 min jazdy 60 km/h. */
function driveOff(s: ReturnType<typeof parked>, fromMin: number) {
  for (let m = 0.25; m <= 1; m += 0.25) s = applyFix(s, fix(fromMin + m, m));
  return s;
}

describe("ręczny postój + GPS", () => {
  it("ruszenie bez „Koniec postoju” kończy postój i zalicza przerwę raz", () => {
    let s = startStop(parked(0), NOW, 45);
    for (let m = 0.25; m <= 50; m += 0.25) s = applyFix(s, fix(m, 0));
    s = driveOff(s, 50);
    expect(s.stop).toBeNull();
    expect(s.driver.sinceBreakMin).toBeGreaterThan(0);
    expect(s.driver.sinceBreakMin).toBeLessThanOrEqual(1);
    expect(s.driver.splitBreakTaken).toBe(false);
  });

  it("po ręcznym końcu GPS nie zalicza tego samego postoju drugi raz", () => {
    // 10 h postoju oznaczone ręcznie: skrócony odpoczynek zużyty tylko raz
    let s = startStop(parked(0), NOW, 600);
    for (let m = 0.25; m <= 600; m += 0.25) s = applyFix(s, fix(m, 0));
    s = finishStop(s, NOW + 600 * MIN);
    expect(s.driver.reducedRestsLeft).toBe(2);
    s = driveOff(s, 600);
    expect(s.driver.reducedRestsLeft).toBe(2);
    expect(s.driver.shiftStart).toBe(NOW + 600 * MIN);
  });
});
