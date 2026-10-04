import { describe, expect, it } from "vitest";
import {
  initializeGameSoundPreferences,
  readGameSoundPreference,
  saveGameSoundPreference,
} from "../src/lib/game-sound-preference";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe("per-game device sound preference", () => {
  it("keeps mute on reopen, starts the next game On, and isolates another device", () => {
    const one = storage(),
      two = storage();
    expect(readGameSoundPreference(one, "first")).toBe(true);
    saveGameSoundPreference(one, "first", false);
    expect(readGameSoundPreference(one, "first")).toBe(false);
    expect(readGameSoundPreference(one, "second")).toBe(true);
    expect(readGameSoundPreference(two, "first")).toBe(true);
    saveGameSoundPreference(one, "first", true);
    expect(readGameSoundPreference(one, "first")).toBe(true);
  });
  it("migrates legacy mute only to games already present at upgrade", () => {
    const local = storage();
    local.setItem("amberly-game-sounds", "off");
    initializeGameSoundPreferences(local, Date.parse("2026-10-04T15:00:00Z"));
    expect(
      readGameSoundPreference(local, "ongoing", "2026-10-04T14:00:00Z"),
    ).toBe(false);
    expect(readGameSoundPreference(local, "new", "2026-10-04T16:00:00Z")).toBe(
      true,
    );
    expect(
      readGameSoundPreference(local, "ongoing", "2026-10-04T14:00:00Z"),
    ).toBe(false);
    expect(readGameSoundPreference(local, "undated-current")).toBe(false);
    expect(readGameSoundPreference(local, "undated-next")).toBe(true);
  });
  it("does not prevent play when storage is denied or old data is malformed", () => {
    const broken = {
      getItem: () => {
        throw Error("denied");
      },
      setItem: () => {
        throw Error("denied");
      },
    };
    expect(() => initializeGameSoundPreferences(broken)).not.toThrow();
    expect(readGameSoundPreference(broken, "game")).toBe(true);
    expect(() => saveGameSoundPreference(broken, "game", false)).not.toThrow();
    const local = storage();
    local.setItem("amberly-game-sounds:per-game-migration", "broken");
    expect(readGameSoundPreference(local, "game")).toBe(true);
  });
});
