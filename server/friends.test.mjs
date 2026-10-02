import { describe, expect, it } from "vitest";
import { cleanPresence, friendView, keepReplayedPosAt, LAST_SEEN_MAX_MS, PRESENCE_TTL_MS } from "./friends.mjs";

const now = 1_800_000_000_000;

describe("cleanPresence", () => {
  it("zaokrągla pozycję i przycina pola", () => {
    const p = cleanPresence({ lat: 52.123456, lon: 21.987654, kmh: 84.6, heading: 359.7, status: "driving", since: now - 5000, dest: " Magazyn ", arrival: now + 3_600_000, leftKm: 123.4, driveLeftMin: 200.4, untilBreakMin: 30, posAge: 4000 }, now);
    expect(p).toEqual({ lat: 52.1235, lon: 21.9877, kmh: 85, heading: 360, status: "driving", since: now - 5000, targetMin: null, dest: "Magazyn", arrival: now + 3_600_000, leftKm: 123, driveLeftMin: 200, untilBreakMin: 30, posAt: now - 4000 });
  });
  it("postój z limitem", () => {
    const p = cleanPresence({ lat: 50, lon: 20, status: "break", since: now - 600_000, targetMin: 45 }, now);
    expect(p.status).toBe("break");
    expect(p.targetMin).toBe(45);
    expect(p.kmh).toBeNull();
    expect(p.dest).toBe("");
  });
  it("odrzuca brak pozycji i nieznany status", () => {
    expect(() => cleanPresence({ status: "driving" }, now)).toThrow("Brak pozycji.");
    expect(() => cleanPresence({ lat: 1, lon: 1, status: "flying" }, now)).toThrow("Nieznany status.");
    expect(() => cleanPresence({ lat: 91, lon: 1, status: "driving" }, now)).toThrow("Brak pozycji.");
  });
});

describe("friendView", () => {
  const base = { user_id: 1, friend_id: 2, email: "kolega@x.pl", name: "", accepted_at: null, presence: null, presence_at: null };
  it("relacja z punktu widzenia zapraszającego i zaproszonego", () => {
    expect(friendView(base, 1, now)).toMatchObject({ id: 2, name: "kolega", relation: "invited", presence: null });
    expect(friendView(base, 2, now)).toMatchObject({ id: 1, relation: "pending" });
  });
  it("obecność tylko po akceptacji; stara jako offline (ostatnia znana), bardzo stara znika", () => {
    const acc = { ...base, accepted_at: "2026-09-30 10:00:00", presence: JSON.stringify({ lat: 1, lon: 2, status: "driving" }), presence_at: new Date(now - 60_000) };
    expect(friendView(acc, 1, now).presence).toEqual({ lat: 1, lon: 2, status: "driving", at: now - 60_000 });
    expect(friendView({ ...acc, presence_at: new Date(now - PRESENCE_TTL_MS - 1) }, 1, now).presence).toEqual({ lat: 1, lon: 2, status: "driving", at: now - PRESENCE_TTL_MS - 1, offline: true });
    expect(friendView({ ...acc, presence_at: new Date(now - LAST_SEEN_MAX_MS - 1) }, 1, now).presence).toBeNull();
    expect(friendView({ ...acc, accepted_at: null }, 1, now).presence).toBeNull();
  });
  it("„sygnał X temu” od odczytu GPS: stara pozycja wysłana teraz jest offline", () => {
    const stale = { ...base, accepted_at: "2026-09-30 10:00:00", presence: JSON.stringify({ lat: 1, lon: 2, status: "driving", posAt: now - 90 * 60_000 }), presence_at: new Date(now - 5_000) };
    expect(friendView(stale, 1, now).presence).toEqual({ lat: 1, lon: 2, status: "driving", at: now - 90 * 60_000, offline: true });
  });
});

describe("keepReplayedPosAt", () => {
  const prev = { lat: 53.2195, lon: 18.7342, kmh: 82, status: "driving", posAt: now - 150 * 60_000 };
  it("ta sama pozycja przy jeździe po godzinach = stary odczyt z iPhone'a: zostaje stary czas", () => {
    expect(keepReplayedPosAt(prev, { ...prev, posAt: now }).posAt).toBe(prev.posAt);
  });
  it("nowa pozycja, postój albo krótka przerwa w wysyłce — bez zmian", () => {
    expect(keepReplayedPosAt(prev, { ...prev, lat: 53.25, posAt: now }).posAt).toBe(now);
    expect(keepReplayedPosAt(prev, { ...prev, kmh: 0, status: "standing", posAt: now }).posAt).toBe(now);
    expect(keepReplayedPosAt(prev, { ...prev, posAt: prev.posAt + 20_000 }).posAt).toBe(prev.posAt + 20_000);
    expect(keepReplayedPosAt(undefined, { ...prev, posAt: now }).posAt).toBe(now);
  });
});
