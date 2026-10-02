import { describe, expect, it } from "vitest";
import { canonKey, extendPremium, FOREVER, makeKey, normalizeKey, redeemProblem } from "./premium.mjs";

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

describe("licencje — własne klucze", () => {
  it("postać kanoniczna: wielkość liter, spacje i myślniki bez znaczenia", () => {
    expect(canonKey(" Lato-2026 ")).toBe("LATO2026");
    expect(canonKey("rp-7kqm-x2hd")).toBe("RP7KQMX2HD");
    expect(canonKey("ab")).toBeNull();
    expect(canonKey("zły#klucz")).toBeNull();
  });
  it("dla konta, limit osób, jedno użycie na konto", () => {
    expect(redeemProblem(undefined, 1, 0, false)).toMatch(/Nie ma/);
    expect(redeemProblem({ for_user: 7, max_uses: 1 }, 1, 0, false)).toMatch(/innego konta/);
    expect(redeemProblem({ for_user: 7, max_uses: 1 }, 7, 0, false)).toBeNull();
    expect(redeemProblem({ for_user: null, max_uses: 10 }, 1, 10, false)).toMatch(/Limit/);
    expect(redeemProblem({ for_user: null, max_uses: null }, 1, 5000, false)).toBeNull();
    expect(redeemProblem({ for_user: null, max_uses: null }, 1, 5, true)).toMatch(/już użyty/);
  });
});

describe("licencje się nie kumulują", () => {
  const key = { for_user: null, max_uses: null };
  it("nowy klucz dopiero 5 dni przed końcem", () => {
    expect(redeemProblem(key, 1, 0, false, new Date(now + 20 * DAY), now)).toMatch(/5 dni przed końcem/);
    expect(redeemProblem(key, 1, 0, false, new Date(now + 4 * DAY), now)).toBeNull();
    expect(redeemProblem(key, 1, 0, false, new Date(now - DAY), now)).toBeNull();
    expect(redeemProblem(key, 1, 0, false, FOREVER, now)).toMatch(/bez terminu/);
  });
});
