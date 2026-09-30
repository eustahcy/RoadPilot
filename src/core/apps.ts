// Skróty z HUD do aplikacji muzyki — tylko linki, RoadPilot niczym nie steruje (nawigacja jest własna).
// Czyste funkcje: platformę podaje wywołujący (src/launch.ts).

export type MusicApp = "none" | "spotify" | "youtube" | "ytmusic";
export type Platform = "ios" | "android" | "other";

export const MUSIC_APPS: { id: MusicApp; label: string }[] = [
  { id: "none", label: "Brak" },
  { id: "spotify", label: "Spotify" },
  { id: "youtube", label: "YouTube" },
  { id: "ytmusic", label: "YouTube Music" },
];

export interface AppLink {
  /** Otwiera aplikację (schemat aplikacji na iPhonie, intent na Androidzie, strona na komputerze). */
  href: string;
  /** Strona w przeglądarce, gdy aplikacji nie ma — na iPhonie otwierana po chwili, jeśli aplikacja się nie otworzyła. */
  web: string;
}

/**
 * Android (Chrome): intent z pakietem i `browser_fallback_url` — bez aplikacji przeglądarka sama otwiera stronę.
 * `web` musi być adresem https; jego host i ścieżka idą do intentu.
 */
function androidIntent(web: string, pkg: string): string {
  const u = new URL(web);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${pkg};S.browser_fallback_url=${encodeURIComponent(web)};end`;
}

const MUSIC: Record<Exclude<MusicApp, "none">, { web: string; ios: string; pkg: string }> = {
  spotify: { web: "https://open.spotify.com/", ios: "spotify://", pkg: "com.spotify.music" },
  youtube: { web: "https://www.youtube.com/", ios: "youtube://", pkg: "com.google.android.youtube" },
  ytmusic: { web: "https://music.youtube.com/", ios: "youtubemusic://", pkg: "com.google.android.apps.youtube.music" },
};

export function musicLink(app: MusicApp, platform: Platform): AppLink | undefined {
  if (app === "none") return undefined;
  const m = MUSIC[app];
  if (platform === "ios") return { href: m.ios, web: m.web };
  if (platform === "android") return { href: androidIntent(m.web, m.pkg), web: m.web };
  return { href: m.web, web: m.web };
}
