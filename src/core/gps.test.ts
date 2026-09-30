import { describe, expect, it } from "vitest";
import { addFix, creditDriving, creditStop, distanceM, Fix, GPS, GpsTrack, recentSpeed, startTrack } from "./gps";
import { DriverState } from "./plan";
import { remainingSegments } from "./route";

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0);
const KM_PER_DEG = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) / 1000;

/** Odczyt na południku 0: `km` na północ od równika, `min` minut po NOW. */
const fix = (min: number, km: number, over: Partial<Fix> = {}): Fix => ({ t: NOW + min * MIN, lat: km / KM_PER_DEG, lon: 0, accuracy: 10, speed: null, ...over });

/** Jazda ze stałą prędkością, odczyt co `every` min. */
function drive(track: GpsTrack, fromMin: number, fromKm: number, minutes: number, kmh: number, every = 0.25) {
  let t = track;
  let km = 0;
  let driveMin = 0;
  const ended: { start: number; end: number }[] = [];
  for (let m = every; m <= minutes + 1e-9; m += every) {
    const r = addFix(t, fix(fromMin + m, fromKm + (kmh * m) / 60));
    t = r.track;
    km += r.km;
    driveMin += r.driveMin;
    if (r.stopEnded) ended.push(r.stopEnded);
  }
  return { track: t, km, driveMin, ended };
}

const driver = (over: Partial<DriverState> = {}): DriverState => ({
  shiftStart: NOW - 120 * MIN,
  drivenTodayMin: 100,
  sinceBreakMin: 100,
  splitBreakTaken: false,
  extensionsLeft: 2,
  reducedRestsLeft: 3,
  weekDrivenMin: 1000,
  prevWeekDrivenMin: 0,
  ...over,
});

describe("GPS — licznik km", () => {
  it("odlicza przejechane km i czas jazdy", () => {
    const r = drive(startTrack(fix(0, 0)), 0, 0, 30, 80);
    expect(r.km).toBeCloseTo(40, 1);
    expect(r.driveMin).toBeCloseTo(30, 6);
    expect(r.track.odoKm).toBeCloseTo(40, 1);
  });

  it("na postoju „pływanie” pozycji nie dodaje km ani jazdy", () => {
    let t = startTrack(fix(0, 0));
    let km = 0;
    let driveMin = 0;
    for (let m = 1; m <= 20; m++) {
      const r = addFix(t, fix(m, (m % 2 ? 0.012 : -0.008), { accuracy: 15 }));
      t = r.track;
      km += r.km;
      driveMin += r.driveMin;
    }
    expect(km).toBe(0);
    expect(driveMin).toBe(0);
    expect(t.stopSince).toBe(NOW);
  });

  it("pomija niedokładne odczyty i skoki pozycji", () => {
    const t = startTrack(fix(0, 0));
    expect(addFix(t, fix(1, 5, { accuracy: 500 })).track).toBe(t);
    expect(addFix(t, fix(1, 50)).km).toBe(0); // 3000 km/h
  });

  it("zgłasza koniec postoju, gdy ruszamy", () => {
    let t = drive(startTrack(fix(0, 0)), 0, 0, 10, 60).track;
    for (let m = 11; m <= 55; m++) t = addFix(t, fix(m, 10)).track;
    const r = drive(t, 55, 10, 5, 60);
    expect(r.ended).toEqual([{ start: NOW + 10 * MIN, end: NOW + 55 * MIN }]);
  });

  it("luka w odczytach: droga ×1,2, jazda szacowana ze średniej, bez zaliczania przerwy", () => {
    const t = drive(startTrack(fix(0, 0)), 0, 0, 10, 60).track;
    const r = addFix(t, fix(130, 10 + 100)); // 2 h bez odczytów, 100 km w linii prostej
    expect(r.km).toBeCloseTo(120, 1);
    expect(r.driveMin).toBeCloseTo((120 / GPS.gapAvgKmh) * 60, 3);
    expect(r.stopEnded).toBeUndefined();
  });

  it("luka bez ruchu to postój — np. odpoczynek przy zamkniętej aplikacji", () => {
    const t = drive(startTrack(fix(0, 0)), 0, 0, 10, 60).track;
    const night = addFix(t, fix(10 + 660, 10)).track;
    const r = drive(night, 670, 10, 1, 60);
    expect(r.ended[0]).toEqual({ start: NOW + 10 * MIN, end: NOW + 670 * MIN });
  });
});

describe("GPS — średnia z ostatnich 10 min", () => {
  it("liczy prędkość z okna 10 min, a nie z całej jazdy", () => {
    let r = drive(startTrack(fix(0, 0)), 0, 0, 20, 40);
    r = drive(r.track, 20, r.track.odoKm, 10, 80);
    expect(recentSpeed(r.track, NOW + 30 * MIN)).toBeCloseTo(80, 0);
  });

  it("za mało danych lub dawno brak odczytów — brak średniej", () => {
    const r = drive(startTrack(fix(0, 0)), 0, 0, 3, 80);
    expect(recentSpeed(r.track, NOW + 3 * MIN)).toBeUndefined();
    const long = drive(startTrack(fix(0, 0)), 0, 0, 12, 80);
    expect(recentSpeed(long.track, NOW + 12 * MIN)).toBeCloseTo(80, 0);
    expect(recentSpeed(long.track, NOW + 20 * MIN)).toBeUndefined();
  });
});

describe("GPS — liczniki kierowcy", () => {
  it("dolicza jazdę do dnia, od przerwy i tygodnia", () => {
    const d = creditDriving(driver(), 30);
    expect([d.drivenTodayMin, d.sinceBreakMin, d.weekDrivenMin]).toEqual([130, 130, 1030]);
  });

  it("zalicza przerwę 45 min i dzieloną 15 + 30 min", () => {
    expect(creditStop(driver(), NOW, NOW + 45 * MIN).sinceBreakMin).toBe(0);
    const first = creditStop(driver(), NOW, NOW + 20 * MIN);
    expect(first).toMatchObject({ splitBreakTaken: true, sinceBreakMin: 100 });
    expect(creditStop(first, NOW, NOW + 30 * MIN)).toMatchObject({ splitBreakTaken: false, sinceBreakMin: 0 });
    expect(creditStop(driver(), NOW, NOW + 10 * MIN)).toEqual(driver());
  });

  it("postój ≥ 9 h to odpoczynek dzienny — nowy dzień pracy", () => {
    const d = creditStop(driver(), NOW, NOW + 600 * MIN);
    expect(d).toMatchObject({ shiftStart: NOW + 600 * MIN, drivenTodayMin: 0, sinceBreakMin: 0, reducedRestsLeft: 2 });
    expect(creditStop(driver(), NOW, NOW + 700 * MIN).reducedRestsLeft).toBe(3);
  });
});

describe("remainingSegments", () => {
  it("obcina przejechane km od początku trasy", () => {
    const segs = [{ type: "urban" as const, km: 10 }, { type: "motorway" as const, km: 100 }];
    expect(remainingSegments(segs, 25)).toEqual([{ type: "motorway", km: 85 }]);
    expect(remainingSegments(segs, 0)).toEqual(segs);
    expect(remainingSegments(segs, 500)).toEqual([]);
  });
});
