// Pogoda: kod WMO z Open-Meteo → opis i ikona. Pobieranie jest w src/nearby.ts.

export type WeatherIcon = "sun" | "moon" | "cloud" | "fog" | "rain" | "snow" | "storm";

export interface Weather {
  tempC: number;
  code: number;
  isDay: boolean;
}

/** Opis i ikona dla kodu pogody WMO. */
export function describeWeather(code: number, isDay: boolean): { text: string; icon: WeatherIcon } {
  if (code <= 1) return { text: "Bezchmurnie", icon: isDay ? "sun" : "moon" };
  if (code === 2) return { text: "Małe zachmurzenie", icon: isDay ? "sun" : "moon" };
  if (code === 3) return { text: "Pochmurno", icon: "cloud" };
  if (code === 45 || code === 48) return { text: "Mgła", icon: "fog" };
  if (code >= 51 && code <= 57) return { text: code >= 56 ? "Marznąca mżawka" : "Mżawka", icon: "rain" };
  if (code >= 61 && code <= 67) return { text: code >= 66 ? "Marznący deszcz" : "Deszcz", icon: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { text: "Śnieg", icon: "snow" };
  if (code >= 80 && code <= 82) return { text: "Przelotny deszcz", icon: "rain" };
  if (code >= 95) return { text: "Burza", icon: "storm" };
  return { text: "Pochmurno", icon: "cloud" };
}

/** Ślisko lub słaba widoczność — warto zwrócić uwagę kierowcy. */
export function isHazard(w: Weather): boolean {
  const freezing = [56, 57, 66, 67].includes(w.code);
  const snow = (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86;
  return w.tempC <= 2 || freezing || snow || w.code === 45 || w.code === 48 || w.code >= 95;
}
