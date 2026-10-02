import { describe, expect, it } from "vitest";
import { activeAt, gddkiaWarnings, parseGddkia } from "./gddkia.mjs";

const XML = `<?xml version="1.0"?><utrudnienia><utr><typ>U</typ><nr_drogi>A1</nr_drogi><km>65.150</km><dl>2.000</dl><geo_lat>52.0045</geo_lat><geo_long>19</geo_long>
<nazwa_odcinka>Kopytkowo - Warlubie</nazwa_odcinka><data_powstania>2026-09-23T00:00:00+0200</data_powstania><data_likwidacji>2026-11-08T23:59:00+0100</data_likwidacji>
<objazd>Przełożenie ruchu na przeciwległą jezdnię</objazd><ogr_nosnosc>30.0</ogr_nosnosc><ogr_szerokosc>3.5</ogr_szerokosc><ogr_predkosc>80</ogr_predkosc>
<ruch_wahadlowy>false</ruch_wahadlowy><ruch_2_kierunkowy>true</ruch_2_kierunkowy><droga_zamknieta>false</droga_zamknieta></utr>
<utr><typ>U</typ><nr_drogi>91</nr_drogi><km>1</km><dl>0</dl><geo_lat>50</geo_lat><geo_long>20</geo_long><data_likwidacji>2026-01-01T00:00:00+0100</data_likwidacji><droga_zamknieta>true</droga_zamknieta></utr></utrudnienia>`;

// Trasa na północ wzdłuż 19°: 10 km, punkt co 100 m.
const DEG = 1 / 111.195;
const route = Array.from({ length: 101 }, (_, i) => [52 + i * 0.1 * DEG, 19, i * 0.1]);
const truck = { weightKg: 40000, axleWeightKg: 11500, heightM: 4, widthM: 2.55 };

describe("utrudnienia GDDKiA", () => {
  it("parsuje plik i odrzuca zakończone", () => {
    const items = parseGddkia(XML);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ road: "A1", roadKm: 65.15, lenKm: 2, contraflow: true, limits: { weight: 30, width: 3.5, speed: 80 } });
    expect(activeAt(items, Date.UTC(2026, 9, 2))).toHaveLength(1);
  });

  it("odcinek na trasie w kierunku pikietażu; ograniczenie masy dla 40 t", () => {
    const [u] = activeAt(parseGddkia(XML), Date.UTC(2026, 9, 2));
    const ws = gddkiaWarnings(route, [u], truck);
    expect(ws[0]).toMatchObject({ source: "gddkia", kind: "roadworks", raw: "contraflow", value: 80 });
    expect(ws[0].km).toBeCloseTo(0.5, 1);
    expect(ws[0].toKm).toBeCloseTo(2.5, 1);
    expect(ws.find((w) => w.kind === "weight")).toMatchObject({ value: 30 });
    expect(ws.find((w) => w.kind === "width")).toBeUndefined(); // 3,5 m pasa > 2,55 m zestawu
    // Słupki A1 malejące wzdłuż trasy (km 68 … 64): odcinek 65,15–67,15 drogi = km trasy 0,85–2,85 — niezależnie od współrzędnych.
    const ms = [0, 1, 2, 3, 4].map((i) => ({ km: i, v: 68 - i, ref: "A1" }));
    const byKm = gddkiaWarnings(route, [{ ...u, lat: 40, lon: 10 }], truck, ms);
    expect(byKm[0].km).toBeCloseTo(0.85, 1);
    expect(byKm[0].toKm).toBeCloseTo(2.85, 1);
    // Koniec poza słupkami (67,5–68,5 przy słupkach 68…67 na km 0–1): drugi koniec z długości, przed startem trasy — przycięty do 0.
    const part = gddkiaWarnings(route, [{ ...u, roadKm: 67.5, lenKm: 1 }], truck, ms.slice(0, 2));
    expect(part[0].km).toBeCloseTo(0, 1);
    expect(part[0].toKm).toBeCloseTo(0.5, 1);
  });
});
