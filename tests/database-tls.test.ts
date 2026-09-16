import { readFileSync } from "node:fs";
import { checkServerIdentity } from "node:tls";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTls } from "../src/server/database-tls";

const ca = readFileSync(
  new URL("../config/certs/supabase-ca-2021.crt", import.meta.url),
  "utf8",
);
const remote = new URL(
  "postgresql://restricted@example.supabase.co/postgres?sslmode=disable",
);

beforeEach(() => vi.stubEnv("SCRABBLE_DATABASE_CA_CERT", undefined));
afterEach(() => vi.unstubAllEnvs());

describe("database TLS trust", () => {
  it("requires certificate and hostname verification even when the URL requests a downgrade", async () => {
    const sql = postgres(remote.href, { ssl: databaseTls(remote, ca) });
    try {
      expect(sql.options.ssl).toMatchObject({
        rejectUnauthorized: true,
        checkServerIdentity,
        ca: ca.trim(),
      });
    } finally {
      await sql.end();
    }
  });

  it("uses normal system trust without a configured private root", () => {
    const options = databaseTls(remote, undefined);
    expect(options).toMatchObject({
      rejectUnauthorized: true,
      checkServerIdentity,
    });
    expect(options).not.toHaveProperty("ca");
  });

  it("accepts escaped newlines from an environment variable", () => {
    expect(databaseTls(remote, ca.replace(/\n/g, "\\n"))).toMatchObject({
      ca: ca.trim(),
    });
  });

  it.each([
    "",
    "not a certificate",
    "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
  ])("fails closed for malformed trust configuration %j", (pem) => {
    expect(() => databaseTls(remote, pem)).toThrow("valid PEM CA certificate");
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "keeps disposable loopback databases usable at %s",
    (host) => {
      expect(
        databaseTls(new URL(`postgresql://restricted@${host}/postgres`), ca),
      ).toBe(false);
    },
  );
});
