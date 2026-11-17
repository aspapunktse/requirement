import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-authz";
import { reopenCommentSchema, reopenNotSelected } from "@/lib/not-selected";

const bodySchema = z.object({ comment: reopenCommentSchema }).strict();

/**
 * Reopens a System closed as Not selected (#376, ADR 0015). Body `{ comment }`, required. An Admin only (403 for anyone else, 401 with no
 * acting user); 400 for a bad body; 404 for an unknown System; 409 when the System is not Not selected (a Rejected one is final). The System
 * returns to Draft at the stage it was in, with its Assessments, Risks and documents as they were; one Change Event; Continuous Compliance
 * recomputes its applicable Controls. A refusal changes nothing. This is the one write route on a System that works on a closed one, so it
 * does not call `refuseIfSystemClosed`. Returns `{ reopened: true, status: "DRAFT" }`.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/reopen">) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A comment is required", issues: parsed.error.issues }, { status: 400 });
  const result = await reopenNotSelected(auth.user, id, parsed.data.comment);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ reopened: true, status: result.status });
}
