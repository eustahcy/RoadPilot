// Synchronizacja stanu z kontem. Telefon jest źródłem prawdy na bieżąco (działa offline), serwer — kopią między
// urządzeniami. Zmiany wysyłamy co najwyżej co 30 s, od razu przy schowaniu aplikacji; nowszą wersję z konta pobieramy
// przy starcie, powrocie do aplikacji i co 30 s, o ile tu nie ma niewysłanych zmian. Zapis podaje wersję, od której
// wyszedł (baseRev) — gdy w międzyczasie zapisało inne urządzenie (np. tablet „zaczynam przerwę”), serwer odpowiada 409,
// a my bierzemy stan z konta zamiast go nadpisać. Jazdę z GPS dolicza tylko jedno urządzenie (AppState.tracker).

import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, Auth } from "./api";
import { AppState, normalize } from "./state";

const META_KEY = "roadpilot:sync";
const PUSH_EVERY_MS = 30_000;
/** Co tyle pobieramy zmiany z konta, gdy aplikacja jest widoczna (drugie urządzenie na tym samym koncie). */
const PULL_EVERY_MS = 30_000;

export type SyncStatus = { kind: "off" } | { kind: "syncing" } | { kind: "ok"; at: number } | { kind: "offline" } | { kind: "error"; message: string };

/** Wersja z serwera, którą ostatnio mieliśmy, i czy są zmiany do wysłania. */
interface Meta {
  rev: number;
  dirty: boolean;
}

/** Pola tylko dla tego urządzenia — nie trafiają na konto. */
export function syncable(s: AppState) {
  const { track: _track, hud: _hud, navOpen: _navOpen, planTime: _planTime, navRoute: _navRoute, ...rest } = s;
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
  const conflict = useRef(false);
  const pullRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
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
      const r = await api<{ rev: number }>("PUT", "/state", { state: JSON.parse(body), baseRev: meta.current.rev }, token, keepalive);
      sent.current = body;
      setMeta({ rev: r.rev, dirty: latest.current !== body });
      setStatus({ kind: "ok", at: Date.now() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) conflict.current = true;
      else fail(e);
    } finally {
      busy.current = false;
    }
    // Inne urządzenie zapisało w międzyczasie — jego wersja wygrywa (nasze niewysłane zmiany przepadają).
    if (conflict.current) {
      conflict.current = false;
      await pullRef.current(true);
    }
  }, [token, fail]);

  const pull = useCallback(async (force = false) => {
    if (!token || busy.current) return;
    busy.current = true;
    setStatus({ kind: "syncing" });
    let needPush = false;
    try {
      const r = await api<{ state: AppState | null; rev: number }>("GET", "/state", undefined, token);
      if (r.state && (force || (r.rev > meta.current.rev && !meta.current.dirty))) {
        const incoming = normalize(r.state);
        sent.current = JSON.stringify(syncable(incoming));
        setMeta({ rev: r.rev, dirty: false });
        // Pozycja GPS, HUD, otwarta nawigacja, godzina planowania i trasa zostają z tego urządzenia
        // (bez navOpen każde pobranie z konta wyrzucało z nawigacji na ekran główny).
        setState((s) => ({ ...incoming, track: s.track, hud: s.hud, navOpen: s.navOpen, planTime: s.planTime, navRoute: s.navRoute }));
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
  pullRef.current = pull;

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
    const poll = setInterval(() => document.visibilityState === "visible" && !meta.current.dirty && pull(), PULL_EVERY_MS);
    return () => {
      clearInterval(poll);
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
