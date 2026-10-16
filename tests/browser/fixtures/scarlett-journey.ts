import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_PIECE_COLOURS } from "../../../src/domain/crokinole";

export interface ScarlettTransfer {
  phase: string;
  path: string;
  status: number;
  bodyBytes: number;
  cacheControl: string | null;
  conditional: boolean;
  completed: boolean;
}

// Playwright routing disables HTTP caching. Serve synthetic APIs in a local
// pass-through proxy instead, preserving Next's asset headers and 304 responses.
// No API request is forwarded to the application or an external service.
export async function startScarlettJourneyFixture(upstream: string) {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "player@example.test",
  };
  const familyId = "22222222-2222-4222-8222-222222222222";
  const member = {
    userId: user.id,
    email: user.email,
    role: "superadmin",
    active: true,
    playerId: "player",
  };
  const fixtures: Record<string, unknown> = {
    "/api/auth/session": { configured: true, signInMethod: "google", user },
    "/api/family": {
      family: { id: familyId, name: "Synthetic family" },
      member,
      members: [member],
      invitations: [],
      players: [{ id: "player", name: "Player" }],
      playerAccess: {},
      games: [],
      gameAccess: {},
      verifiedWords: [],
      nextCursor: null,
    },
    "/api/family/crokinole": {
      games: [],
      access: {},
      palette: {
        revision: 0,
        colours: DEFAULT_PIECE_COLOURS,
        defaults: {
          playerCount: 2,
          format: "singles",
          scoringMode: "cumulative_round_totals",
          endCondition: { type: "fixed_rounds", rounds: 4 },
        },
      },
      nextCursor: null,
      creationEnabled: true,
      draft: null,
    },
    "/api/family/gym": {
      identity: { familyId, userId: user.id, playerId: "player" },
      sessions: [],
      nextCursor: null,
    },
    "/api/family/words": { words: [] },
    "/api/family/usage": { recorded: true },
  };
  let phase = "family-cold";
  const transfers: ScarlettTransfer[] = [];
  const unexpectedApiRequests: string[] = [];
  const server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url!, upstream);
    if (url.pathname.startsWith("/api/")) {
      const fixture = fixtures[url.pathname];
      const accepted =
        fixture !== undefined &&
        (incoming.method === "GET" ||
          (incoming.method === "POST" && url.pathname === "/api/family/usage"));
      if (!accepted)
        unexpectedApiRequests.push(`${incoming.method} ${url.pathname}`);
      outgoing.writeHead(accepted ? 200 : 501, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      outgoing.end(
        JSON.stringify(accepted ? fixture : { error: "Not mocked" }),
      );
      return;
    }
    const startedPhase = phase;
    const forward = request(
      url,
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: url.host },
      },
      (response) => {
        const transfer = url.pathname.includes("scarlett")
          ? {
              phase: startedPhase,
              path: url.pathname,
              status: response.statusCode!,
              bodyBytes: 0,
              cacheControl: response.headers["cache-control"] ?? null,
              conditional: !!(
                incoming.headers["if-none-match"] ||
                incoming.headers["if-modified-since"]
              ),
              completed: false,
            }
          : null;
        if (transfer) {
          // Retain partial/aborted responses too; do not omit their body bytes
          // merely because a source changes before the response finishes.
          transfers.push(transfer);
          response.on("data", (chunk: Buffer) => {
            transfer.bodyBytes += chunk.length;
          });
          response.on("end", () => {
            transfer.completed = true;
          });
        }
        outgoing.writeHead(response.statusCode!, response.headers);
        response.pipe(outgoing);
      },
    );
    forward.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    outgoing.on("close", () => forward.destroy());
    incoming.pipe(forward);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    transfers,
    unexpectedApiRequests,
    setPhase: (value: string) => {
      phase = value;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
