import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { checkUpAccess, checkUpResponseErrorResponse, getCheckUpDetail } from "@/lib/check-up-responses";
import { checkUpEvaluationBodySchema, evaluateCheckUp } from "@/lib/check-up-evaluations";
import { readJson } from "@/lib/internal-audit-api";

/**
 * Evaluates an answered Check-up (F-IA.6, #156): an outcome (Conforming, Observation or
 * Nonconformity) and a comment, required for the last two. Only an Internal Auditor may call it;
 * every other role, the Admin and the Compliance Manager included, gets 403 with no DB change. 404
 * if there is no such Check-up, 409 if it is already evaluated (an evaluation is final), isn't
 * answered, or its audit isn't launched, 400 naming each problem if the evaluation is invalid.
 * Writes the evaluation and one System-less Change Event in one transaction; a Nonconformity also
 * opens a Risk linked to the Check-up and sets a Fulfilled target back to In Progress (#157), in
 * that same transaction. Answers 201 with the Check-up.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/check-ups/[id]/evaluation">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const parsed = checkUpEvaluationBodySchema.safeParse(await readJson(request));
  const { id } = await ctx.params;

  try {
    await evaluateCheckUp(id, auth.user, parsed.success ? parsed.data : null);
    const checkUp = await getCheckUpDetail(id);
    const access = checkUp && checkUpAccess(auth.user, checkUp);
    return NextResponse.json(
      { checkUp, canAnswer: access?.canAnswer ?? false, canEvaluate: access?.canEvaluate ?? false },
      { status: 201 },
    );
  } catch (error) {
    return checkUpResponseErrorResponse(error);
  }
}
