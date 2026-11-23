import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { logChangeEvent } from "@/lib/change-events";
import { NOT_FOUND_MESSAGE, RETIRED_REFUSAL } from "@/lib/compliance-boundary";
import { lockBoundary } from "@/lib/compliance-boundary-scope";
import {
  canWriteJustifications,
  describeJustificationChange,
  INCLUDED_REFUSAL,
  JUSTIFICATION_FORBIDDEN_MESSAGE,
  JUSTIFICATION_MAX_LENGTH,
  normalizeExclusionJustification,
  REQUIREMENT_NOT_FOUND_MESSAGE,
} from "@/lib/boundary-statement-rules";
import { isRequirementIncluded } from "@/lib/boundary-statement";

const bodySchema = z.object({ text: z.string().max(JUSTIFICATION_MAX_LENGTH, `The justification can be at most ${JUSTIFICATION_MAX_LENGTH} characters.`) });

/**
 * Write (or clear, with empty text) the exclusion justification of one Requirement in one Compliance Boundary's Statement of
 * Applicability (#420). The Boundary Owner, a Compliance Manager or an Admin; 403 for anyone else, 404 for an unknown Boundary or a
 * Requirement outside the Boundary's Frameworks, 409 on a retired Boundary or while the Requirement is included (a justification
 * explains an exclusion). Never changes a status. The Change Event (System-less, naming the Boundary) is written in the same
 * transaction.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]/statement/justifications/[requirementId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id, requirementId } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const text = normalizeExclusionJustification(parsed.data.text);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockBoundary(tx, id);
    const boundary = await tx.complianceBoundary.findUnique({
      where: { id },
      select: { id: true, name: true, retiredAt: true, boundaryOwnerId: true, frameworks: { select: { frameworkId: true } } },
    });
    if (!boundary) return { error: NOT_FOUND_MESSAGE, status: 404 };
    if (!canWriteJustifications(auth.user, boundary)) return { error: JUSTIFICATION_FORBIDDEN_MESSAGE, status: 403 };
    if (boundary.retiredAt) return { error: RETIRED_REFUSAL, status: 409 };
    const requirement = await tx.requirement.findFirst({
      where: { id: requirementId, frameworkId: { in: boundary.frameworks.map((f) => f.frameworkId) } },
      select: { id: true, code: true, frameworkId: true, framework: { select: { name: true } } },
    });
    if (!requirement) return { error: REQUIREMENT_NOT_FOUND_MESSAGE, status: 404 };

    if (text !== null && (await isRequirementIncluded(tx, id, requirement.frameworkId, requirement.id))) return { error: INCLUDED_REFUSAL, status: 409 };

    const existing = await tx.boundaryExclusionJustification.findUnique({
      where: { boundaryId_requirementId: { boundaryId: id, requirementId } },
      select: { text: true },
    });
    const before = existing?.text ?? null;
    if (before === text) return { justification: text };
    if (text === null) {
      await tx.boundaryExclusionJustification.delete({ where: { boundaryId_requirementId: { boundaryId: id, requirementId } } });
    } else {
      await tx.boundaryExclusionJustification.upsert({
        where: { boundaryId_requirementId: { boundaryId: id, requirementId } },
        create: { boundaryId: id, requirementId, text, updatedById: auth.user.id },
        update: { text, updatedById: auth.user.id },
      });
    }
    await logChangeEvent(null, "SOA_JUSTIFICATION_CHANGED", describeJustificationChange(boundary.name, requirement.framework.name, requirement.code, before, text), auth.user.id, tx);
    return { justification: text };
  });

  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(outcome);
}
