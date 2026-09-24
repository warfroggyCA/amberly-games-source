import { SharedRepositoryError } from "./shared-repository";
import { NextResponse } from "next/server";
import { reportFailure } from "./diagnostics";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function getAppOrigin(): string {
  try {
    const value = process.env.SCRABBLE_APP_ORIGIN;
    if (!value) throw new Error();
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new HttpError(503, "Family sign-in is not configured yet.");
  }
}

export function privateJson(
  data: unknown,
  status = 200,
  headers?: HeadersInit,
): NextResponse {
  const response = NextResponse.json(data, { status, headers });
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Vary", "Cookie");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function errorJson(
  error: unknown,
  context?: { json: (data: unknown, status?: number) => NextResponse } | null,
): NextResponse {
  const safe =
    error instanceof HttpError
      ? error
      : new HttpError(503, "The family service is unavailable. Please retry.");
  const response = (context?.json ?? privateJson)(
    { error: safe.message },
    safe.status,
  );
  if (safe.status >= 500)
    response.headers.set("X-Incident-Id", reportFailure("family", error));
  return response;
}

export async function readMutationJson(
  request: Request,
  maxBytes = 16_384,
): Promise<unknown> {
  const origin = getAppOrigin();
  if (
    request.headers.get("origin") !== origin ||
    ["cross-site", "same-site"].includes(
      request.headers.get("sec-fetch-site") ?? "",
    )
  ) {
    throw new HttpError(403, "Open this page from the family app to continue.");
  }
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    throw new HttpError(415, "Send this request as JSON.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new HttpError(413, "This request is too large.");
  }
  if (!request.body) throw new HttpError(400, "This request is incomplete.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(408, "The request timed out. Please retry."));
      void reader.cancel().catch(() => {});
    }, 10_000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, "This request is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "This request contains invalid JSON.");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "This request is incomplete.");
  }
  return value as Record<string, unknown>;
}

/** Keep repository error codes while reporting server failures without private data. */
export function repositoryFailure(
  error: unknown,
  context?: { json: (data: unknown, status?: number) => NextResponse } | null,
): NextResponse {
  if (!(error instanceof SharedRepositoryError))
    return errorJson(error, context);
  const response = (context?.json ?? privateJson)(
    { error: error.message, code: error.code },
    error.status,
  );
  if (error.status >= 500)
    response.headers.set("X-Incident-Id", reportFailure("family", error));
  return response;
}
