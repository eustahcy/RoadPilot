import { describe, expect, it } from "vitest";
import { legalLimitAt } from "./navmatch";
import { SectionSpan, sectionLimit, SectionState, sectionStats, stepSection } from "./section";

const S = 1000;
const span = { id: "s1", km: 10, toKm: 14 };

/** Jazda ze stałą prędkością: odczyt co `every` s od km `from` do `to`. */
function drive(s: SectionState, from: number, to: number, kmh: number, t0: number, every = 1, sp: SectionSpan | null = span) {
  let t = t0;
  for (let km = from; km <= to + 1e-9; km += (kmh / 3600) * every) {
    s = stepSection(s, sp ?? undefined, km, t);
    t += every * S;
  }
  return { s, t };
}

describe("odcinkowy pomiar prędkości", () => {
  it("średnia od wjazdu na odcinek; wjazd interpolowany między odczytami", () => {
    // Odczyty co 10 s przy 72 km/h (200 m) — wjazd na km 10 wypada między nimi.
    let s: SectionState = stepSection({}, span, 9.9, 0);
    s = stepSection(s, span, 10.1, 10 * S);
    expect(s.run?.startT).toBe(5 * S);
    expect(s.run?.distKm).toBeCloseTo(0.1);
    const st = sectionStats(s.run!, 10 * S, 70);
    expect(st.avgKmh).toBeCloseTo(72);
    expect(st.tone).toBe("warn");
    expect(st.leftKm).toBeCloseTo(3.9);
  });

  it("włączona w trakcie odcinka: średnia od pierwszego odczytu, nie od początku odcinka", () => {
    let s: SectionState = stepSection({}, span, 12, 0);
    expect(s.run).toMatchObject({ partial: true, lengthKm: 2, distKm: 0 });
    s = stepSection(s, span, 12.5, 30 * S);
    expect(sectionStats(s.run!, 30 * S, 70).avgKmh).toBeCloseTo(60);
  });

  it("koniec odcinka: średnia z całej długości, bez wpływu jazdy za nim", () => {
    const { s } = drive({}, 9.5, 14.5, 60, 0, 2);
    expect(s.run?.endT).toBeDefined();
    expect(s.run?.avgKmh).toBeCloseTo(60, 0);
    expect(sectionStats(s.run!, s.run!.endT! + 60 * S, 70).tone).toBe("ok");
  });

  it("za szybko: podpowiedź prędkości do końca, żeby średnia zeszła do limitu", () => {
    // 2 km z 4 przy 90 km/h (80 s), limit 70: cały odcinek co najmniej 4/70 h ≈ 205,7 s → na 2 km zostaje 125,7 s ≈ 57 km/h.
    const { s, t } = drive({}, 10, 12, 90, 0);
    const st = sectionStats(s.run!, t - S, 70);
    expect(st.tone).toBe("over");
    expect(st.adviseKmh).toBe(57);
  });

  it("trasa przeliczona w trakcie (km od nowa, odcinka już nie ma) — liczy dalej i kończy po długości odcinka", () => {
    let { s, t } = drive({}, 10, 12, 60, 0);
    // Nowa trasa zaczyna się w miejscu, gdzie jesteśmy: km 0, ostrzeżenia o trwającym odcinku brak.
    s = stepSection(s, undefined, 0, t);
    expect(s.run?.distKm).toBeCloseTo(2, 1);
    ({ s } = drive(s, 1 / 60, 2.2, 60, t + S, 1, null));
    expect(s.run?.endT).toBeDefined();
    expect(s.run?.avgKmh).toBeCloseTo(60, 0);
  });
});

describe("limit dla ciężarówki", () => {
  const route = {
    speedLimits: [{ km: 0, toKm: 2, kmh: 70 }, { km: 2, toKm: 5, kmh: 40 }, { km: 5, toKm: 10, kmh: 90 }, { km: 10, toKm: 20, kmh: 140 }],
    roads: [{ km: 0, toKm: 5, kind: "urban" as const }, { km: 5, toKm: 10, kind: "rural" as const }, { km: 10, toKm: 20, kind: "motorway" as const }, { km: 20, toKm: 30, kind: "rural" as const }],
  };
  it("w mieście znak 70 nie podnosi limitu 50; niższy znak obowiązuje", () => {
    expect(legalLimitAt(route, 1, true)).toEqual({ kmh: 50, kind: "urban", ignoredSign: 70 });
    expect(legalLimitAt(route, 3, true)).toEqual({ kmh: 40, kind: "urban" });
  });
  it("poza zabudowanym 70, autostrada 80, bez znaku — z rodzaju drogi", () => {
    expect(legalLimitAt(route, 7, true)?.kmh).toBe(70);
    expect(legalLimitAt(route, 15, true)?.kmh).toBe(80);
    expect(legalLimitAt(route, 25, true)?.kmh).toBe(70);
  });
  it("osobówka / bez danych o drodze — sam znak", () => {
    expect(legalLimitAt(route, 15, false)?.kmh).toBe(140);
    expect(legalLimitAt({ speedLimits: [] }, 1, true)).toBeUndefined();
  });
});

describe("limit odcinka dla ciężarówki", () => {
  const route = { speedLimits: [{ km: 0, toKm: 20, kmh: 100 }], roads: [{ km: 0, toKm: 5, kind: "rural" as const }, { km: 5, toKm: 8, kind: "urban" as const }, { km: 8, toKm: 20, kind: "motorway" as const }] };
  it("najniższy z: znak odcinka, limit ciężarówki na jego drogach", () => {
    expect(sectionLimit(route, { id: "a", km: 10, toKm: 15, value: 120 }, true)).toBe(80);
    expect(sectionLimit(route, { id: "a", km: 10, toKm: 15, value: 60 }, true)).toBe(60);
    expect(sectionLimit(route, { id: "a", km: 4, toKm: 9, value: 70 }, true)).toBe(50);
    expect(sectionLimit(route, { id: "a", km: 10, toKm: 15, value: null }, false)).toBe(100);
  });
});
