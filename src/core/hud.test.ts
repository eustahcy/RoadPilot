import { describe, expect, it } from "vitest";
import { bearingDeg, distanceM, Fix, nextLive } from "./gps";
import { serviceStatus } from "./service";
import { nearestStation, parseOverpass, parseParkings, Station } from "./stations";
import { describeWeather, isHazard } from "./weather";

const NOW = Date.UTC(2026, 8, 30, 12, 0);
const KM_PER_DEG = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) / 1000;
const DAY = 86_400_000;

/** Punkt `north` km na północ i `east` km na wschód od (0, 0). */
const pt = (north: number, east = 0) => ({ lat: north / KM_PER_DEG, lon: east / KM_PER_DEG });
const fix = (sec: number, north: number, over: Partial<Fix> = {}): Fix => ({ t: NOW + sec * 1000, ...pt(north), accuracy: 10, speed: null, ...over });
const station = (id: string, north: number, east = 0, truck = false): Station => ({ id, ...pt(north, east), name: id, truck });

describe("HUD — prędkość i kierunek", () => {
  it("bierze prędkość z odbiornika (m/s → km/h)", () => {
    const l = nextLive(null, fix(0, 0, { speed: 25 }), 90);
    expect(l.kmh).toBeCloseTo(90, 6);
    expect(l.heading).toBe(90);
  });

  it("bez prędkości z odbiornika liczy ją z przesunięcia po kilku sekundach", () => {
    let l = nextLive(null, fix(0, 0), null);
    l = nextLive(l, fix(1, 0.025), null);
    expect(l.kmh).toBeNull(); // za mało danych
    l = nextLive(l, fix(5, 0.125), null); // 125 m w 5 s = 90 km/h
    expect(l.kmh).toBeCloseTo(90, 0);
    expect(l.heading).toBeCloseTo(0, 3); // na północ
  });

  it("na postoju „pływanie” pozycji daje 0 km/h i zostawia ostatni kierunek", () => {
    let l = nextLive(null, fix(0, 0, { speed: 20 }), 180);
    l = nextLive(l, fix(5, 0.005), null);
    expect(l.kmh).toBe(0);
    expect(l.heading).toBe(180);
  });

  it("kierunek: wschód = 90°", () => {
    expect(bearingDeg(pt(0), pt(0, 10))).toBeCloseTo(90, 3);
  });
});

describe("HUD — najbliższa stacja", () => {
  it("czyta odpowiedź Overpass i pomija stacje zamknięte dla ciężarówek", () => {
    const s = parseOverpass({
      elements: [
        { type: "node", id: 1, lat: 52, lon: 21, tags: { amenity: "fuel", brand: "Orlen", hgv: "yes" } },
        { type: "way", id: 2, center: { lat: 52.1, lon: 21 }, tags: { amenity: "fuel", name: "Stacja Kowalski" } },
        { type: "node", id: 3, lat: 52.2, lon: 21, tags: { amenity: "fuel", hgv: "no" } },
        { type: "node", id: 4, tags: { amenity: "fuel" } },
      ],
    });
    expect(s).toEqual([
      { id: "node/1", lat: 52, lon: 21, name: "Orlen", truck: true },
      { id: "way/2", lat: 52.1, lon: 21, name: "Stacja Kowalski", truck: false },
    ]);
    expect(parseOverpass(null)).toEqual([]);
  });

  it("w trakcie jazdy wybiera najbliższą przed nami, nie za plecami", () => {
    const list = [station("za", -2), station("przed", 5), station("bok", 0, 3)];
    const n = nearestStation(list, pt(0), 0)!;
    expect(n.station.id).toBe("przed");
    expect(n.km).toBeCloseTo(5, 3);
    expect(n.ahead).toBe(true);
  });

  it("bez kierunku — najbliższa w ogóle; gdy nic przed nami — najbliższa za nami", () => {
    const list = [station("za", -2), station("przed", 5)];
    expect(nearestStation(list, pt(0), null)).toMatchObject({ station: { id: "za" }, ahead: null });
    expect(nearestStation([station("za", -2)], pt(0), 0)).toMatchObject({ station: { id: "za" }, ahead: false });
    expect(nearestStation([], pt(0), 0)).toBeUndefined();
  });
});

describe("HUD — serwis", () => {
  const today = new Date(2026, 8, 30).getTime(); // północ czasu lokalnego

  it("odlicza km z licznika GPS i dni do terminu", () => {
    const s = serviceStatus({ date: today + 30 * DAY, km: 5000, odoAtSet: 100 }, 1100, NOW);
    expect(s).toEqual({ kmLeft: 4000, daysLeft: 30, level: "ok" });
  });

  it("ostrzega przed terminem lub kilometrami, a po nich — po terminie", () => {
    expect(serviceStatus({ date: null, km: 900, odoAtSet: 0 }, 0, NOW).level).toBe("soon");
    expect(serviceStatus({ date: today + 10 * DAY, km: null, odoAtSet: 0 }, 0, NOW).level).toBe("soon");
    expect(serviceStatus({ date: today - DAY, km: 20000, odoAtSet: 0 }, 0, NOW).level).toBe("overdue");
    expect(serviceStatus({ date: null, km: 500, odoAtSet: 0 }, 600, NOW)).toMatchObject({ kmLeft: -100, level: "overdue" });
    expect(serviceStatus({ date: null, km: null, odoAtSet: 0 }, 0, NOW)).toEqual({ level: "none" });
  });
});

describe("HUD — pogoda", () => {
  it("opisuje kod WMO i ostrzega przed śliską drogą", () => {
    expect(describeWeather(3, true)).toEqual({ text: "Pochmurno", icon: "cloud" });
    expect(describeWeather(0, false).icon).toBe("moon");
    expect(isHazard({ tempC: 12, code: 3, isDay: true })).toBe(false);
    expect(isHazard({ tempC: 1, code: 3, isDay: true })).toBe(true);
    expect(isHazard({ tempC: 8, code: 45, isDay: true })).toBe(true);
  });
});

describe("parkingi i MOP-y", () => {
  it("rozpoznaje MOP, MOP z obsługą i parking TIR; pomija zamknięte dla ciężarówek", () => {
    const p = parseParkings({ elements: [
      { type: "way", id: 1, center: { lat: 52, lon: 21 }, tags: { highway: "rest_area", name: "MOP Wiskitki" } },
      { type: "way", id: 2, center: { lat: 52.1, lon: 21 }, tags: { highway: "services" } },
      { type: "node", id: 3, lat: 52.2, lon: 21, tags: { amenity: "parking", hgv: "designated" } },
      { type: "node", id: 4, lat: 52.3, lon: 21, tags: { highway: "rest_area", hgv: "no" } },
    ] });
    expect(p.map((x) => [x.kind, x.name])).toEqual([["mop", "MOP Wiskitki"], ["services", "MOP"], ["truck", "Parking TIR"]]);
    expect(nearestStation(p, { lat: 52.15, lon: 21 }, 0)?.station.id).toBe("node/3");
  });
});
