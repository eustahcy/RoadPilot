import { describe, expect, it } from "vitest";
import { jamMatters, jamTone, TrafficSection } from "./nav";

const t = (x: Partial<TrafficSection>): TrafficSection => ({ km: 0, toKm: 1, delayMin: 0, level: 1, cause: "jam", ...x });

describe("kolor utrudnień", () => {
  it("żółty = wolniej, czerwony = korek, zamknięcie osobno", () => {
    expect(jamTone(t({ level: 1, kmh: 45 }))).toBe("slow");
    expect(jamTone(t({ level: 2, kmh: 30 }))).toBe("slow");
    expect(jamTone(t({ level: 2, kmh: 12 }))).toBe("jam");
    expect(jamTone(t({ level: 3 }))).toBe("jam");
    expect(jamTone(t({ level: 1, cause: "roadwork" }))).toBe("slow");
    expect(jamTone(t({ level: 4, cause: "closed" }))).toBe("closed");
  });
  it("drobne spowolnienie bez opóźnienia nie zaśmieca karty", () => {
    expect(jamMatters(t({ level: 1, delayMin: 0.4, kmh: 50 }))).toBe(false);
    expect(jamMatters(t({ level: 1, delayMin: 2 }))).toBe(true);
    expect(jamMatters(t({ level: 3, delayMin: 0 }))).toBe(true);
  });
});
