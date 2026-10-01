import { describe, expect, it } from "vitest";
import { distanceM, Fix } from "./core/gps";
import { defaultState } from "./state";
import { applyFix, endDay, finishStop, startDay, startStop, TRACKER_TTL_MS } from "./tracking";

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

  it("pojedynczy fałszywy odczyt ruchu nie kończy przerwy (nie zaczyna jej od nowa)", () => {
    let s = startStop(parked(0), NOW, 45);
    for (let m = 0.25; m <= 20; m += 0.25) s = applyFix(s, fix(m, 0));
    s = applyFix(s, { ...fix(20.25, 0.04), speed: 6 }); // 40 m, 22 km/h — szum w kabinie
    for (let m = 20.5; m <= 30; m += 0.25) s = applyFix(s, fix(m, 0));
    expect(s.stop).toEqual({ start: NOW, targetMin: 45 });
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

describe("historia z GPS", () => {
  it("postój zakończony ruszeniem trafia do historii razem z jazdą", () => {
    let s = startStop(parked(0), NOW, 45, true);
    for (let m = 0.25; m <= 50; m += 0.25) s = applyFix(s, fix(m, 0));
    s = driveOff(s, 50);
    const day = s.history[0];
    expect(day.stops).toHaveLength(1);
    expect(day.stops[0].start).toBe(NOW);
    expect(day.driveMin).toBeCloseTo(1);
    expect(day.km).toBeCloseTo(1, 1);
  });
});

describe("dzień pracy", () => {
  it("„Zakończ dzień” → odpoczynek; „Rozpocznij dzień” zalicza go i zeruje liczniki", () => {
    let s = endDay(parked(0), NOW);
    expect(s.stop).toEqual({ start: NOW, targetMin: 660, dayEnd: true });
    s = startDay(s, NOW + 11 * 60 * MIN);
    expect(s.stop).toBeNull();
    expect(s.driver).toMatchObject({ shiftStart: NOW + 11 * 60 * MIN, drivenTodayMin: 0, sinceBreakMin: 0, reducedRestsLeft: 3 });
    expect(s.history[0].stops).toHaveLength(1);
  });

  it("trwający postój staje się odpoczynkiem od swojego początku; ruszenie kończy odpoczynek", () => {
    let s = startStop(parked(0), NOW, null, true);
    s = endDay(s, NOW + 10 * MIN);
    expect(s.stop?.start).toBe(NOW);
    for (let m = 0.25; m <= 600; m += 0.25) s = applyFix(s, fix(m, 0));
    s = driveOff(s, 600);
    expect(s.stop).toBeNull();
    expect(s.driver.reducedRestsLeft).toBe(2);
    expect(s.driver.drivenTodayMin).toBeLessThanOrEqual(1);
  });
});

describe("dwa urządzenia na jednym koncie", () => {
  /** Jazda 60 km/h od `from` do `to` minut na urządzeniu `dev`. */
  function drive(s: ReturnType<typeof defaultState>, dev: string, from: number, to: number) {
    for (let m = from; m <= to; m += 0.25) s = applyFix(s, fix(m, m), dev);
    return s;
  }

  it("jazdę dolicza tylko urządzenie, które ją liczy — drugie prowadzi tylko własny licznik", () => {
    const phone = drive(defaultState(NOW), "phone", 0, 10);
    expect(phone.tracker).toMatchObject({ device: "phone" });
    expect(phone.driver.drivenTodayMin).toBeCloseTo(10, 0);
    // Tablet dostał stan z konta i też ma GPS: nie dolicza tych samych minut drugi raz.
    const tablet = drive({ ...phone, track: null }, "tablet", 10.25, 12);
    expect(tablet.driver.drivenTodayMin).toBe(phone.driver.drivenTodayMin);
    expect(tablet.track).not.toBeNull();
  });

  it("gdy liczące urządzenie milknie (aplikacja w tle), po TRACKER_TTL_MS przejmuje drugie — bez podwójnego liczenia", () => {
    const phone = drive(defaultState(NOW), "phone", 0, 10);
    const ttlMin = TRACKER_TTL_MS / MIN;
    let tablet = drive({ ...phone, track: null }, "tablet", 10.25, 10 + ttlMin - 0.25);
    expect(tablet.driver.drivenTodayMin).toBe(phone.driver.drivenTodayMin);
    tablet = drive(tablet, "tablet", 10 + ttlMin + 0.25, 20);
    expect(tablet.tracker).toMatchObject({ device: "tablet" });
    // Doliczone tylko minuty od przejęcia (nie cały czas od startu licznika tabletu).
    expect(tablet.driver.drivenTodayMin - phone.driver.drivenTodayMin).toBeCloseTo(20 - 10 - ttlMin, 0);
  });
});
