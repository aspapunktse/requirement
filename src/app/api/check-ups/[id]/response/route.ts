import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import {
  checkUpAccess,
  checkUpResponseBodySchema,
  checkUpResponseErrorResponse,
  getCheckUpDetail,
  submitCheckUpResponse,
} from "@/lib/check-up-responses";
import { readJson } from "@/lib/internal-audit-api";

/**
 * Creates or replaces a Check-up's response (F-IA.4, #155): the answer to each question (Yes / No /
 * N/A with a description) and the evidence links, written in one transaction. Only the Check-up's
 * recipient (whoever owns the target now) may call it: anyone else, an Admin included, gets 403 with
 * no DB change. 404 if there is no such Check-up, 409 if its audit isn't launched, 400 naming each
 * problem if the submission is invalid. Changes no status, opens no Risk, writes no Change Event.
 * Answers 201 with the Check-up when it creates the response, 200 when it replaces it.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/check-ups/[id]/response">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const parsed = checkUpResponseBodySchema.safeParse(await readJson(request));
  const { id } = await ctx.params;

  try {
    const result = await submitCheckUpResponse(id, auth.user, parsed.success ? parsed.data : null);
    const checkUp = await getCheckUpDetail(id);
    const access = checkUp && checkUpAccess(auth.user, checkUp);
    return NextResponse.json({ checkUp, canAnswer: access?.canAnswer ?? false }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return checkUpResponseErrorResponse(error);
  }
}
