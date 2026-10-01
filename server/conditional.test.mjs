import { describe, expect, it } from "vitest";
import { conditionNote, effectiveRestriction, isPolishHoliday, parseConditional, timeMatches } from "./conditional.mjs";

// Czas lokalny w Polsce (CEST = UTC+2 w październiku 2026).
const at = (iso) => Date.parse(iso);

describe("parseConditional — przykłady z OSM Polska", () => {
  it("godziny przez północ, kilka przedziałów, dni i święta", () => {
    expect(parseConditional("no @ (22:00-06:00)")).toEqual([{ value: "no", time: [{ days: null, ph: false, ranges: [[1320, 360]] }] }]);
    expect(parseConditional("25@ (12:00-18:00;21:00-8:00)")[0].time).toHaveLength(2);
    expect(parseConditional("no @ (Sa 08:00-22:00; Su,PH)")[0].time).toEqual([{ days: [6], ph: false, ranges: [[480, 1320]] }, { days: [0], ph: true, ranges: null }]);
  });
  it("użytkownicy, waga, AND, kilka wpisów; nierozpoznane pominięte", () => {
    expect(parseConditional("none @ destination")).toEqual([{ value: "none", users: ["destination"] }]);
    expect(parseConditional("none @ (delivery; private)")).toEqual([{ value: "none", users: ["delivery", "private"] }]);
    const c = parseConditional("yes @ bus;yes @ delivery AND 05:00-10:00, 19:00-21:00 AND weight<10;yes @ marked");
    expect(c).toHaveLength(3);
    expect(c[1]).toMatchObject({ value: "yes", users: ["delivery"], weight: { op: "<", t: 10 }, time: [{ ranges: [[300, 600], [1140, 1260]] }] });
    expect(parseConditional("no @ (sunset-sunrise)")).toEqual([]);
  });
});

describe("czas i święta", () => {
  it("22:00-06:00 obowiązuje o 23:30 i o 05:00, nie o 12:00 (czas w Polsce)", () => {
    const r = parseConditional("no @ (22:00-06:00)")[0].time;
    expect(timeMatches(r, at("2026-10-01T21:30:00Z"))).toBe(true); // 23:30
    expect(timeMatches(r, at("2026-10-02T03:00:00Z"))).toBe(true); // 05:00
    expect(timeMatches(r, at("2026-10-01T10:00:00Z"))).toBe(false); // 12:00
  });
  it("Sa 08:00-22:00; Su,PH — sobota 10:00 tak, piątek nie, 11 listopada (święto) tak", () => {
    const r = parseConditional("no @ (Sa 08:00-22:00; Su,PH)")[0].time;
    expect(timeMatches(r, at("2026-10-03T08:00:00Z"))).toBe(true);
    expect(timeMatches(r, at("2026-10-02T08:00:00Z"))).toBe(false);
    expect(timeMatches(r, at("2026-11-11T09:00:00Z"))).toBe(true);
    expect(isPolishHoliday(2026, 6, 4)).toBe(true); // Boże Ciało 2026
  });
});

describe("effectiveRestriction — czy obowiązuje tego kierowcę teraz", () => {
  const ctx = (iso, nearDest = false, weightT = 40) => ({ t: at(iso), nearDest, weightT });
  it("maxweight 12 + none @ destination: tranzyt — zakaz, dojazd do celu w strefie — wolno", () => {
    const items = parseConditional("none @ destination");
    expect(effectiveRestriction("weight", 12, items, ctx("2026-10-01T10:00:00Z")).active).toBe(true);
    expect(effectiveRestriction("weight", 12, items, ctx("2026-10-01T10:00:00Z", true)).active).toBe(false);
  });
  it("hgv:conditional=no @ (22:00-06:00) bez zakazu stałego — w nocy zakaz, w dzień wolno", () => {
    const items = parseConditional("no @ (22:00-06:00)");
    expect(effectiveRestriction("hgv", null, items, ctx("2026-10-01T21:30:00Z")).active).toBe(true);
    expect(effectiveRestriction("hgv", null, items, ctx("2026-10-01T10:00:00Z")).active).toBe(false);
  });
  it("maxweight 25 w godzinach, waga; hgv=destination przy celu nie blokuje; opis warunku", () => {
    const items = parseConditional("25@ (12:00-18:00;21:00-8:00)");
    expect(effectiveRestriction("weight", null, items, ctx("2026-10-01T12:00:00Z")).active).toBe(true); // 14:00, 40 t > 25 t
    expect(effectiveRestriction("weight", null, items, ctx("2026-10-01T07:00:00Z")).active).toBe(false); // 09:00
    expect(effectiveRestriction("hgv", "destination", [], ctx("2026-10-01T10:00:00Z", true)).active).toBe(false);
    expect(conditionNote(parseConditional("no @ (Sa 08:00-22:00; Su,PH)"))).toBe("Sa 08:00–22:00; Su święta");
  });
});
