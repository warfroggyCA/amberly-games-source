import { afterEach, expect, it, vi } from "vitest";
import {
  readDirectionPreference,
  saveDirectionPreference,
} from "../src/lib/direction-preference";

afterEach(() => vi.unstubAllGlobals());

it("defaults old drafts to Auto and keeps deliberate choices scoped to a game", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(readDirectionPreference("first")).toBe("auto");
  saveDirectionPreference("first", "down");
  expect(readDirectionPreference("first")).toBe("down");
  expect(readDirectionPreference("second")).toBe("auto");
  saveDirectionPreference("first", "across");
  expect(readDirectionPreference("first")).toBe("across");
  saveDirectionPreference("first", "auto");
  expect(readDirectionPreference("first")).toBe("auto");
});

it("does not prevent scoring when storage is blocked or contains an unknown mode", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => "unrecognized",
    setItem: () => {
      throw new Error("Storage denied");
    },
  });
  expect(readDirectionPreference("first")).toBe("auto");
  expect(() => saveDirectionPreference("denied", "down")).not.toThrow();
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Storage denied");
    },
  });
  expect(readDirectionPreference("first")).toBe("auto");
  expect(readDirectionPreference("denied")).toBe("down");
});
