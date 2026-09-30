import { describe, expect, it } from "vitest";
import { DEFAULT_WORK, workReminders, workStatus } from "./workday";

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.UTC(2026, 8, 30, 5, 0);

describe("czas pracy", () => {
  it("domyślnie 13 h od początku dnia, przerwy go nie zatrzymują", () => {
    expect(DEFAULT_WORK.limitMin).toBe(780);
    const s = workStatus(T0, T0 + 10 * H, DEFAULT_WORK, 3);
    expect(s.leftMin).toBe(180);
    expect(s.end).toBe(T0 + 13 * H);
    expect(s.extendedEnd).toBe(T0 + 15 * H);
    expect(s.phase).toBe("ok");
  });

  it("fazy: przed końcem, wydłużony, po wydłużeniu; bez skróconych odpoczynków nie ma wydłużenia", () => {
    expect(workStatus(T0, T0 + 12.75 * H, DEFAULT_WORK, 3).phase).toBe("soon");
    expect(workStatus(T0, T0 + 14 * H, DEFAULT_WORK, 3).phase).toBe("extended");
    expect(workStatus(T0, T0 + 15 * H, DEFAULT_WORK, 3).phase).toBe("extendedOver");
    expect(workStatus(T0, T0 + 14 * H, DEFAULT_WORK, 0).phase).toBe("over");
    expect(workStatus(T0, T0 + 14 * H, { ...DEFAULT_WORK, extension: false }, 3).phase).toBe("over");
  });

  it("przypomnienia: 30 min przed i na koniec, także dla 15 h", () => {
    const r = workReminders(T0, DEFAULT_WORK, 3);
    expect(r.map((x) => [(x.at - T0) / MIN, x.kind])).toEqual([[750, "soon"], [780, "end"], [870, "extSoon"], [900, "extEnd"]]);
    expect(workReminders(T0, { ...DEFAULT_WORK, limitMin: 600, leadMin: 60, extension: false }, 3).map((x) => (x.at - T0) / MIN)).toEqual([540, 600]);
    expect(workReminders(T0, { ...DEFAULT_WORK, remind: false }, 3)).toEqual([]);
  });
});
