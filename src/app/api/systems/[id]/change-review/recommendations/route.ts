import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RecommendationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canDecideStep } from "@/lib/approvals";
import { lockSystem } from "@/lib/system-lock";
import { giveChangeReviewRecommendation } from "@/lib/change-review";
import { refuseIfSystemClosed } from "@/lib/system-closed";

const recommendationSchema = z.object({
  /** The Change Review the form was shown for; refused (409) if another one is open by now. */
  changeReviewId: z.string().min(1),
  /** The participant the Recommendation is for: a Review Group id, or null for the base review. */
  reviewGroupId: z.string().min(1).nullable(),
  kind: z.nativeEnum(RecommendationKind),
  comment: z.string().trim().min(1).max(2000),
});

/**
 * Gives a group's Recommendation on the System's open Change Review (#334, PRD 0002 F-CR.1): `{ changeReviewId, reviewGroupId | null,
 * kind, comment }`. Who may (the Review Step rule: an Admin any, a Reviewer the base review, a group's member its own, nobody on a System
 * they own) is checked first, 403 before the rest of the body or the review is looked at. 409, nothing written, when the review named
 * isn't the open one, the group has no Controls in it or already has a Recommendation.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/change-review/recommendations">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const body = await request.json().catch(() => null);
  const participant = recommendationSchema.pick({ reviewGroupId: true }).safeParse(body ?? {});
  if (!participant.success) return NextResponse.json({ error: "reviewGroupId must be a Review Group id or null" }, { status: 400 });

  if (!(await canDecideStep(auth.user, system.ownerId, participant.data.reviewGroupId))) {
    return NextResponse.json(
      { error: system.ownerId === auth.user.id ? "Nobody gives a Recommendation on a System they own" : "You can't give this Recommendation" },
      { status: 403 },
    );
  }

  const parsed = recommendationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "The Change Review (changeReviewId), a Recommendation (Recommend, Recommend with conditions or Advise against) and a comment are required" }, { status: 400 });

  const result = await prisma.$transaction(
    async (tx) => {
      await lockSystem(tx, system.id);
      return giveChangeReviewRecommendation(tx, system.id, auth.user.id, parsed.data);
    },
    { timeout: 15_000 },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ recommendation: result.recommendation }, { status: 201 });
}
