import { afterEach, expect, it, vi } from "vitest";
import { browserId } from "../src/lib/browser-id";
afterEach(() => vi.unstubAllGlobals());
it("keeps the native UUID path on secure origins", () => {
  const native = vi.fn(() => "12345678-1234-4123-8123-123456789abc");
  vi.stubGlobal("crypto", { randomUUID: native });
  expect(browserId()).toBe("12345678-1234-4123-8123-123456789abc");
  expect(native).toHaveBeenCalledOnce();
});
it("uses random bytes with UUID v4 version and variant on HTTP origins", () => {
  const random = vi.fn((bytes: Uint8Array) => {
    bytes.fill(255);
    return bytes;
  });
  vi.stubGlobal("crypto", { getRandomValues: random });
  expect(browserId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  expect(random).toHaveBeenCalledOnce();
});
