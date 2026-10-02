import { describe, expect, it } from "vitest";
import { addRecent, EMPTY_PLACES, isFavorite, normalizePlaces, PLACES, removeRecent, setHome, toggleFavorite } from "./places";

const bct = { label: "BCT Gdańsk", sub: "Kontenerowa 7", lat: 54.3889, lon: 18.6612 };
const poz = { label: "Poznań, Głogowska", sub: "", lat: 52.39, lon: 16.89 };

describe("ostatnie cele", () => {
  it("nowy na początek, ten sam (w promieniu 100 m) przenoszony z nowymi danymi trasy", () => {
    let s = addRecent(EMPTY_PLACES, bct, 1000, { lengthKm: 340, travelMin: 280 });
    s = addRecent(s, poz, 2000);
    s = addRecent(s, { ...bct, lat: bct.lat + 0.0005 }, 3000, { lengthKm: 120, travelMin: 95 });
    expect(s.recent.map((r) => [r.to.label, r.at, r.lengthKm])).toEqual([["BCT Gdańsk", 3000, 120], ["Poznań, Głogowska", 2000, undefined]]);
  });
  it("najwyżej PLACES.recentMax, najstarsze odpadają; usuwanie", () => {
    let s = EMPTY_PLACES;
    for (let i = 0; i < PLACES.recentMax + 3; i++) s = addRecent(s, { ...poz, lat: 50 + i * 0.1 }, i);
    expect(s.recent).toHaveLength(PLACES.recentMax);
    expect(s.recent[0].at).toBe(PLACES.recentMax + 2);
    expect(removeRecent(s, s.recent[0].to).recent).toHaveLength(PLACES.recentMax - 1);
  });
});

describe("ulubione i dom", () => {
  it("przełączanie ulubionego, dom ustawiany i usuwany", () => {
    let s = toggleFavorite(EMPTY_PLACES, bct);
    expect(isFavorite(s, bct)).toBe(true);
    s = toggleFavorite(s, bct);
    expect(s.favorites).toEqual([]);
    s = setHome(s, poz);
    expect(s.home).toEqual(poz);
    expect(setHome(s, null).home).toBeNull();
  });
  it("normalizePlaces: brak / uszkodzony zapis → puste listy", () => {
    expect(normalizePlaces(undefined)).toEqual(EMPTY_PLACES);
    expect(normalizePlaces({ home: { label: "x" } as never, favorites: [bct, null as never], recent: [{ to: bct, at: 1 }, { at: 2 } as never] })).toEqual({ home: null, favorites: [bct], recent: [{ to: bct, at: 1 }] });
  });
});
