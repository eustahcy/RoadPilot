import { describe, expect, it } from "vitest";
import { DriverState, parkingHint, simulate, timeAtKm } from "./plan";
import { reconstruct, reconstructTimed } from "./reconstruct";
import { DEFAULT_SPEEDS, Route, Segment, segmentsFromProfile, Speeds } from "./route";
import { betterOption, compareScenarios, explain, whatIfs } from "./scenarios";

const MIN = 60_000;
// Środa 30.09.2026 12:00 UTC (testy uruchamiane z TZ=UTC)
const NOW = Date.UTC(2026, 8, 30, 12, 0);
const FLAT: Speeds = { motorway: 60, expressway: 60, rural: 60, urban: 60, mixed: 60 };
const flat = (km: number) => new Route([{ type: "motorway", km }], FLAT);

const fresh = (over: Partial<DriverState> = {}): DriverState => ({
  shiftStart: NOW,
  drivenTodayMin: 0,
  sinceBreakMin: 0,
  splitBreakTaken: false,
  extensionsLeft: 0,
  reducedRestsLeft: 0,
  weekDrivenMin: 0,
  prevWeekDrivenMin: 0,
  ...over,
});
const OFF = { allowExtension: false, allowReducedRest: false };
const at = (min: number) => NOW + min * MIN;
const kinds = (p: ReturnType<typeof simulate>) => p.events.map((e) => `${e.kind}:${Math.round((e.end - e.start) / MIN)}`);

describe("Route", () => {
  it("liczy czas odcinkami, nie jedną średnią", () => {
    const segs: Segment[] = [{ type: "urban", km: 16 }, { type: "motorway", km: 78 }];
    const r = new Route(segs, DEFAULT_SPEEDS);
    expect(r.driveMinutes(0)).toBeCloseTo(30 + 60, 6);
    expect(r.advance(0, 30)).toBeCloseTo(16, 6);
    expect(r.advance(0, 60)).toBeCloseTo(16 + 39, 6);
  });

  it("zapas na ruch wydłuża czas jazdy", () => {
    expect(new Route([{ type: "motorway", km: 60 }], FLAT, 10).driveMinutes(0)).toBeCloseTo(66, 6);
  });

  it("profil rozkłada dokładnie cały dystans", () => {
    for (const p of ["motorway", "mixed", "national"] as const) {
      const sum = segmentsFromProfile(663.3, p).reduce((a, s) => a + s.km, 0);
      expect(sum).toBeCloseTo(663.3, 6);
    }
  });
});

