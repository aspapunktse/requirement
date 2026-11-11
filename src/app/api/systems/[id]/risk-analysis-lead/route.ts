import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { canRecordRiskAnalysis } from "@/lib/risk-analysis";
import { changeRiskAnalysisLead, effectiveRiskAnalysisLead, listRiskAnalysisLeadCandidates } from "@/lib/risk-analysis-lead";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";

const bodySchema = z.object({ leadId: z.string().min(1).nullable() });

/**
 * A System's Risk Analysis lead (#361), for anyone who can see the System: `{ staged, lead, canChange, candidates }`. `lead` is the
 * stored one (null when none is named; `eligible` false when it no longer counts), `candidates` (the eligible Users) are listed only for
 * someone who may change it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risk-analysis-lead">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  // One RepeatableRead snapshot: visibility, the System and the candidates agree, and a System deleted meanwhile is a 404.
  const read = await prisma.$transaction(
    async (tx) => {
      const system = await tx.system.findFirst({
        where: { AND: [{ id }, await visibleSystemsWhere(auth.user, tx)] },
        select: { ownerId: true, evaluationStage: true, riskAnalysisLead: { select: { id: true, name: true, role: true } } },
      });
      if (!system) return null;
      const canChange = system.evaluationStage !== null && canRecordRiskAnalysis(auth.user, system);
      return { system, canChange, candidates: canChange ? await listRiskAnalysisLeadCandidates(system, tx) : [] };
    },
    { isolationLevel: "RepeatableRead" },
  );
  if (!read) return NextResponse.json({ error: "System not found" }, { status: 404 });
  const { system, canChange, candidates } = read;
  return NextResponse.json({
    staged: system.evaluationStage !== null,
    lead: system.riskAnalysisLead
      ? { id: system.riskAnalysisLead.id, name: system.riskAnalysisLead.name, eligible: effectiveRiskAnalysisLead(system) !== null }
      : null,
    canChange,
    candidates,
  });
}

/**
 * Name, change or clear a System's Risk Analysis lead. Body `{ leadId: string | null }`. A Risk Owner, a Risk Facilitator or an Admin who is not
 * the System's owner (403 otherwise; 404 for a System they cannot see); 400 for a bad body, an unknown or ineligible User, or a System with no
 * stage; 409 for a closed System. A refusal changes nothing. One Change Event when the value really changes.
 * Returns `{ changed, lead }`.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risk-analysis-lead">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "leadId must be a user id or null" }, { status: 400 });
  const result = await changeRiskAnalysisLead(auth.user, id, parsed.data.leadId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ changed: result.changed, lead: result.lead });
}
