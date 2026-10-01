// Znajomi: co wysyłamy o sobie (obecność) i jak opisujemy znajomego — odległość, status, od kiedy trwa.
// Czyste funkcje; sieć jest w src/friends.ts.

import { distanceM, Live } from "./gps";
import { Plan } from "./plan";
import { DriverStatus, fmtDuration } from "./scenarios";
import { ActiveStop } from "./stop";
import { alongRoute, RoutePoint } from "./navmatch";

/** Nasza trasa i rzut naszej pozycji na nią (km) — do odległości po trasie zamiast w linii prostej. */
export interface MyRoute {
  points: RoutePoint[];
  km: number;
}

export type PresenceStatus = "driving" | "standing" | "break" | "rest" | "dayEnd";

/** To, co znajomi widzą o nas (server/friends.mjs → cleanPresence). Czasy w ms, odległości w km. */
export interface Presence {
  lat: number;
  lon: number;
  kmh: number | null;
  heading: number | null;
  status: PresenceStatus;
  /** Od kiedy trwa jazda / postój. */
  since: number | null;
  /** Planowana długość postoju (min); null = do ruszenia. */
  targetMin: number | null;
  dest: string;
  arrival: number | null;
  leftKm: number | null;
  driveLeftMin: number | null;
  untilBreakMin: number | null;
}

export interface Friend {
  id: number;
  name: string;
  email: string;
  /** accepted = widzimy się; invited = my zaprosiliśmy, czeka; pending = zaprosili nas, do akceptacji. */
  relation: "accepted" | "invited" | "pending";
  /** null = brak sygnału (udostępnianie wyłączone albo ostatni sygnał sprzed ponad tygodnia). */
  presence: FriendPresence | null;
}

/** Obecność z serwera: `at` = kiedy przyszła; offline = ponad 10 min bez sygnału (aplikacja zamknięta, brak sieci) — to ostatnia znana pozycja. */
export type FriendPresence = Presence & { at: number; offline?: boolean };

/** „przed chwilą”, „35 min temu”, „3 h temu”, „wczoraj”, „4 dni temu”. */
export function fmtAgo(ms: number): string {
  const min = Math.max(0, ms) / 60_000;
  if (min < 1.5) return "przed chwilą";
  if (min < 60) return `${Math.round(min)} min temu`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h temu`;
  const days = Math.floor(min / (24 * 60));
  return days === 1 ? "wczoraj" : `${days} dni temu`;
}

/** Poniżej tej prędkości uznajemy, że stoi (bez oznaczonego postoju). */
const STANDING_KMH = 3;

/**
 * Nasza obecność do wysłania. `since` dla jazdy = początek dnia pracy (shiftStart), dla postoju = jego start.
 * Bez pozycji nie ma czego wysyłać → undefined.
 */
export function presenceOf(live: Live | null, stop: ActiveStop | null, shiftStart: number, status: DriverStatus, plan: Plan | undefined, dest: string, leftKm: number): Presence | undefined {
  if (!live) return undefined;
  const st: PresenceStatus = stop ? (stop.dayEnd ? "dayEnd" : stop.targetMin !== null && stop.targetMin >= 540 ? "rest" : "break") : live.kmh !== null && live.kmh < STANDING_KMH ? "standing" : "driving";
  return {
    lat: live.lat,
    lon: live.lon,
    kmh: live.kmh === null ? null : Math.round(live.kmh),
    heading: live.heading,
    status: st,
    since: stop ? stop.start : shiftStart,
    targetMin: stop?.targetMin ?? null,
    dest,
    arrival: plan?.arrival ?? null,
    leftKm: Math.round(leftKm),
    driveLeftMin: Math.round(status.driveLeftToday),
    untilBreakMin: Math.round(status.untilBreak),
  };
}

export const STATUS_LABEL: Record<PresenceStatus, string> = {
  driving: "Jedzie",
  standing: "Stoi",
  break: "Przerwa",
  rest: "Odpoczynek",
  dayEnd: "Koniec dnia",
};

export interface FriendInfo {
  /** Brak sygnału — pozycja i status to ostatnie znane. */
  offline?: boolean;
  /** Odległość od nas (km) — po trasie, gdy znajomy jest na naszej trasie (onRoute), inaczej w linii prostej; undefined bez własnej pozycji. */
  km?: number;
  onRoute?: boolean;
  /** Na trasie: przed nami (true) czy za nami (false). */
  ahead?: boolean;
  status: string;
  /** „od 25 min”, „25 min z 45 min”, „jedzie 3 h 10 min” — zależnie od statusu. */
  duration: string;
  /** Postój przekroczył plan albo jazda ciągła przy limicie. */
  tone?: "warn" | "ok";
}

/** Opis znajomego do listy i kafelka. `me` = nasza pozycja (może jej nie być), `route` = nasza trasa (km po niej, gdy znajomy przy niej). */
export function describeFriend(p: FriendPresence, me: { lat: number; lon: number } | null, now: number, route?: MyRoute): FriendInfo {
  const along = route ? alongRoute(route.points, p, route.km) : undefined;
  const km = along ? Math.abs(along.km) : me ? distanceM(me, p) / 1000 : undefined;
  const onRoute = along ? true : me ? false : undefined;
  const ahead = along ? along.km >= 0 : undefined;
  // Bez sygnału czas postoju / jazdy liczony do „teraz” byłby zmyślony — tylko kiedy był ostatni sygnał.
  if (p.offline) return { km, onRoute, ahead, offline: true, status: "Brak sygnału", duration: `ostatnio ${fmtAgo(now - p.at)}` };
  const elapsed = p.since !== null ? Math.max(0, (now - p.since) / 60_000) : undefined;
  let duration = "";
  let tone: FriendInfo["tone"];
  if (p.status === "break" || p.status === "rest" || p.status === "dayEnd") {
    if (elapsed !== undefined) {
      duration = p.targetMin !== null ? `${fmtDuration(elapsed)} z ${fmtDuration(p.targetMin)}` : `od ${fmtDuration(elapsed)}`;
      if (p.targetMin !== null && elapsed >= p.targetMin) tone = "ok";
    }
  } else if (p.status === "driving") {
    duration = elapsed !== undefined ? `w trasie ${fmtDuration(elapsed)}` : "";
    if (p.untilBreakMin !== null && p.untilBreakMin <= 30) tone = "warn";
  }
  return { km, onRoute, ahead, status: STATUS_LABEL[p.status], duration, tone };
}

/** Najbliższy znajomy z sygnałem — do kafelka HUD. Z trasą: najpierw po trasie (w obie strony), reszta w linii prostej.
 *  Znajomi bez sygnału (ostatnia pozycja) tylko wtedy, gdy nikt nie nadaje. */
export function nearestFriend(friends: Friend[], me: { lat: number; lon: number } | null, route?: MyRoute): { friend: Friend; km?: number } | undefined {
  const withPos = friends.filter((f) => f.relation === "accepted" && f.presence);
  const live = withPos.filter((f) => !f.presence!.offline);
  let best: { friend: Friend; km?: number } | undefined;
  for (const f of live.length ? live : withPos) {
    if (!f.presence) continue;
    const along = route ? alongRoute(route.points, f.presence, route.km) : undefined;
    const km = along ? Math.abs(along.km) : me ? distanceM(me, f.presence) / 1000 : undefined;
    if (!best || (km !== undefined && (best.km === undefined || km < best.km))) best = { friend: f, km };
  }
  return best;
}
