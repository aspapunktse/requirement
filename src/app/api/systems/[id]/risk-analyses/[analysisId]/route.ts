import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { prisma } from "@/lib/prisma";
import { getVisibleSystem } from "@/lib/system-visibility";
import {
  ANALYSIS_ALREADY_COMPLETED,
  canRecordRiskAnalysis,
  RISK_ANALYSIS_REFUSED,
  RISK_ANALYSIS_SELECT,
  toRiskAnalysisView,
  updateRiskAnalysisSchema,
} from "@/lib/risk-analysis";
import { RiskAnalysisInputError, raiseRisks, resolveLinks } from "@/lib/risk-analysis-write";
import { refuseIfSystemClosed } from "@/lib/system-closed";

const NOT_FOUND = { error: "Risk Analysis not found" };

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risk-analyses/[analysisId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, analysisId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  // One RepeatableRead snapshot, so a concurrent edit can't mix before and after state across the nested reads.
  const row = await prisma.$transaction(
    async (tx) => tx.riskAnalysis.findFirst({ where: { id: analysisId, systemId: system.id }, select: RISK_ANALYSIS_SELECT }),
    { isolationLevel: "RepeatableRead" },
  );
  if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });
  return NextResponse.json({ riskAnalysis: toRiskAnalysisView(row) });
}

/**
 * Edits a Risk Analysis that isn't completed (#325): any of `heldOn`, `notes`, `participantIds`, `outsiders`, `reviewedRiskIds` (each replaces
 * what was there) and `newRisks` (logged now, in addition to those already raised). Same people as recording one: 403 for anyone else, checked
 * before the body is read, and nothing changes. The analysis row is locked and "not completed" is checked again under the lock, so an edit and
 * a completion can't both win: the loser gets 409.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risk-analyses/[analysisId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, analysisId } = await ctx.params;
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (!canRecordRiskAnalysis(auth.user, system)) return NextResponse.json({ error: RISK_ANALYSIS_REFUSED }, { status: 403 });

  const parsed = updateRiskAnalysisSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Risk Analysis" }, { status: 400 });
  const { heldOn, notes, outsiders, newRisks } = parsed.data;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ completedAt: Date | null }[]>`
        SELECT "completedAt" FROM "RiskAnalysis" WHERE "id" = ${analysisId} AND "systemId" = ${system.id} FOR UPDATE`;
      if (locked.length === 0) return { status: "missing" as const };
      if (locked[0].completedAt !== null) return { status: "completed" as const };

      const links = await resolveLinks(tx, system.id, parsed.data);
      await tx.riskAnalysis.update({
        where: { id: analysisId },
        data: {
          ...(heldOn !== undefined && { heldOn: new Date(`${heldOn}T00:00:00.000Z`) }),
          ...(notes !== undefined && { notes }),
          ...(outsiders !== undefined && { outsiders }),
          ...(links.participantIds && { participants: { set: links.participantIds.map((userId) => ({ id: userId })) } }),
          ...(links.reviewedRiskIds && { reviewedRisks: { set: links.reviewedRiskIds.map((riskId) => ({ id: riskId })) } }),
        },
      });
      await raiseRisks(tx, { systemId: system.id, analysisId, actorId: auth.user.id, risks: newRisks ?? [] });
      return { status: "updated" as const, row: await tx.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId }, select: RISK_ANALYSIS_SELECT }) };
    });
    if (outcome.status === "missing") return NextResponse.json(NOT_FOUND, { status: 404 });
    if (outcome.status === "completed") return NextResponse.json({ error: ANALYSIS_ALREADY_COMPLETED }, { status: 409 });
    return NextResponse.json({ riskAnalysis: toRiskAnalysisView(outcome.row) });
  } catch (error) {
    if (error instanceof RiskAnalysisInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
