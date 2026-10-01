import { describe, expect, it } from "vitest";
import { describeFriend, fmtAgo, Friend, nearestFriend, presenceOf } from "./friends";
import { Live } from "./gps";
import { DriverStatus } from "./scenarios";

const now = 1_800_000_000_000;
const MIN = 60_000;
const live: Live = { t: now, lat: 52, lon: 21, kmh: 80, heading: 10, base: { t: now, lat: 52, lon: 21 } };
const status: DriverStatus = { driveLeftToday: 200.4, driveLeftTodayExtended: 260, untilBreak: 120, breakNeeded: 45, restDeadline: 0, restDeadlineReduced: 0, weekLeft: 1000 };

describe("presenceOf", () => {
  it("jazda: status driving, since = początek dnia, liczniki zaokrąglone", () => {
    const p = presenceOf(live, null, now - 3 * 60 * MIN, status, undefined, "Poznań", 123.6);
    expect(p).toMatchObject({ lat: 52, lon: 21, kmh: 80, heading: 10, status: "driving", since: now - 180 * MIN, targetMin: null, dest: "Poznań", arrival: null, leftKm: 124, driveLeftMin: 200, untilBreakMin: 120 });
  });
  it("stoi bez postoju → standing; przerwa 45 → break; 9 h → rest; koniec dnia → dayEnd", () => {
    expect(presenceOf({ ...live, kmh: 0 }, null, now, status, undefined, "", 0)?.status).toBe("standing");
    expect(presenceOf(live, { start: now - 10 * MIN, targetMin: 45 }, now, status, undefined, "", 0)).toMatchObject({ status: "break", since: now - 10 * MIN, targetMin: 45 });
    expect(presenceOf(live, { start: now, targetMin: 540 }, now, status, undefined, "", 0)?.status).toBe("rest");
    expect(presenceOf(live, { start: now, targetMin: 660, dayEnd: true }, now, status, undefined, "", 0)?.status).toBe("dayEnd");
  });
  it("bez pozycji nic nie wysyłamy", () => {
    expect(presenceOf(null, null, now, status, undefined, "", 0)).toBeUndefined();
  });
});

const base = { lat: 52, lon: 21, kmh: 60, heading: null, targetMin: null, dest: "", arrival: null, leftKm: null, driveLeftMin: null, untilBreakMin: null, at: now };

describe("describeFriend", () => {
  it("odległość i czas jazdy", () => {
    // 0,1° szerokości ≈ 11,1 km
    const d = describeFriend({ ...base, status: "driving", since: now - 190 * MIN }, { lat: 52.1, lon: 21 }, now);
    expect(d.km).toBeCloseTo(11.1, 0);
    expect(d.status).toBe("Jedzie");
    expect(d.duration).toBe("w trasie 3 h 10 min");
    expect(d.tone).toBeUndefined();
  });
  it("przerwa z limitem: „25 min z 45 min”, po limicie tone ok", () => {
    expect(describeFriend({ ...base, status: "break", since: now - 25 * MIN, targetMin: 45 }, null, now)).toMatchObject({ km: undefined, status: "Przerwa", duration: "25 min z 45 min" });
    expect(describeFriend({ ...base, status: "break", since: now - 50 * MIN, targetMin: 45 }, null, now).tone).toBe("ok");
  });
  it("postój bez limitu: „od 1 h 05 min”; blisko przerwy → warn", () => {
    expect(describeFriend({ ...base, status: "rest", since: now - 65 * MIN }, null, now).duration).toBe("od 1 h 05 min");
    expect(describeFriend({ ...base, status: "driving", since: now, untilBreakMin: 20 }, null, now).tone).toBe("warn");
  });
});

describe("znajomy bez sygnału", () => {
  it("ostatnia pozycja: odległość zostaje, zamiast czasu postoju — kiedy był sygnał", () => {
    const d = describeFriend({ ...base, status: "break", since: now - 300 * MIN, targetMin: 45, at: now - 35 * MIN, offline: true }, { lat: 52.1, lon: 21 }, now);
    expect(d).toMatchObject({ offline: true, status: "Brak sygnału", duration: "ostatnio 35 min temu" });
    expect(d.km).toBeGreaterThan(0);
    expect(d.tone).toBeUndefined();
  });
  it("fmtAgo", () => {
    expect(fmtAgo(30_000)).toBe("przed chwilą");
    expect(fmtAgo(35 * MIN)).toBe("35 min temu");
    expect(fmtAgo(185 * MIN)).toBe("3 h temu");
    expect(fmtAgo(30 * 60 * MIN)).toBe("wczoraj");
    expect(fmtAgo(4 * 24 * 60 * MIN)).toBe("4 dni temu");
  });
});

describe("describeFriend po trasie", () => {
  // Trasa na północ po południku 21°, punkt co 100 m, 10 km; my na 3. km.
  const KM = 1 / 110.574;
  const points: [number, number, number][] = Array.from({ length: 101 }, (_, i) => [52 + i * 0.1 * KM, 21, i * 0.1]);
  const route = { points, km: 3 };
  it("znajomy przy trasie: km po trasie i czy przed nami", () => {
    const ahead = describeFriend({ ...base, lat: 52 + 7.5 * KM, lon: 21.001, status: "driving", since: null }, { lat: 52 + 3 * KM, lon: 21 }, now, route);
    expect(ahead.km).toBeCloseTo(4.5, 1);
    expect(ahead).toMatchObject({ onRoute: true, ahead: true });
    expect(describeFriend({ ...base, lat: 52 + 1 * KM, lon: 21, status: "driving", since: null }, null, now, route)).toMatchObject({ onRoute: true, ahead: false });
  });
  it("znajomy daleko od trasy: linia prosta", () => {
    const off = describeFriend({ ...base, lat: 52 + 5 * KM, lon: 21.05, status: "driving", since: null }, { lat: 52 + 3 * KM, lon: 21 }, now, route);
    expect(off.onRoute).toBe(false);
    expect(off.km).toBeGreaterThan(3);
  });
});

describe("nearestFriend", () => {
  const f = (id: number, lat: number, relation: Friend["relation"] = "accepted", presence = true): Friend => ({ id, name: `K${id}`, email: "", relation, presence: presence ? { ...base, lat, status: "driving", since: null } : null });
  it("najbliższy spośród zaakceptowanych z sygnałem", () => {
    expect(nearestFriend([f(1, 53), f(2, 52.2), f(3, 52.1, "pending"), f(4, 52.01, "accepted", false)], { lat: 52, lon: 21 })?.friend.id).toBe(2);
  });
  it("bez sygnału tylko, gdy nikt nie nadaje", () => {
    const off = (id: number, lat: number): Friend => ({ ...f(id, lat), presence: { ...f(id, lat).presence!, offline: true } });
    expect(nearestFriend([off(1, 52.01), f(2, 53)], { lat: 52, lon: 21 })?.friend.id).toBe(2);
    expect(nearestFriend([off(1, 52.01)], { lat: 52, lon: 21 })?.friend.id).toBe(1);
  });
  it("bez własnej pozycji bierze pierwszego z sygnałem", () => {
    expect(nearestFriend([f(1, 53), f(2, 52.2)], null)?.friend.id).toBe(1);
    expect(nearestFriend([f(1, 53, "invited")], null)).toBeUndefined();
  });
});