describe("simulate", () => {
  it("wstawia przerwę 45 min po 4 h 30 min jazdy", () => {
    const p = simulate(flat(300), fresh(), NOW, OFF, { kind: "now" });
    expect(kinds(p)).toEqual(["drive:270", "break:45", "drive:30", "arrive:0"]);
    expect(p.arrival).toBe(at(345));
  });

  it("timeAtKm: przyjazd do km po drodze z przerwą (punkt pośredni)", () => {
    const r = flat(300);
    const p = simulate(r, fresh(), NOW, OFF, { kind: "now" });
    expect(timeAtKm(p, r, 100)).toBe(at(100));
    // Za przerwą: 270 jazdy + 45 przerwy + 10 jazdy.
    expect(timeAtKm(p, r, 280)).toBe(at(325));
    expect(timeAtKm(p, r, 300)).toBe(p.arrival);
  });

  it("po przerwie dzielonej 15 min wystarczy 30 min", () => {
    const p = simulate(flat(100), fresh({ sinceBreakMin: 270, splitBreakTaken: true }), NOW, OFF, { kind: "now" });
    expect(kinds(p)).toEqual(["break:30", "drive:100", "arrive:0"]);
  });

  it("po 9 h jazdy wstawia odpoczynek dzienny 11 h", () => {
    const d = fresh({ shiftStart: at(-540), drivenTodayMin: 480, sinceBreakMin: 0 });
    const p = simulate(flat(660), d, NOW, OFF, { kind: "now" });
    expect(kinds(p)).toEqual(["drive:60", "rest:660", "drive:270", "break:45", "drive:270", "rest:660", "drive:60", "arrive:0"]);
    expect(p.arrival).toBe(at(60 + 660 + 585 + 660 + 60));
  });

  it("pilnuje okna 13 h od początku dnia pracy", () => {
    const d = fresh({ shiftStart: at(-720), drivenTodayMin: 120 });
    const p = simulate(flat(300), d, NOW, OFF, { kind: "now" });
    expect(kinds(p).slice(0, 2)).toEqual(["drive:60", "rest:660"]);
    expect(p.events[1].reason).toMatch(/okna dnia pracy/);
  });

  it("z wydłużeniem kończy trasę tego samego dnia", () => {
    const without = simulate(flat(600), fresh({ extensionsLeft: 2 }), NOW, OFF, { kind: "now" });
    const withExt = simulate(flat(600), fresh({ extensionsLeft: 2 }), NOW, { ...OFF, allowExtension: true }, { kind: "now" });
    expect(without.arrival).toBe(at(270 + 45 + 270 + 660 + 60));
    expect(withExt.arrival).toBe(at(270 + 45 + 270 + 45 + 60));
    expect(withExt.extensionsUsed).toBe(1);
  });

  it("odmawia 9 h, gdy skrócone odpoczynki są wykorzystane", () => {
    const p = simulate(flat(100), fresh(), NOW, OFF, { kind: "rest", minutes: 540 });
    expect(p.feasible).toBe(false);
  });

  it("po wyczerpaniu 56 h czeka na nowy tydzień", () => {
    const p = simulate(flat(120), fresh({ weekDrivenMin: 3300 }), NOW, OFF, { kind: "now" });
    expect(kinds(p)[0]).toBe("drive:60");
    expect(p.events[1].kind).toBe("weeklyRest");
    expect(new Date(p.events[1].end).getUTCDay()).toBe(1); // poniedziałek
  });

  it("nowy tydzień zeruje licznik tygodniowy w trakcie jazdy", () => {
    const sunday22 = Date.UTC(2026, 9, 4, 22, 0);
    const p = simulate(flat(240), fresh({ shiftStart: sunday22, weekDrivenMin: 3300 }), sunday22, OFF, { kind: "now" });
    expect(p.events.some((e) => e.kind === "weeklyRest")).toBe(true);
    const q = simulate(flat(240), fresh({ shiftStart: sunday22, weekDrivenMin: 3000 }), sunday22, OFF, { kind: "now" });
    expect(kinds(q)).toEqual(["drive:240", "arrive:0"]);
  });

  it("jest deterministyczny", () => {
    const d = fresh({ shiftStart: at(-300), drivenTodayMin: 200, sinceBreakMin: 100 });
    const r = new Route(segmentsFromProfile(660, "mixed"), DEFAULT_SPEEDS, 5);
    expect(simulate(r, d, NOW, OFF, { kind: "now" })).toEqual(simulate(r, d, NOW, OFF, { kind: "now" }));
  });
});

