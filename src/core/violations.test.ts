import { describe, expect, it } from "vitest";
import { creditDriving } from "./gps";
import { DayLog } from "./history";
import { DriverState } from "./plan";
import { RULES } from "./rules";
import { allViolations, restViolation, trackViolations, violationReport, whereText } from "./violations";

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0);
const driver = (over: Partial<DriverState> = {}): DriverState => ({
  shiftStart: NOW - 300 * MIN, drivenTodayMin: 0, sinceBreakMin: 0, splitBreakTaken: false, extensionsLeft: 0, reducedRestsLeft: 3, weekDrivenMin: 0, prevWeekDrivenMin: 0, ...over,
});

/** Jazda po minucie przez `min` minut od `fromMin` — jak applyFix: najpierw przekroczenia, potem liczniki. */
function drive(log: DayLog[], d: DriverState, fromMin: number, min: number) {
  for (let m = 1; m <= min; m++) {
    const t = NOW + (fromMin + m) * MIN;
    log = trackViolations(log, d, { t, driveMin: 1, driveEnd: t, lat: 52, lon: 19 });
    d = creditDriving(d, 1);
  }
  return { log, d };
}

describe("trackViolations", () => {
  it("jazda bez przerwy: przekroczenie od chwili 4 h 30 min, rośnie do przerwy, potem się zamyka", () => {
    let r = drive([], driver({ sinceBreakMin: 260, drivenTodayMin: 260 }), 0, 35);
    let v = allViolations(r.log).filter((x) => x.kind === "continuous");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ t: NOW + 10 * MIN, limitMin: 270, overMin: 25, open: true, lat: 52, lon: 19 });
    // Przerwa 45 min (licznik od przerwy = 0) → kolejna jazda zamyka przekroczenie, nowe się nie pojawia.
    r = drive(r.log, { ...r.d, sinceBreakMin: 0 }, 80, 5);
    v = allViolations(r.log).filter((x) => x.kind === "continuous");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ overMin: 25, open: false });
  });

  it("dzienny czas jazdy: 9 h bez wydłużeń, 10 h z wydłużeniem", () => {
    const no = drive([], driver({ drivenTodayMin: 530 }), 0, 20);
    expect(allViolations(no.log).find((x) => x.kind === "daily")).toMatchObject({ limitMin: RULES.dailyDrive, overMin: 10 });
    const ext = drive([], driver({ drivenTodayMin: 530, extensionsLeft: 1 }), 0, 20);
    expect(allViolations(ext.log).find((x) => x.kind === "daily")).toBeUndefined();
  });

  it("okres pracy: jazda po 15 h od początku dnia (są skrócone odpoczynki), po 13 h bez nich", () => {
    const late = drive([], driver({ shiftStart: NOW - 15 * 60 * MIN }), 0, 30);
    expect(allViolations(late.log).find((x) => x.kind === "duty")).toMatchObject({ t: NOW, overMin: 30, limitMin: 900 });
    const noReduced = drive([], driver({ shiftStart: NOW - 13 * 60 * MIN, reducedRestsLeft: 0 }), 0, 10);
    expect(allViolations(noReduced.log).find((x) => x.kind === "duty")).toMatchObject({ overMin: 10, limitMin: 780 });
  });

  it("bez przekroczeń nic nie zapisuje", () => {
    expect(drive([], driver(), 0, 60).log.every((d) => !d.violations?.length)).toBe(true);
  });
});

describe("restViolation", () => {
  it("„Rozpocznij dzień” po 7 h odpoczynku — krótszy o 2 h", () => {
    const log = restViolation([], driver(), NOW, NOW + 420 * MIN, { lat: 52, lon: 19 }, true);
    expect(allViolations(log)[0]).toMatchObject({ kind: "shortRest", limitMin: 540, overMin: 120 });
  });
  it("10 h bez skróconych odpoczynków — krótszy o 1 h; zwykła przerwa z GPS to nie odpoczynek", () => {
    expect(allViolations(restViolation([], driver({ reducedRestsLeft: 0 }), NOW, NOW + 600 * MIN, null, false))[0]).toMatchObject({ limitMin: 660, overMin: 60 });
    expect(restViolation([], driver(), NOW, NOW + 45 * MIN, null, false)).toEqual([]);
    expect(restViolation([], driver(), NOW, NOW + 600 * MIN, null, false)).toEqual([]);
  });
});

describe("opis do wydruku", () => {
  const where = { place: { name: "Nowostawy Dolne", km: 1, inside: true }, road: "A2", poi: { kind: "services" as const, name: "MOP Niesułków", m: 4 } };
  it("miejsce: miejscowość, droga, MOP", () => {
    expect(whereText(where)).toBe("Nowostawy Dolne, A2, przy: MOP Niesułków");
    expect(whereText({ place: { name: "Stryków", km: 4.2, inside: false }, road: null, poi: { kind: "fuel", name: "Orlen", m: 300 } })).toBe("okolice: Stryków (4,2 km), przy: stacja Orlen");
  });
  it("wydruk i notatka z limitem, przekroczeniem i powodem", () => {
    const v = { id: "continuous:1", kind: "continuous" as const, t: NOW, limitMin: 270, overMin: 25, where, lat: 51.8977, lon: 19.7063 };
    const r = violationReport(v, "brak wolnych miejsc parkingowych dla ciężarówek");
    expect(r.summary).toBe("Limit 4 h 30 min przekroczony o 25 min.");
    expect(r.printout).toContain("  limit 4h30   przekr. 0h25");
    expect(r.printout).toContain("Miejsce: Nowostawy Dolne, A2, przy: MOP Niesułków");
    expect(r.note).toMatch(/^Art\. 12 rozp\. \(WE\) 561\/2006 — przekroczenie nieprzerwanego czasu jazdy o 25 min \(30\.09\.2026, .* w celu dotarcia do odpowiedniego miejsca postoju\. Przyczyna: brak wolnych miejsc parkingowych dla ciężarówek\. Miejsce: Nowostawy Dolne, A2, przy: MOP Niesułków\.\n\[imię i nazwisko\]/);
  });
});
