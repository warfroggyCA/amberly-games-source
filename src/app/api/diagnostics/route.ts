import { privateJson, readMutationJson } from "../../../server/shared-http";
import { reportFailure } from "../../../server/diagnostics";
export const runtime = "nodejs";
let windowStarted = 0;
let count = 0;
export async function POST(request: Request) {
  try {
    const data = await readMutationJson(request, 128);
    if (JSON.stringify(data) !== '{"event":"browser-failure"}')
      return privateJson({ error: "Invalid report" }, 400);
    const now = Date.now();
    if (now - windowStarted >= 60_000) {
      windowStarted = now;
      count = 0;
    }
    if (count >= 30) return privateJson({ error: "Try later" }, 429);
    count += 1;
    return privateJson({ incidentId: reportFailure("browser") }, 202);
  } catch {
    return privateJson({ error: "Report unavailable" }, 400);
  }
}
