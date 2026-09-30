// Synchronizacja stanu z kontem. Telefon jest źródłem prawdy na bieżąco (działa offline), serwer — kopią między
// urządzeniami. Zasada: ostatni zapis wygrywa. Zmiany wysyłamy co najwyżej co 30 s, od razu przy schowaniu aplikacji;
// przy starcie i powrocie do aplikacji pobieramy nowszą wersję z konta, o ile tu nie ma niewysłanych zmian.

import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, Auth } from "./api";
import { AppState, normalize } from "./state";

const META_KEY = "roadpilot:sync";
const PUSH_EVERY_MS = 30_000;

export type SyncStatus = { kind: "off" } | { kind: "syncing" } | { kind: "ok"; at: number } | { kind: "offline" } | { kind: "error"; message: string };

/** Wersja z serwera, którą ostatnio mieliśmy, i czy są zmiany do wysłania. */
interface Meta {
  rev: number;
  dirty: boolean;
}

/** Pola tylko dla tego urządzenia — nie trafiają na konto. */
export function syncable(s: AppState) {
  const { track: _track, hud: _hud, planTime: _planTime, navRoute: _navRoute, ...rest } = s;
  return rest;
}

function readMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? "null") as Meta | null;
    return m && typeof m.rev === "number" ? m : { rev: 0, dirty: false };
  } catch {
    return { rev: 0, dirty: false };
  }
}

function writeMeta(m: Meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    /* brak zapisu */
  }
}

/** Po zalogowaniu / wylogowaniu zaczynamy od zera — konto ma pierwszeństwo przed danymi z telefonu. */
export function resetSync() {
  writeMeta({ rev: 0, dirty: false });
}

export function useSync(auth: Auth | null, state: AppState, setState: Dispatch<SetStateAction<AppState>>, onExpired: () => void): { status: SyncStatus; push: () => Promise<void> } {
  const [status, setStatus] = useState<SyncStatus>({ kind: "off" });
  const meta = useRef(readMeta());
  const sent = useRef<string | null>(null);
  const latest = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const token = auth?.token;
  latest.current = JSON.stringify(syncable(state));

  const setMeta = (m: Meta) => {
    meta.current = m;
    writeMeta(m);
  };

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) return onExpired();
    setStatus(e instanceof ApiError && e.status === 0 ? { kind: "offline" } : { kind: "error", message: e instanceof Error ? e.message : "Błąd synchronizacji." });
  }, [onExpired]);

  const push = useCallback(async (keepalive = false) => {
    if (!token || busy.current) return;
    const body = latest.current;
    busy.current = true;
    setStatus({ kind: "syncing" });
    try {
      const r = await api<{ rev: number }>("PUT", "/state", { state: JSON.parse(body) }, token, keepalive);
      sent.current = body;
      setMeta({ rev: r.rev, dirty: latest.current !== body });
      setStatus({ kind: "ok", at: Date.now() });
    } catch (e) {
      fail(e);
    } finally {
      busy.current = false;
    }
  }, [token, fail]);

  const pull = useCallback(async () => {
    if (!token || busy.current) return;
    busy.current = true;
    setStatus({ kind: "syncing" });
    let needPush = false;
    try {
      const r = await api<{ state: AppState | null; rev: number }>("GET", "/state", undefined, token);
      if (r.state && r.rev > meta.current.rev && !meta.current.dirty) {
        const incoming = normalize(r.state);
        sent.current = JSON.stringify(syncable(incoming));
        setMeta({ rev: r.rev, dirty: false });
        // Pozycja GPS, HUD, godzina planowania i trasa nawigacji zostają z tego urządzenia.
        setState((s) => ({ ...incoming, track: s.track, hud: s.hud, planTime: s.planTime, navRoute: s.navRoute }));
        setStatus({ kind: "ok", at: Date.now() });
      } else {
        needPush = !r.state || meta.current.dirty;
        if (!needPush) setStatus({ kind: "ok", at: Date.now() });
      }
    } catch (e) {
      fail(e);
    } finally {
      busy.current = false;
    }
    if (needPush) await push();
  }, [token, setState, fail, push]);

  // Start / zalogowanie i każdy powrót do aplikacji: pobierz. Schowanie aplikacji: wyślij zaległe zmiany.
  useEffect(() => {
    if (!token) {
      setStatus({ kind: "off" });
      return;
    }
    // To, co jest teraz w telefonie, uznajemy za zgodne z ostatnią pobraną wersją (chyba że są niewysłane zmiany).
    if (!meta.current.dirty) sent.current = latest.current;
    pull();
    const onVisibility = () => {
      if (document.visibilityState === "visible") pull();
      else if (meta.current.dirty) push(true);
    };
    const onOnline = () => (meta.current.dirty ? push() : pull());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [token, pull, push]);

  // Każda zmiana danych konta: oznacz do wysłania i wyślij najpóźniej za 30 s.
  useEffect(() => {
    if (!token || latest.current === sent.current) return;
    if (!meta.current.dirty) setMeta({ ...meta.current, dirty: true });
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      push();
    }, PUSH_EVERY_MS);
  });

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [token]);

  return { status, push: () => push() };
}
