import { createAuthContext, type AuthContext } from "../../../../server/auth";
import { getUsageRepository } from "../../../../server/database";
import { configuredFamilyId } from "../../../../server/family-config";
import {
  repositoryFailure,
  HttpError,
  readMutationJson,
} from "../../../../server/shared-http";
import { usageCsv } from "../../../../lib/access-usage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, write: boolean) {
  let context: AuthContext | null = null;
  try {
    const input = write ? await readMutationJson(request, 1024) : null;
    context = createAuthContext(request);
    if (!context) throw new HttpError(503, "Family sign-in is not configured.");
    const user = await context.requireUser();
    if (request.headers.get("x-scrabble-user") !== user.id)
      throw new HttpError(
        401,
        "Your signed-in account changed. Reload before continuing.",
      );
    const actor = {
      userId: user.id,
      email: user.email,
      emailVerified: true as const,
    };
    const repo = getUsageRepository(),
      familyId = configuredFamilyId();
    if (write) return context.json(await repo.record(actor, familyId, input));
    const p = new URL(request.url).searchParams;
    const format = p.get("format");
    if (format && format !== "csv")
      throw new HttpError(400, "Choose a supported report format.");
    const report = await repo.report(
      actor,
      familyId,
      {
        from: p.get("from") ?? "",
        to: p.get("to") ?? "",
        actor: p.get("actor") ?? undefined,
        area: p.get("area") ?? undefined,
        kind: p.get("kind") ?? undefined,
        cursor: p.get("cursor") ?? undefined,
      },
      format === "csv",
    );
    if (format === "csv") {
      const headers = new Headers(context.json({}).headers);
      headers.set("Content-Type", "text/csv; charset=utf-8");
      headers.set(
        "Content-Disposition",
        'attachment; filename="amberly-access-usage.csv"',
      );
      return new Response(usageCsv(report.rows), { headers });
    }
    return context.json(report);
  } catch (error) {
    return repositoryFailure(error, context);
  }
}
export async function GET(request: Request) {
  return handle(request, false);
}
export async function POST(request: Request) {
  return handle(request, true);
}
