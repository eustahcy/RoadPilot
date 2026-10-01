import { describe, expect, it } from "vitest";
import { extendPremium, FOREVER, makeKey, normalizeKey } from "./premium.mjs";

const now = Date.UTC(2026, 9, 1, 12);
const DAY = 86_400_000;

describe("klucze", () => {
  it("format i odczyt wpisanego klucza", () => {
    let i = 0;
    const k = makeKey((n) => i++ % n);
    expect(k).toMatch(/^RP-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeKey(k)).toBe(k);
    expect(normalizeKey(` ${k.toLowerCase().replace(/-/g, " ")} `)).toBe(k);
    expect(normalizeKey(k.slice(3))).toBe(k);
    expect(normalizeKey("RP-ABCD-EFG")).toBeNull();
    expect(normalizeKey("RP-ABCD-EFG0")).toBeNull(); // 0 nie występuje w kluczach
  });
});

describe("extendPremium", () => {
  it("bez Premium — od teraz; trwające — od jego końca; wygasłe — od teraz", () => {
    expect(extendPremium(null, 30, now).getTime()).toBe(now + 30 * DAY);
    expect(extendPremium(new Date(now + 10 * DAY), 30, now).getTime()).toBe(now + 40 * DAY);
    expect(extendPremium(new Date(now - 10 * DAY), 30, now).getTime()).toBe(now + 30 * DAY);
  });
  it("bez terminu", () => {
    expect(extendPremium(null, null, now)).toBe(FOREVER);
    expect(extendPremium(FOREVER, 30, now)).toBe(FOREVER);
  });
});
