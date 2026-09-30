// Połączenie z RoadPilot API (konta i synchronizacja). Token sesji trzymamy w localStorage — aplikacja działa offline,
// a z serwerem łączy się, gdy jest sieć.

/** Własny adres API (np. gdy front jest na innym hostingu niż API) — VITE_API_URL przy budowaniu; domyślnie obok aplikacji. */
const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? `${import.meta.env.BASE_URL}api`;
const AUTH_KEY = "roadpilot:auth";
const GUEST_KEY = "roadpilot:guest";

export interface User {
  id: number;
  email: string;
  name: string;
  /** Administrator — może nadawać Premium (Ustawienia → Administracja). */
  admin?: boolean;
  /** Premium aktywne (nawigacja dla ciężarówek). premiumUntil: ms, null = brak; rok 9999 = bez terminu. */
  premium?: boolean;
  premiumUntil?: number | null;
  /** Zgoda na przekazywanie śladu i zgłoszeń do mapy RoadPilot. */
  dataConsent?: boolean;
}

export interface AdminUser extends User {
  createdAt: number;
}

export interface Auth {
  token: string;
  user: User;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Pełny adres zasobu API (np. kafelka mapy). */
export const apiUrl = (path: string) => `${API}${path}`;

/** Zapytanie do API. Brak sieci → ApiError(0). */
export async function api<T>(method: string, path: string, body?: unknown, token?: string, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive,
    });
  } catch {
    throw new ApiError(0, "Brak połączenia z internetem.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "Błąd serwera. Spróbuj ponownie za chwilę.");
  return data as T;
}

export function loadAuth(): Auth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as Auth) : null;
  } catch {
    return null;
  }
}

export function saveAuth(auth: Auth | null) {
  try {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* brak zapisu — sesja tylko do zamknięcia */
  }
}

/** Kierowca wybrał „bez konta” — nie pokazujemy mu ekranu logowania przy każdym starcie. */
export function isGuest() {
  try {
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGuest(v: boolean) {
  try {
    if (v) localStorage.setItem(GUEST_KEY, "1");
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* jw. */
  }
}
