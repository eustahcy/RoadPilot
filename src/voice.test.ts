import { describe, expect, it } from "vitest";
import { spokenDist } from "./voice";

describe("komunikaty głosowe", () => {
  it("odległości po polsku", () => {
    expect(spokenDist(0.312)).toBe("300 metrów");
    expect(spokenDist(0.04)).toBe("50 metrów");
    expect(spokenDist(1)).toBe("1 kilometr");
    expect(spokenDist(1.4)).toBe("1,5 kilometra");
    expect(spokenDist(3)).toBe("3 kilometry");
    expect(spokenDist(6)).toBe("6 kilometrów");
  });
});
