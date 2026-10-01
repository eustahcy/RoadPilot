// Znajomi: lista z konta (odświeżana co 30 s, gdy aplikacja jest widoczna) i wysyłka naszej obecności
// (co 20 s przy włączonym GPS i udostępnianiu; od razu przy zmianie statusu). Wyłączenie udostępniania kasuje
// obecność na serwerze. Bez konta i bez sieci nic się nie dzieje — aplikacja działa jak dotąd.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Friend, Presence, presenceSendable } from "./core/friends";

const REFRESH_MS = 30_000;
const PRESENCE_EVERY_MS = 20_000;

export interface FriendsApi {
  friends: Friend[];
  /** Ostatnie pobranie się nie udało (brak sieci) — lista może być nieaktualna. */
  stale: boolean;
  refresh: () => Promise<void>;
  invite: (email: string) => Promise<Friend["relation"]>;
  accept: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export function useFriends(token: string | null, share: boolean, presence: Presence | undefined): FriendsApi {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [stale, setStale] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!token || busy.current) return;
    busy.current = true;
    try {
      const r = await api<{ friends: Friend[] }>("GET", "/friends", undefined, token);
      setFriends(r.friends);
      setStale(false);
    } catch {
      setStale(true);
    } finally {
      busy.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setFriends([]);
      return;
    }
    refresh();
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, refresh]);

  // Obecność: ostatnia wartość w ref, wysyłka z interwału i przy zmianie statusu (jedzie → przerwa).
  const latest = useRef(presence);
  latest.current = presence;
  const hasFriends = friends.some((f) => f.relation === "accepted");
  const sending = !!token && share && hasFriends;
  const statusKey = presence?.status ?? "";
  useEffect(() => {
    if (!sending) return;
    const send = () => {
      const p = latest.current;
      const now = Date.now();
      if (!p || !presenceSendable(p, now)) return;
      // Wiek pozycji zamiast chwili odczytu — serwer liczy „sygnał X temu” od odczytu GPS, a zegar telefonu może się różnić.
      const { posAt, ...rest } = p;
      api("POST", "/presence", { ...rest, posAge: posAt !== undefined ? Math.max(0, now - posAt) : 0 }, token).catch(() => {});
    };
    send();
    const id = setInterval(send, PRESENCE_EVERY_MS);
    return () => clearInterval(id);
  }, [sending, token, statusKey]);

  // Wyłączenie udostępniania (albo GPS) → znajomi mają nas nie widzieć: kasujemy obecność na serwerze.
  const wasSending = useRef(false);
  useEffect(() => {
    if (wasSending.current && !sending && token) api("POST", "/presence", { off: true }, token).catch(() => {});
    wasSending.current = sending;
  }, [sending, token]);

  const invite = useCallback(async (email: string) => {
    const r = await api<{ relation: Friend["relation"] }>("POST", "/friends/invite", { email }, token ?? undefined);
    await refresh();
    return r.relation;
  }, [token, refresh]);
  const accept = useCallback(async (id: number) => {
    await api("POST", "/friends/accept", { id }, token ?? undefined);
    await refresh();
  }, [token, refresh]);
  const remove = useCallback(async (id: number) => {
    await api("DELETE", "/friends", { id }, token ?? undefined);
    await refresh();
  }, [token, refresh]);

  return { friends, stale, refresh, invite, accept, remove };
}