describe("scenariusze", () => {
  const tired = fresh({ shiftStart: at(-540), drivenTodayMin: 480, reducedRestsLeft: 3 });

  it("porównuje jedź teraz / 9 h / 11 h i wskazuje najwcześniejszy przyjazd", () => {
    const c = compareScenarios(flat(660), tired, NOW, OFF);
    const eta = Object.fromEntries(c.scenarios.map((s) => [s.id, (s.plan.arrival - NOW) / MIN]));
    // 660 km = 11 h jazdy: w każdym wariancie potrzebny jeszcze jeden odpoczynek 11 h po drodze
    expect(eta).toEqual({ now: 60 + 660 + 585 + 660 + 60, rest9: 540 + 585 + 660 + 120, rest11: 660 + 585 + 660 + 120 });
    expect(c.bestId).toBe("rest9");
  });

  it("przy remisie wybiera dłuższy odpoczynek", () => {
    const c = compareScenarios(flat(660), { ...tired, reducedRestsLeft: 0 }, NOW, OFF);
    expect(c.bestId).toBe("rest11");
    expect(explain(c.scenarios.find((s) => s.id === "rest9")!)[0]).toMatch(/skrócone odpoczynki/);
  });

  it("„co jeśli” pokazuje zysk z wydłużenia", () => {
    const w = whatIfs(flat(600), fresh({ extensionsLeft: 1 }), NOW, OFF);
    expect(w).toHaveLength(1);
    expect(w[0].option).toBe("allowExtension");
    expect(w[0].savedMin).toBe(660 - 45);
  });

  it("lepszy scenariusz: szybszy start niż wybrany przez kierowcę", () => {
    const c = compareScenarios(flat(660), tired, NOW, OFF);
    const now = c.scenarios.find((s) => s.id === "now")!.plan;
    // jedź teraz 2025 min, odpocznij 9 h 1905 min → 2 h wcześniej
    expect(betterOption(c, now, [])).toEqual({ kind: "scenario", id: "rest9", savedMin: 120, arrival: at(1905) });
    expect(betterOption(c, c.scenarios.find((s) => s.id === "rest9")!.plan, [])).toBeUndefined();
  });

  it("lepszy scenariusz: opcja z „co jeśli”, gdy jedziemy już najszybszym startem", () => {
    const d = fresh({ extensionsLeft: 1 });
    const c = compareScenarios(flat(600), d, NOW, OFF);
    const best = c.scenarios.find((s) => s.id === c.bestId)!.plan;
    const b = betterOption(c, best, whatIfs(flat(600), d, NOW, OFF));
    expect(b).toMatchObject({ kind: "option", option: "allowExtension", savedMin: 660 - 45 });
    // zysk poniżej progu nie jest pokazywany
    expect(betterOption(c, best, [{ option: "allowExtension", label: "x", savedMin: 10, arrival: NOW }])).toBeUndefined();
  });

  it("parking: szukaj z wyprzedzeniem przed pierwszym postojem", () => {
    const r = flat(300);
    const p = simulate(r, fresh(), NOW, OFF, { kind: "now" });
    const h = parkingHint(p, r, 45)!;
    expect(h.stop.kind).toBe("break");
    expect(h.searchFrom).toBe(at(225));
    expect(h.searchFromKm).toBeCloseTo(225, 6);
  });
});

describe("spóźniony start", () => {
  it("odtwarza liczniki z aktywności, łącznie z przerwą dzieloną", () => {
    const r = reconstruct(NOW, [
      { kind: "work", minutes: 30 },
      { kind: "drive", minutes: 200 },
      { kind: "break", minutes: 15 },
      { kind: "drive", minutes: 60 },
    ]);
    expect(r).toEqual({ drivenTodayMin: 260, sinceBreakMin: 260, splitBreakTaken: true, end: at(305) });
    const r2 = reconstruct(NOW, [
      { kind: "drive", minutes: 200 },
      { kind: "break", minutes: 15 },
      { kind: "drive", minutes: 60 },
      { kind: "break", minutes: 30 },
      { kind: "drive", minutes: 20 },
    ]);
    expect(r2.sinceBreakMin).toBe(20);
    expect(r2.splitBreakTaken).toBe(false);
  });
});

import { planForDeadline } from "./deadline";

