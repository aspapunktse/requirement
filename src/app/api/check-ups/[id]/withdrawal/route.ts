import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { checkUpAccess, checkUpResponseErrorResponse, getCheckUpDetail } from "@/lib/check-up-responses";
import { checkUpWithdrawalBodySchema, withdrawCheckUp } from "@/lib/check-up-withdrawals";
import { readJson } from "@/lib/internal-audit-api";

/**
 * Withdraws a Check-up that has not been evaluated (F-IA.8, #158), with a required reason. Only an
 * Internal Auditor may call it; every other role, the Admin and the Compliance Manager included, gets
 * 403 with no DB change. 404 if there is no such Check-up, 409 if it is withdrawn already, evaluated,
 * or its audit isn't launched, 400 if the reason is missing or too long. Writes the withdrawal and
 * nothing else (no Change Event); the Check-up leaves the recipient's tasks and can't be answered or
 * evaluated any more. Answers 201 with the Check-up.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/check-ups/[id]/withdrawal">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const parsed = checkUpWithdrawalBodySchema.safeParse(await readJson(request));
  const { id } = await ctx.params;

  try {
    await withdrawCheckUp(id, auth.user, parsed.success ? parsed.data : null);
    const checkUp = await getCheckUpDetail(id);
    const access = checkUp && checkUpAccess(auth.user, checkUp);
    return NextResponse.json(
      { checkUp, canAnswer: access?.canAnswer ?? false, canEvaluate: access?.canEvaluate ?? false, canWithdraw: access?.canWithdraw ?? false },
      { status: 201 },
    );
  } catch (error) {
    return checkUpResponseErrorResponse(error);
  }
}
