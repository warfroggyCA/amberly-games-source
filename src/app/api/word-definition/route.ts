import { normalizeOfficialWord } from "../../../lib/official-word";
import { lookupLocalDefinition } from "../../../lib/word-definition-server";

export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, max-age=86400",
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
      { status: 400, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
  try {
    return Response.json(await lookupLocalDefinition(word), { headers });
  } catch {
    return Response.json(
      { error: "The local definition could not be loaded." },
      { status: 503, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}
