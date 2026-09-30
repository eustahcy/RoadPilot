import { describe, expect, it } from "vitest";
import { musicLink } from "./apps";

describe("skróty do aplikacji", () => {
  it("muzyka: schemat na iPhonie, intent z pakietem i stroną zapasową na Androidzie", () => {
    expect(musicLink("none", "ios")).toBeUndefined();
    expect(musicLink("spotify", "ios")).toEqual({ href: "spotify://", web: "https://open.spotify.com/" });
    expect(musicLink("ytmusic", "android")!.href).toBe(
      "intent://music.youtube.com/#Intent;scheme=https;package=com.google.android.apps.youtube.music;S.browser_fallback_url=https%3A%2F%2Fmusic.youtube.com%2F;end",
    );
    expect(musicLink("youtube", "other")!.href).toBe("https://www.youtube.com/");
  });

});
