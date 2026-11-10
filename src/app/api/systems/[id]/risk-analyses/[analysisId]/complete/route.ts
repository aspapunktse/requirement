import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { advanceAfterRiskAnalysis } from "@/lib/evaluation";
import { getVisibleSystem } from "@/lib/system-visibility";
import { refuseIfSystemClosed } from "@/lib/system-closed";
import {
  ANALYSIS_ALREADY_COMPLETED,
  canRecordRiskAnalysis,
  findRisksBlockingCompletion,
  ownerlessRisksMessage,
  RISK_ANALYSIS_REFUSED,
  RISK_ANALYSIS_SELECT,
  riskAnalysisCompletedDetail,
  toRiskAnalysisView,
} from "@/lib/risk-analysis";

/**
 * Completes a Risk Analysis (#325, PRD 0002 F-RA.3). Same people as recording one (403 otherwise, nothing changed). Refused with 409, naming
 * the Risks, while any open or accepted Risk on the System has no owner; 409 too when it is already completed. The analysis row is locked and both
 * conditions are checked under the lock, then the analysis is completed and its `RISK_ANALYSIS_COMPLETED` Change Event written in the
 * same transaction. Once completed it is read-only.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risk-analyses/[analysisId]/complete">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, analysisId } = await ctx.params;
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (!canRecordRiskAnalysis(auth.user, system)) return NextResponse.json({ error: RISK_ANALYSIS_REFUSED }, { status: 403 });

  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ completedAt: Date | null }[]>`
      SELECT "completedAt" FROM "RiskAnalysis" WHERE "id" = ${analysisId} AND "systemId" = ${system.id} FOR UPDATE`;
    if (locked.length === 0) return { status: "missing" as const };
    if (locked[0].completedAt !== null) return { status: "completed" as const };

    const ownerless = await findRisksBlockingCompletion(tx, system.id);
    if (ownerless.length > 0) return { status: "ownerless" as const, ownerless };

    const done = await tx.riskAnalysis.update({
      where: { id: analysisId },
      data: { completedAt: new Date(), completedById: auth.user.id },
      select: { heldOn: true, _count: { select: { reviewedRisks: true, raisedRisks: true } } },
    });
    await logChangeEvent(
      system.id,
      "RISK_ANALYSIS_COMPLETED",
      riskAnalysisCompletedDetail({ heldOn: done.heldOn, reviewed: done._count.reviewedRisks, raised: done._count.raisedRisks }),
      auth.user.id,
      tx,
    );
    // A System waiting for this analysis at the Risk Analysis stage moves on, in the same transaction.
    await advanceAfterRiskAnalysis(tx, system.id, auth.user.id);
    return { status: "done" as const, row: await tx.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId }, select: RISK_ANALYSIS_SELECT }) };
  });

  if (outcome.status === "missing") return NextResponse.json({ error: "Risk Analysis not found" }, { status: 404 });
  if (outcome.status === "completed") return NextResponse.json({ error: ANALYSIS_ALREADY_COMPLETED }, { status: 409 });
  if (outcome.status === "ownerless") {
    return NextResponse.json({ error: ownerlessRisksMessage(outcome.ownerless), risks: outcome.ownerless }, { status: 409 });
  }
  return NextResponse.json({ riskAnalysis: toRiskAnalysisView(outcome.row) });
}
