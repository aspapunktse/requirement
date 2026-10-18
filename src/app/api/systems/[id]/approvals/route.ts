import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { ROLES_ALLOWED_TO_APPROVE } from "@/lib/approvals";
import { BASE_REVIEW_STEP_NAME, loadReviewRounds } from "@/lib/review-steps";
import { logChangeEvent } from "@/lib/change-events";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/approvals">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const { rounds, currentRoundId, steps } = await loadReviewRounds(system.id);
  return NextResponse.json({
    // Newest round first; a round's approvals are oldest first.
    rounds: rounds.map((round) => ({
      id: round.id,
      submittedAt: round.submittedAt,
      current: round.id === currentRoundId,
      approvals: round.approvals.map((approval) => ({
        id: approval.id,
        decision: approval.decision,
        comment: approval.comment,
        decidedAt: approval.decidedAt,
        reviewGroupId: approval.reviewGroupId,
        stepName: approval.reviewGroup?.name ?? BASE_REVIEW_STEP_NAME,
        approver: { id: approval.approver.id, name: approval.approver.name },
      })),
    })),
    // The current round's Review Steps, derived live; empty unless the System is In Review.
    steps,
  });
}

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().min(1),
});

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/approvals">) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_APPROVE]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (system.status !== "IN_REVIEW") {
    return NextResponse.json(
      { error: "Only a System In Review can receive an Approval decision" },
      { status: 400 },
    );
  }

  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A decision (Approved or Rejected) and comment are required" }, { status: 400 });
  }
  const { decision, comment } = parsed.data;

  // Today's endpoint records the decision against the current round's base Review Step
  // (reviewGroupId null) and moves the System as before, whatever group steps are open (#199 changes that).
  const approval = await prisma.$transaction(async (tx) => {
    // Moves the System out of In Review first, so two concurrent decisions can't both be recorded.
    const moved = await tx.system.updateMany({
      where: { id: system.id, status: "IN_REVIEW" },
      data: { status: decision === "APPROVED" ? "APPROVED" : "DRAFT" },
    });
    if (moved.count === 0) return null;

    // An In Review System with no round (it should not happen after the #198 migration) gets one.
    const round =
      (await tx.reviewRound.findFirst({
        where: { systemId: system.id },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      })) ?? (await tx.reviewRound.create({ data: { systemId: system.id } }));

    const created = await tx.approval.create({
      data: { systemId: system.id, reviewRoundId: round.id, reviewGroupId: null, approverId: auth.user.id, decision, comment },
      include: { approver: true },
    });
    await logChangeEvent(
      system.id,
      "APPROVAL_DECIDED",
      `${decision === "APPROVED" ? "Approved" : "Rejected"}: ${comment}`,
      auth.user.id,
      tx,
    );
    return created;
  });
  if (!approval) {
    return NextResponse.json(
      { error: "Only a System In Review can receive an Approval decision" },
      { status: 400 },
    );
  }

  return NextResponse.json({ approval }, { status: 201 });
}
