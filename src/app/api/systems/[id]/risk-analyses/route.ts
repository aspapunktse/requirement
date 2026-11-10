import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { prisma } from "@/lib/prisma";
import { getVisibleSystem } from "@/lib/system-visibility";
import {
  canRecordRiskAnalysis,
  createRiskAnalysisSchema,
  RISK_ANALYSIS_REFUSED,
  RISK_ANALYSIS_SELECT,
  toRiskAnalysisView,
} from "@/lib/risk-analysis";
import { RiskAnalysisInputError, raiseRisks, resolveLinks } from "@/lib/risk-analysis-write";
import { refuseIfSystemClosed } from "@/lib/system-closed";

/** A System's Risk Analyses, newest meeting first. Anyone who can see the System reads them. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risk-analyses">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  // One RepeatableRead snapshot: the nested participants and Risks are separate statements, and a concurrent edit mustn't mix states.
  const rows = await prisma.$transaction(
    async (tx) =>
      tx.riskAnalysis.findMany({
        where: { systemId: system.id },
        select: RISK_ANALYSIS_SELECT,
        orderBy: [{ heldOn: "desc" }, { createdAt: "desc" }],
      }),
    { isolationLevel: "RepeatableRead" },
  );
  return NextResponse.json({ riskAnalyses: rows.map(toRiskAnalysisView) });
}

/**
 * Records a Risk Analysis meeting (#325, PRD 0002 F-RA.2): `{ heldOn, notes?, participantIds?, outsiders?, reviewedRiskIds?, newRisks? }`.
 * A Risk Owner or an Admin who isn't the System's owner (403 otherwise, checked before the body is read and before any write; 404 for a
 * System they can't see). `newRisks` are logged on the System from the same form, ad hoc by the server's choice, each with its RISK_LOGGED
 * Change Event, in the one transaction with the analysis: a failure anywhere leaves nothing behind. A participant that isn't a User, or a
 * reviewed Risk that isn't on this System, is 400.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risk-analyses">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;
  if (!canRecordRiskAnalysis(auth.user, system)) return NextResponse.json({ error: RISK_ANALYSIS_REFUSED }, { status: 403 });

  const parsed = createRiskAnalysisSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Risk Analysis" }, { status: 400 });
  const { heldOn, notes, outsiders, newRisks } = parsed.data;

  try {
    const row = await prisma.$transaction(async (tx) => {
      const links = await resolveLinks(tx, system.id, parsed.data);
      const created = await tx.riskAnalysis.create({
        data: {
          systemId: system.id,
          heldOn: new Date(`${heldOn}T00:00:00.000Z`),
          notes,
          outsiders,
          recordedById: auth.user.id,
          participants: { connect: (links.participantIds ?? []).map((userId) => ({ id: userId })) },
          reviewedRisks: { connect: (links.reviewedRiskIds ?? []).map((riskId) => ({ id: riskId })) },
        },
        select: { id: true },
      });
      await raiseRisks(tx, { systemId: system.id, analysisId: created.id, actorId: auth.user.id, risks: newRisks });
      return tx.riskAnalysis.findUniqueOrThrow({ where: { id: created.id }, select: RISK_ANALYSIS_SELECT });
    });
    return NextResponse.json({ riskAnalysis: toRiskAnalysisView(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof RiskAnalysisInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
