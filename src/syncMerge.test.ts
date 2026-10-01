import { describe, expect, it } from "vitest";
import { defaultState } from "./state";
import { mergeStates } from "./syncMerge";

const NOW = Date.UTC(2026, 9, 1, 6, 0);
const H = 3_600_000;
const day = (date: string, km: number) => ({ date, start: null, end: null, driveMin: 0, km, stops: [] });

describe("mergeStates", () => {
  // Telefon B ma stan z wczoraj (przed odpoczynkiem), telefon A rano zrobił „Rozpocznij dzień” i wysłał na konto.
  const yesterday = { ...defaultState(NOW - 14 * H), driver: { ...defaultState(NOW).driver, shiftStart: NOW - 26 * H, drivenTodayMin: 540, sinceBreakMin: 200 }, tracker: { device: "B", at: NOW - 13 * H } };
  const morning = { ...defaultState(NOW), driver: { ...defaultState(NOW).driver, shiftStart: NOW - H, drivenTodayMin: 0 }, tracker: { device: "A", at: NOW - 0.5 * H } };

  it("wczorajszy stan nie nadpisuje porannego „Rozpocznij dzień” z innego urządzenia", () => {
    const r = mergeStates(yesterday, { tacho: NOW - 13 * H }, morning, { tacho: NOW - H }, "B");
    expect(r.state.driver.shiftStart).toBe(NOW - H);
    expect(r.state.driver.drivenTodayMin).toBe(0);
    expect(r.localWon).toEqual([]);
    // Jazdę liczyło A — licznik GPS w B od nowa (bez doliczania luki od wczoraj).
    expect(r.resetTrack).toBe(true);
    expect(r.state.track).toBeNull();
  });

  it("nowsza zmiana na tym urządzeniu zostaje i jest do wysłania; reszta grup z konta", () => {
    const local = { ...yesterday, settings: { ...yesterday.settings, aheadKm: 80 } };
    const r = mergeStates(local, { tacho: NOW - 13 * H, settings: NOW - 0.2 * H }, morning, { tacho: NOW - H, settings: NOW - 30 * H }, "B");
    expect(r.state.settings.aheadKm).toBe(80);
    expect(r.state.driver.shiftStart).toBe(NOW - H);
    expect(r.localWon).toEqual(["settings"]);
    expect(r.stamps).toMatchObject({ tacho: NOW - H, settings: NOW - 0.2 * H });
  });

  it("bez znaczników (stan sprzed tej wersji) — wygrywa konto", () => {
    const r = mergeStates(yesterday, {}, morning, {}, "B");
    expect(r.state.driver).toEqual(morning.driver);
  });

  it("to urządzenie liczyło jazdę — licznik GPS zostaje", () => {
    const r = mergeStates({ ...morning, track: { anchor: { lat: 1, lon: 1, accuracy: 5 }, lastT: NOW, odoKm: 0, samples: [], stopSince: null } }, {}, { ...morning, tracker: { device: "A", at: NOW }, odoKm: 5 }, { tacho: NOW }, "A");
    expect(r.resetTrack).toBe(false);
    expect(r.state.track).not.toBeNull();
  });

  it("historia: dni z obu urządzeń, ten sam dzień z nowszego", () => {
    const local = { ...morning, history: [day("2026-10-01", 50), day("2026-09-29", 300)] };
    const remote = { ...morning, history: [day("2026-10-01", 120), day("2026-09-30", 600)] };
    const r = mergeStates(local, { history: NOW - 2 * H }, remote, { history: NOW - H }, "B");
    expect(r.state.history.map((d) => [d.date, d.km])).toEqual([["2026-10-01", 120], ["2026-09-30", 600], ["2026-09-29", 300]]);
    expect(r.localWon).toEqual(["history"]);
  });

  it("pola tylko tego urządzenia zostają", () => {
    const r = mergeStates({ ...yesterday, hud: true, navOpen: true, planTime: 123 }, {}, morning, {}, "B");
    expect(r.state).toMatchObject({ hud: true, navOpen: true, planTime: 123 });
  });
});
