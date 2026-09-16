import { describe, it, expect } from "vitest";
import {
  isValidPlayerProfile,
  isValidSavedPlayerProfile,
  isValidProfilePhoto,
  MAX_PROFILE_PHOTO_BYTES,
} from "../src/lib/player-profile";
const photo = (bytes: number[]) =>
  "data:image/jpeg;base64," + btoa(String.fromCharCode(...bytes));
const validPhoto = photo([255, 216, 255, 224, 255, 217]);
describe("player profile validation", () => {
  it("accepts existing profiles and bounded optional information", () => {
    expect(isValidSavedPlayerProfile({ id: "a", name: "Doug" })).toBe(true);
    expect(
      isValidPlayerProfile({
        name: "Doug",
        bio: "Enjoys long words.",
        photoDataUrl: validPhoto,
      }),
    ).toBe(true);
    expect(
      isValidPlayerProfile({ name: "a".repeat(60), bio: "b".repeat(240) }),
    ).toBe(true);
  });
  it("rejects missing, overlong and malformed metadata", () => {
    for (const value of [
      null,
      [],
      {},
      { name: "" },
      { name: " Doug " },
      { name: "a".repeat(61) },
      { name: "Doug", bio: "a".repeat(241) },
      { name: "Doug", bio: null },
      { name: "Doug", photoDataUrl: undefined },
      { name: "Doug", admin: true },
      { name: "D\0oug" },
      new Date(),
      { name: "Doug", bio: 4 },
    ])
      expect(isValidPlayerProfile(value)).toBe(false);
  });
  it("rejects getters without invoking them and nonplain objects", () => {
    let invoked = false;
    const value = {
      get name() {
        invoked = true;
        throw Error("no");
      },
    };
    expect(isValidPlayerProfile(value)).toBe(false);
    expect(invoked).toBe(false);
    expect(isValidPlayerProfile(Object.create({ name: "Doug" }))).toBe(false);
    expect(isValidSavedPlayerProfile({ id: "", name: "Doug" })).toBe(false);
  });
  it("accepts only bounded canonical JPEG data with JPEG signature and ending", () => {
    expect(isValidProfilePhoto(validPhoto)).toBe(true);
    for (const bad of [
      "https://example.com/a.jpg",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,abcd",
      "data:image/jpeg;base64,",
      validPhoto + "\n",
      validPhoto.replace("base64,", "base64, "),
      photo([255, 216, 255, 0]),
      photo([0, 216, 255, 255, 217]),
      "data:image/jpeg;base64," +
        "A".repeat(4 * Math.ceil(MAX_PROFILE_PHOTO_BYTES / 3) + 4),
    ])
      expect(isValidProfilePhoto(bad)).toBe(false);
  });
  it("removal is represented by omitted optional fields", () => {
    expect(isValidPlayerProfile({ name: "Doug" })).toBe(true);
    expect(isValidPlayerProfile({ name: "Doug", photoDataUrl: "" })).toBe(
      false,
    );
  });
});

// Browser API fakes verify resizing, failure and disposal without persisting files.
import { afterEach, vi } from "vitest";
import { prepareProfilePhoto } from "../src/lib/player-profile";
describe("local photo preparation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function setup() {
    const images: Array<{
      onload: (() => void) | null;
      onerror: (() => void) | null;
      src: string;
      naturalWidth: number;
      naturalHeight: number;
    }> = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      naturalWidth = 1200;
      naturalHeight = 600;
      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: "", fillRect, drawImage }),
      toDataURL: vi.fn(() => validPhoto),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-photo");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    return { images, canvas, drawImage, fillRect, revoke };
  }
  const file = () =>
    new File([new Uint8Array([255, 216, 255, 224, 255, 217])], "portrait.jpg", {
      type: "image/jpeg",
    });
  it("shrinks to at most 256 pixels, preserves aspect and disposes browser resources", async () => {
    const s = setup();
    const pending = prepareProfilePhoto(file());
    await vi.waitFor(() => expect(s.images).toHaveLength(1));
    s.images[0].onload!();
    expect(await pending).toBe(validPhoto);
    expect(s.drawImage).toHaveBeenCalledWith(s.images[0], 0, 0, 256, 128);
    expect(s.fillRect).toHaveBeenCalledWith(0, 0, 256, 128);
    expect(s.canvas.width).toBe(0);
    expect(s.images[0].src).toBe("");
    expect(s.revoke).toHaveBeenCalledWith("blob:local-photo");
  });
  it("rejects wrong format and oversized upload before decoding", async () => {
    const s = setup();
    await expect(
      prepareProfilePhoto(
        new File(["text"], "image.png", { type: "image/png" }),
      ),
    ).rejects.toThrow(/format/);
    await expect(
      prepareProfilePhoto(
        new File(["svg"], "image.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow(/JPEG/);
    await expect(
      prepareProfilePhoto(
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.jpg", {
          type: "image/jpeg",
        }),
      ),
    ).rejects.toThrow(/8 MB/);
    expect(s.images).toHaveLength(0);
  });
  it("cleans up an unreadable image and preserves the caller failure", async () => {
    const s = setup();
    const pending = prepareProfilePhoto(file());
    const rejected = expect(pending).rejects.toThrow(/could not be opened/);
    await vi.waitFor(() => expect(s.images).toHaveLength(1));
    s.images[0].onerror!();
    await rejected;
    expect(s.revoke).toHaveBeenCalledOnce();
  });
  it("cancels obsolete image processing and revokes its local URL", async () => {
    const s = setup();
    const abort = new AbortController();
    const pending = prepareProfilePhoto(file(), abort.signal);
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    await vi.waitFor(() => expect(s.images).toHaveLength(1));
    abort.abort();
    await rejected;
    expect(s.revoke).toHaveBeenCalledOnce();
    expect(s.images[0].onload).toBe(null);
  });
  it("rejects invalid encoded canvas output instead of saving it", async () => {
    const s = setup();
    s.canvas.toDataURL.mockReturnValue("data:,");
    const pending = prepareProfilePhoto(file());
    const rejected = expect(pending).rejects.toThrow(/unreadable/);
    await vi.waitFor(() => expect(s.images).toHaveLength(1));
    s.images[0].onload!();
    await rejected;
    expect(s.canvas.width).toBe(0);
    expect(s.revoke).toHaveBeenCalledOnce();
  });
});
