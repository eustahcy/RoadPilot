// Scalanie stanu z dwóch urządzeń na jednym koncie: stan dzielimy na grupy i w każdej wygrywa nowsza zmiana
// (znacznik czasu ustawiany przez urządzenie, na którym zmiana powstała). Dawniej wygrywał cały stan z konta — telefon
// z wczorajszym stanem potrafił nadpisać „Rozpocznij dzień” zrobione rano na innym (brak odpoczynku 11 h w liczniku).

import { DayLog, HISTORY } from "./core/history";
import { AppState } from "./state";

/** Grupy pól zmieniane razem: tachograf (liczniki z GPS i postój), plan trasy, ustawienia, historia. */
export const SYNC_GROUPS = {
  tacho: ["driver", "stop", "tracker", "odoKm"],
  trip: ["trip", "choice"],
  settings: ["settings"],
  history: ["history"],
} as const satisfies Record<string, readonly (keyof AppState)[]>;

export type SyncGroup = keyof typeof SYNC_GROUPS;
export const GROUP_IDS = Object.keys(SYNC_GROUPS) as SyncGroup[];

/** Kiedy (ms) grupa zmieniła się ostatnio na urządzeniu, które ją zmieniło; brak = nigdy (stan sprzed znaczników). */
export type Stamps = Partial<Record<SyncGroup, number>>;

export function groupJson(s: AppState, g: SyncGroup): string {
  return JSON.stringify(SYNC_GROUPS[g].map((k) => s[k]));
}

/**
 * Historia: dni z obu stron (inne urządzenie mogło zapisać dni, których tu nie ma); ten sam dzień — z nowszej strony.
 * Wyczyszczona historia po nowszej stronie zostaje pusta.
 */
function mergeHistory(newer: DayLog[], older: DayLog[]): DayLog[] {
  if (!newer.length) return newer;
  const dates = new Set(newer.map((d) => d.date));
  return [...newer, ...older.filter((d) => !dates.has(d.date))].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, HISTORY.keepDays);
}

export interface MergeResult {
  state: AppState;
  stamps: Stamps;
  /** Grupy, w których została nasza (nowsza) wersja — trzeba ją wysłać. */
  localWon: SyncGroup[];
  /** Liczniki tachografu przyszły z innego urządzenia — nasz licznik GPS trzeba zacząć od nowa. */
  resetTrack: boolean;
}

/**
 * Scala stan tego urządzenia (`local`, znaczniki `ls`) ze stanem z konta (`remote`, `rs`). W każdej grupie wygrywa nowszy
 * znacznik; remis (np. oba bez znaczników) — konto. Pola tylko tego urządzenia (track, HUD, nawigacja…) zostają z `local`.
 * Gdy tachograf przychodzi z konta, a jazdę liczyło inne urządzenie, licznik GPS tego urządzenia jest nieaktualny —
 * dalej liczyłby lukę od swojego ostatniego odczytu i dodał jazdę drugi raz (resetTrack).
 */
export function mergeStates(local: AppState, ls: Stamps, remote: AppState, rs: Stamps, device: string): MergeResult {
  const state: AppState = { ...remote, track: local.track, hud: local.hud, navOpen: local.navOpen, planTime: local.planTime, navRoute: local.navRoute, pendingGap: local.pendingGap };
  const stamps: Stamps = {};
  const localWon: SyncGroup[] = [];
  let resetTrack = false;
  const set = <K extends keyof AppState>(k: K, v: AppState[K]) => {
    state[k] = v;
  };
  for (const g of GROUP_IDS) {
    const same = groupJson(local, g) === groupJson(remote, g);
    const mine = (ls[g] ?? 0) > (rs[g] ?? 0);
    stamps[g] = Math.max(ls[g] ?? 0, rs[g] ?? 0) || undefined;
    if (g === "history") {
      set("history", same ? remote.history : mine ? mergeHistory(local.history, remote.history) : mergeHistory(remote.history, local.history));
      if (!same && JSON.stringify(state.history) !== JSON.stringify(remote.history)) localWon.push(g);
      continue;
    }
    if (same) continue;
    if (mine) {
      for (const k of SYNC_GROUPS[g]) set(k, local[k]);
      localWon.push(g);
    } else if (g === "tacho" && remote.tracker?.device !== device) {
      resetTrack = true;
    }
  }
  if (resetTrack) {
    state.track = null;
    state.pendingGap = null;
  }
  return { state, stamps, localWon, resetTrack };
}
