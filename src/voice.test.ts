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

describe("zapowiedzi manewrów", () => {
  it("zjazd z numerem i kierunkiem, rondo z numerem zjazdu, reszta z tekstu silnika", async () => {
    const { maneuverSpeech, voiceMarks } = await import("./voice");
    expect(maneuverSpeech({ km: 1, maneuver: "MOTORWAY_EXIT_RIGHT", text: "Wjedź na zjazd 53 w stronę S6/E 28.", exit: "53", signpost: "Gdynia, Wejherowo" })).toBe("zjazd 53, kierunek Gdynia");
    expect(maneuverSpeech({ km: 1, maneuver: "ROUNDABOUT_RIGHT", text: "Wjedź na rondo…", roundaboutExit: "2", street: "Morska" })).toBe("na rondzie drugi zjazd, Morska");
    expect(maneuverSpeech({ km: 1, maneuver: "TURN_LEFT", text: "Skręć w lewo w Polną." })).toBe("skręć w lewo w Polną");
    expect(voiceMarks(90).marks).toEqual([2, 1, 0.5]);
  });
});
