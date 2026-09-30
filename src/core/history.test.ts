import { describe, expect, it } from "vitest";
import { AUTO_STOP_IDLE, AutoStop, nextAutoStop } from "./gps";
import { daySummary, recordDrive, recordStop } from "./history";

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0);

describe("postój włączany automatycznie", () => {
  /** Odczyty prędkości co 1 s: [km/h, ...] → kiedy zaczął się postój. */
  function run(speeds: (number | null)[], stopActive = false, start: AutoStop = AUTO_STOP_IDLE) {
    let a = start;
    for (let i = 0; i < speeds.length; i++) {
      const r = nextAutoStop(a, speeds[i], NOW + i * 1000, stopActive);
      a = r.auto;
      if (r.startAt !== undefined) return r.startAt;
    }
    return undefined;
  }

  it("po jeździe 5 s stania włącza postój od chwili zatrzymania", () => {
    expect(run([60, 30, 0, 0, 0, 0, 0, 0])).toBe(NOW + 2000);
  });

  it("4 s stania to jeszcze nie postój", () => {
    expect(run([60, 0, 0, 0, 0, 20])).toBeUndefined();
  });

  it("bez wcześniejszej jazdy (GPS włączony na parkingu) nie włącza się", () => {
    expect(run([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeUndefined();
  });

  it("0–5 km/h to postój, od 5 km/h jazda", () => {
    expect(run([60, 4, 4.9, 3, 0, 2, 4])).toBe(NOW + 1000);
    expect(run([60, 4, 4, 5, 4, 4, 4, 4])).toBeUndefined();
  });

  it("w trakcie postoju i po nim nie włącza się drugi raz, dopóki nie ruszymy", () => {
    expect(run([60, 0, 0], true)).toBeUndefined();
    // po zakończeniu postoju na postoju: rozbrojony
    expect(run([0, 0, 0, 0, 0, 0, 0])).toBeUndefined();
    expect(run([0, 0, 50, 0, 0, 0, 0, 0, 0])).toBe(NOW + 3000);
  });
});

describe("historia dzienna", () => {
  it("sumuje jazdę, km, postoje i liczy średnią", () => {
    let h = recordDrive([], NOW, 120, 150);
    h = recordStop(h, NOW, NOW + 45 * MIN);
    h = recordDrive(h, NOW + 165 * MIN, 120, 170);
    expect(h).toHaveLength(1);
    const d = h[0];
    expect(d.start).toBe(NOW - 120 * MIN);
    expect(d.end).toBe(NOW + 165 * MIN);
    expect(d.driveMin).toBe(240);
    expect(d.km).toBe(320);
    expect(daySummary(d)).toEqual({ stopMin: 45, avgKmh: 80 });
  });

  it("krótkie postoje (światła) pomija, nowy dzień osobno i najnowszy pierwszy", () => {
    let h = recordStop([], NOW, NOW + 1 * MIN);
    expect(h).toHaveLength(0);
    h = recordDrive(h, NOW, 60, 70);
    h = recordDrive(h, NOW + 24 * 60 * MIN, 60, 70);
    expect(h.map((d) => d.date)).toEqual(["2026-10-01", "2026-09-30"]);
  });
});
