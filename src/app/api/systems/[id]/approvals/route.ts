import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canDecideStep, deciderVisibilityFor, memberGroupIds, userCanDecideStep } from "@/lib/approvals";
import {
  BASE_REVIEW_STEP_NAME,
  loadReviewRounds,
  lockSystem,
  settleReviewSteps,
} from "@/lib/review-steps";
import { logChangeEvent } from "@/lib/change-events";

/**
 * An Approval as a client sees it: attributed to its step (the group, or "Base review"). The deciding
 * User (`approver`) is present only when the viewer may see it (CONTEXT.md, "A step decides as its
 * group"); otherwise the key is absent, never blank.
 */
function approvalView(
  approval: {
    id: string;
    decision: string;
    comment: string | null;
    decidedAt: Date;
    voidedAt: Date | null;
    voidReason: string | null;
    reviewGroupId: string | null;
    reviewGroup: { name: string } | null;
    approver: { id: string; name: string };
  },
  canSeeDecider: boolean,
) {
  return {
    id: approval.id,
    decision: approval.decision,
    comment: approval.comment,
    decidedAt: approval.decidedAt,
    voided: approval.voidedAt !== null,
    // Why a voided decision no longer counts when an edit reopened its step ("A.5.1 changed after
    // approval", #200); null for a dropped step's. It names a Control, not a person, so it isn't redacted.
    voidReason: approval.voidReason,
    voidedAt: approval.voidedAt,
    reviewGroupId: approval.reviewGroupId,
    stepName: approval.reviewGroup?.name ?? BASE_REVIEW_STEP_NAME,
    ...(canSeeDecider ? { approver: { id: approval.approver.id, name: approval.approver.name } } : {}),
  };
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/approvals">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const { rounds, currentRoundId, steps } = await loadReviewRounds(system.id);
  const canSeeDecider = await deciderVisibilityFor(auth.user, system.ownerId);
  const groups = await memberGroupIds(auth.user.id);
  return NextResponse.json({
    // Newest round first; a round's approvals are oldest first.
    rounds: rounds.map((round) => ({
      id: round.id,
      submittedAt: round.submittedAt,
      current: round.id === currentRoundId,
      approvals: round.approvals.map((approval) => approvalView(approval, canSeeDecider(approval))),
    })),
    // The current round's Review Steps, derived live; empty unless the System is In Review.
    // `canDecide`: whether the viewer may decide that step right now (it is open and theirs to decide).
    steps: steps.map((step) => ({
      ...step,
      canDecide: step.status === "OPEN" && userCanDecideStep(auth.user, system.ownerId, groups, step.reviewGroupId),
    })),
  });
}

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().min(1),
  // The Review Step decided: a Review Group's id, or null (the default) for the base Review Step.
  reviewGroupId: z.string().min(1).nullable().default(null),
});

const NOT_IN_REVIEW = "Only a System In Review can receive an Approval decision";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/approvals">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  // Which step is read first so that a refusal for who is asking (403) comes before one for the rest of the body.
  const body = await request.json().catch(() => null);
  const step = decisionSchema.pick({ reviewGroupId: true }).safeParse(body ?? {});
  if (!step.success) {
    return NextResponse.json({ error: "reviewGroupId must be a Review Group id or null" }, { status: 400 });
  }
  const { reviewGroupId } = step.data;

  // Who decides which step (all of it before any write).
  if (!(await canDecideStep(auth.user, system.ownerId, reviewGroupId))) {
    return NextResponse.json(
      {
        error:
          system.ownerId === auth.user.id
            ? "Nobody decides a Review Step on a System they own"
            : "You can't decide this Review Step",
      },
      { status: 403 },
    );
  }

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A decision (Approved or Rejected) and comment are required" }, { status: 400 });
  }
  const { decision, comment } = parsed.data;

  if (system.status !== "IN_REVIEW") {
    return NextResponse.json({ error: NOT_IN_REVIEW }, { status: 400 });
  }

  // One transaction under a lock on the System row: two concurrent decisions on different steps run
  // one after the other, so exactly one of them sees "every step approved" and moves the System, and a
  // decision that arrives after a rejection finds the System in Draft and records nothing.
  const result = await prisma.$transaction(async (tx) => {
    await lockSystem(tx, system.id);
    // Drops (and voids) steps that disappeared and may already approve the System; see settleReviewSteps.
    const settled = await settleReviewSteps(tx, system.id);
    if (settled.status !== "IN_REVIEW" || !settled.current) return { error: NOT_IN_REVIEW, status: 400 };

    // An In Review System with no round (it should not happen after the #198 migration) gets one.
    const round =
      settled.current.round ?? (await tx.reviewRound.create({ data: { systemId: system.id } }));
    const step = settled.current.steps.find((candidate) => candidate.reviewGroupId === reviewGroupId);
    if (!step) {
      return { error: "That Review Step isn't part of the current Review Round", status: 409 };
    }
    if (step.status !== "OPEN") {
      return { error: "That Review Step has already been decided in the current Review Round", status: 409 };
    }

    const created = await tx.approval.create({
      data: { systemId: system.id, reviewRoundId: round.id, reviewGroupId, approverId: auth.user.id, decision, comment },
      include: { approver: { select: { id: true, name: true } }, reviewGroup: { select: { name: true } } },
    });
    // The detail names the step, not the person; the deciding User is the event's actor.
    await logChangeEvent(
      system.id,
      "APPROVAL_DECIDED",
      `${step.name}: ${decision === "APPROVED" ? "Approved" : "Rejected"}: ${comment}`,
      auth.user.id,
      tx,
    );

    // A rejection ends the round at once: the System returns to Draft and the other open steps are
    // cancelled (they simply stay undecided in a round that is no longer current). An approval moves
    // the System only when no other step is left to decide.
    const everyOtherApproved = settled.current.steps.every((other) => other === step || other.status === "APPROVED");
    if (decision === "REJECTED") {
      await tx.system.update({ where: { id: system.id }, data: { status: "DRAFT" } });
    } else if (everyOtherApproved) {
      await tx.system.update({ where: { id: system.id }, data: { status: "APPROVED" } });
    }
    return { approval: created, status: 201 };
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const canSeeDecider = await deciderVisibilityFor(auth.user, system.ownerId);
  return NextResponse.json(
    { approval: approvalView(result.approval, canSeeDecider(result.approval)) },
    { status: 201 },
  );
}
