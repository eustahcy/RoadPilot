export { fmtDuration } from "./core/scenarios";

const DAYS = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtTime(t: number) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** „14:20”, „jutro 07:35”, „cz 07:35” — względem `ref`. */
export function fmtClock(t: number, ref: number) {
  const day = dayDiff(ref, t);
  const time = fmtTime(t);
  if (day === 0) return time;
  if (day === 1) return `jutro ${time}`;
  if (day === -1) return `wczoraj ${time}`;
  return `${DAYS[new Date(t).getDay()]} ${time}`;
}

function dayDiff(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  da.setHours(12, 0, 0, 0);
  db.setHours(12, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function fmtKm(km: number) {
  return `${Math.round(km)} km`;
}

/** Wartość dla <input type="datetime-local"> w czasie lokalnym. */
export function toLocalInput(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
