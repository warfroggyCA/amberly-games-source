import { normalizeOfficialWord } from "../../../lib/official-word";
import {
  lookupOfficialWordCached,
  LookupBusyError,
} from "../../../server/official-word-cache";
import { reportFailure } from "../../../server/diagnostics";

export const runtime = "nodejs";
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  let word: string;
  try {
    if (query.getAll("word").length !== 1) throw new Error("Enter one word.");
    word = normalizeOfficialWord(query.get("word"));
  } catch {
    return Response.json(
      { error: "Enter one word of 2 to 15 English letters." },
      { status: 400, headers },
    );
  }
  try {
    return Response.json(await lookupOfficialWordCached(word, request.signal), {
      headers,
    });
  } catch (error) {
    if (error instanceof LookupBusyError)
      return Response.json(
        { error: error.message },
        { status: 429, headers: { ...headers, "Retry-After": "60" } },
      );
    const incidentId = reportFailure("word-lookup", error);
    return Response.json(
      {
        error:
          "The official word check could not be completed. Your letters have been kept; please retry.",
      },
      { status: 502, headers: { ...headers, "X-Incident-Id": incidentId } },
    );
  }
}
