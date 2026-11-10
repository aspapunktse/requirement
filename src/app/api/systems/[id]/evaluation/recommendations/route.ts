import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RecommendationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canDecideStep } from "@/lib/approvals";
import { lockSystem } from "@/lib/system-lock";
import { giveRecommendation } from "@/lib/evaluation-oag";
import { refuseIfSystemClosed } from "@/lib/system-closed";

const recommendationSchema = z.object({
  /** The participant the Recommendation is for: a Review Group id, or null for the base review. */
  reviewGroupId: z.string().min(1).nullable(),
  kind: z.nativeEnum(RecommendationKind),
  comment: z.string().trim().min(1).max(2000),
});

/**
 * Gives a group's Recommendation at the OAG review (#331, PRD 0002 F-OAG.1): `{ reviewGroupId | null, kind: RECOMMEND |
 * RECOMMEND_WITH_CONDITIONS | ADVISE_AGAINST, comment }`; conditions are free text in the comment. Who may (the Review Step rule: an Admin
 * any, a Reviewer the base review, a group's member its own, nobody on a System they own) is checked first, 403 before the rest of the
 * body or the System's stage is looked at. 409, nothing written, when the System isn't at the OAG review, the group isn't part of it or
 * already has a Recommendation. Moves the System to OG2 when this was the last open group.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/evaluation/recommendations">) {
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
  const { reviewGroupId } = participant.data;

  if (!(await canDecideStep(auth.user, system.ownerId, reviewGroupId))) {
    return NextResponse.json(
      { error: system.ownerId === auth.user.id ? "Nobody gives a Recommendation on a System they own" : "You can't give this Recommendation" },
      { status: 403 },
    );
  }

  const parsed = recommendationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "A Recommendation (Recommend, Recommend with conditions or Advise against) and a comment are required" }, { status: 400 });

  const result = await prisma.$transaction(
    async (tx) => {
      await lockSystem(tx, system.id);
      return giveRecommendation(tx, system.id, auth.user.id, parsed.data);
    },
    { timeout: 15_000 },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ recommendation: result.recommendation, closed: result.closed }, { status: 201 });
}
