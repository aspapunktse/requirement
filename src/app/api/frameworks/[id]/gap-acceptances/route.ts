import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { isCovered } from "@/lib/coverage-state";

const acceptGapsSchema = z.object({
  requirementIds: z
    .array(z.string().min(1))
    .min(1)
    .max(2000)
    .refine((ids) => new Set(ids).size === ids.length, { message: "requirementIds must be unique" }),
  justification: z.string().trim().min(1),
});

/** Thrown inside the transaction to roll it back; the caller turns it into the 409. */
class NotOpenGapError extends Error {}

const NOT_OPEN_GAP = "Only an open Coverage Gap can be accepted: one of these Requirements is covered or already accepted";

/**
 * Accepts several open Coverage Gaps of one Framework at once, with one justification, all or nothing (#269).
 * The same rules as the single `PUT .../requirements/[requirementId]/gap-acceptance` (Compliance Manager /
 * Admin; who and when are stamped from the acting user; acceptance is not a Change Event), and stricter in one
 * way: every Requirement must be an *open* gap. A Requirement that is not in this Framework is a 404; one that
 * is covered or already accepted is a 409. In both cases nothing is written.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/gap-acceptances">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = acceptGapsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "requirementIds (one or more, no duplicates) and a justification are required to accept gaps" },
      { status: 400 },
    );
  }
  const { requirementIds, justification } = parsed.data;

  try {
    const accepted = await prisma.$transaction(async (tx) => {
      const requirements = await tx.requirement.findMany({
        where: { id: { in: requirementIds }, frameworkId: id },
        select: { id: true, gapAcceptedAt: true, mappings: { select: { coverage: true } } },
      });
      if (requirements.length !== requirementIds.length) return "NOT_FOUND" as const;
      if (requirements.some((requirement) => isCovered(requirement.mappings) || requirement.gapAcceptedAt)) {
        throw new NotOpenGapError();
      }
      // The same test again as part of the write, so a Full mapping added since the read above can't be accepted over.
      const result = await tx.requirement.updateMany({
        where: { id: { in: requirementIds }, frameworkId: id, gapAcceptedAt: null, mappings: { none: { coverage: "FULL" } } },
        data: { gapAcceptedAt: new Date(), gapAcceptedById: auth.user.id, gapJustification: justification },
      });
      if (result.count !== requirementIds.length) throw new NotOpenGapError();
      return result.count;
    });
    if (accepted === "NOT_FOUND") {
      return NextResponse.json({ error: "Requirement not found in this Framework" }, { status: 404 });
    }
    return NextResponse.json({ accepted });
  } catch (error) {
    if (error instanceof NotOpenGapError) {
      return NextResponse.json({ error: NOT_OPEN_GAP }, { status: 409 });
    }
    throw error;
  }
}
