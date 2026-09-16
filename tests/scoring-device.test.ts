import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import { bindScoringDevice } from "../src/server/scoring-device";
import type { AuthContext } from "../src/server/auth";
const context = () =>
  ({
    json: (data: unknown, status = 200) => NextResponse.json(data, { status }),
  }) as AuthContext;
describe("server-bound scoring device", () => {
  it("issues a private credential and never includes it in JSON", async () => {
    vi.stubEnv("SCRABBLE_APP_ORIGIN", "https://family.example");
    const bound = bindScoringDevice(
      new Request("https://family.example/api/family"),
      context(),
    );
    const response = bound.context.json({ ok: true });
    const cookie = response.cookies.get("scrabble-scoring-device");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
    expect(cookie?.path).toBe("/api/family");
    expect(bound.deviceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await response.text()).not.toContain(cookie!.value);
  });
  it("keeps the credential stable in its browser and separates another browser", () => {
    vi.stubEnv("SCRABBLE_APP_ORIGIN", "http://127.0.0.1:3001");
    const first = bindScoringDevice(
      new Request("http://127.0.0.1:3001/api/family"),
      context(),
    );
    const cookie = first.context
      .json({})
      .cookies.get("scrabble-scoring-device")!;
    const second = bindScoringDevice(
      new Request("http://127.0.0.1:3001/api/family", {
        headers: { cookie: `scrabble-scoring-device=${cookie.value}` },
      }),
      context(),
    );
    expect(second.deviceHash).toBe(first.deviceHash);
    expect(
      second.context.json({}).cookies.get("scrabble-scoring-device"),
    ).toBeUndefined();
    expect(
      bindScoringDevice(
        new Request("http://127.0.0.1:3001/api/family"),
        context(),
      ).deviceHash,
    ).not.toBe(first.deviceHash);
  });
});
