import { describe, expect, it } from "vitest";
import { fromWorldPx, moveView, worldPx } from "./components/MapView";

const view = { center: { lat: 52, lon: 19 }, zoom: 10 };
const box = { w: 400, h: 300 };

/** Punkt świata pod pikselem ekranu (x, y) dla widoku z góry, bez obrotu. */
const under = (v: { center: { lat: number; lon: number }; zoom: number }, x: number, y: number, bearing = 0) => {
  const [cx, cy] = worldPx(v.center, v.zoom);
  const b = (bearing * Math.PI) / 180;
  const dx = x - box.w / 2;
  const dy = y - box.h / 2;
  return fromWorldPx(cx + dx * Math.cos(b) - dy * Math.sin(b), cy + dx * Math.sin(b) + dy * Math.cos(b), v.zoom);
};

describe("moveView", () => {
  it("brak ruchu nie zmienia widoku", () => {
    const [c, z] = moveView(view, { dx: 0, dy: 0, dz: 0, ax: 200, ay: 150 }, box);
    expect(z).toBe(10);
    expect(c.lat).toBeCloseTo(52, 9);
    expect(c.lon).toBeCloseTo(19, 9);
  });

  it("przeciągnięcie w prawo przesuwa mapę na zachód (środek idzie w lewo)", () => {
    const [c] = moveView(view, { dx: 100, dy: 0, dz: 0, ax: 300, ay: 150 }, box);
    expect(c.lon).toBeLessThan(19);
    expect(c.lat).toBeCloseTo(52, 6);
  });

  it("punkt pod palcem zostaje pod palcem przy przesuwaniu na obróconej mapie", () => {
    const bearing = 70;
    const start = under(view, 120, 80, bearing);
    const [c, z] = moveView(view, { dx: 60, dy: -40, dz: 0, ax: 180, ay: 40 }, { ...box, bearing });
    const end = under({ center: c, zoom: z }, 180, 40, bearing);
    expect(end.lat).toBeCloseTo(start.lat, 6);
    expect(end.lon).toBeCloseTo(start.lon, 6);
  });

  it("szczypanie przybliża wokół palców — punkt między palcami stoi w miejscu", () => {
    const start = under(view, 320, 60);
    const [c, z] = moveView(view, { dx: 0, dy: 0, dz: 1, ax: 320, ay: 60 }, box);
    expect(z).toBe(11);
    const end = under({ center: c, zoom: z }, 320, 60);
    expect(end.lat).toBeCloseTo(start.lat, 6);
    expect(end.lon).toBeCloseTo(start.lon, 6);
  });

  it("zoom w granicach mapy", () => {
    expect(moveView(view, { dx: 0, dy: 0, dz: -20, ax: 200, ay: 150 }, box)[1]).toBe(4);
    expect(moveView(view, { dx: 0, dy: 0, dz: 20, ax: 200, ay: 150 }, box)[1]).toBe(18);
  });
});