describe("plan pod rozładunek", () => {
  const tired = fresh({ shiftStart: at(-540), drivenTodayMin: 480, reducedRestsLeft: 3 });

  it("daje jak najdłuższy odpoczynek, który jeszcze pozwala zdążyć", () => {
    // 300 km = 270 + 45 + 30 min. Rozładunek za 20 h, zapas 30 min → trzeba ruszyć najpóźniej po 20 h − 30 min − 345 min.
    const d = planForDeadline(flat(300), tired, NOW, OFF, at(1200), 30);
    expect(d.onTime).toBe(true);
    expect(d.kind).toBe("rest");
    expect(d.restMinutes).toBe(1200 - 30 - 345);
    expect(d.plan!.arrival).toBe(at(1170));
    expect(d.slackMin).toBe(30);
  });

  it("gdy odpoczynek się nie mieści — jedź teraz i podaj najpóźniejszy wyjazd", () => {
    const d = planForDeadline(flat(100), fresh(), NOW, OFF, at(300), 0);
    expect(d.onTime).toBe(true);
    expect(d.kind).toBe("now");
    expect(d.plan!.departure).toBe(at(200));
  });

  it("w trakcie jazdy: jedź dalej od teraz — bez odpoczynku przed wyjazdem i bez „wyjedź później”", () => {
    // Stojąc dostałby długi odpoczynek przed wyjazdem; w trakcie jazdy: 270 + 45 + 30 min → przyjazd at(345).
    expect(planForDeadline(flat(300), fresh(), NOW, OFF, at(1200), 30).kind).toBe("rest");
    const d = planForDeadline(flat(300), fresh(), NOW, OFF, at(1200), 30, true);
    expect(d.onTime).toBe(true);
    expect(d.kind).toBe("now");
    expect(d.plan!.departure).toBe(NOW);
    expect(d.plan!.arrival).toBe(at(345));
    expect(d.slackMin).toBe(1200 - 345);
    const short = planForDeadline(flat(100), fresh(), NOW, OFF, at(300), 0, true);
    expect(short.plan!.departure).toBe(NOW);
    expect(short.plan!.arrival).toBe(at(100));
  });

  it("gdy się nie da — pokazuje spóźnienie i co pomoże", () => {
    // 600 km bez wydłużenia wymaga odpoczynku po drodze; z wydłużeniem 690 min.
    const d = planForDeadline(flat(600), fresh({ extensionsLeft: 1 }), NOW, OFF, at(720), 0);
    expect(d.onTime).toBe(false);
    expect(d.lateByMin).toBe(270 + 45 + 270 + 660 + 60 - 720);
    expect(d.fixes[0]?.label).toMatch(/wydłużenie/);
    expect(d.fixes[0]?.arrival).toBe(at(690));
  });
});

describe("odtworzenie dnia z godzinami", () => {
  const H = 60 * 60_000;
  it("luka między jazdami liczy się jako postój, nakładki tylko raz", () => {
    const r = reconstructTimed(NOW, [
      { kind: "drive", from: NOW, to: NOW + 3 * H },
      // luka 45 min → przerwa
      { kind: "drive", from: NOW + 3.75 * H, to: NOW + 5 * H },
      // nakłada się na poprzednią o 15 min
      { kind: "work", from: NOW + 4.75 * H, to: NOW + 5.5 * H },
    ]);
    expect(r.drivenTodayMin).toBe(255);
    expect(r.sinceBreakMin).toBe(75);
    expect(r.gapMin).toBe(45);
    expect(r.end).toBe(NOW + 5.5 * H);
  });
});

describe("prędkość odcinka z jazdy kierowców", () => {
  it("wolniejsza niż ustawiona — liczy się zmierzona; szybsza — nie wyżej niż ustawiona", () => {
    const speeds: Speeds = { ...DEFAULT_SPEEDS, urban: 40, motorway: 80 };
    const slow = new Route([{ type: "urban", km: 10, kmh: 20 }], speeds);
    expect(slow.driveMinutes(0)).toBeCloseTo(30, 6); // 10 km / 20 km/h
    const fast = new Route([{ type: "motorway", km: 80, kmh: 95 }], speeds);
    expect(fast.driveMinutes(0)).toBeCloseTo(60, 6); // 80 km / 80 km/h (ustawiona)
  });
});
