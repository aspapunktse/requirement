import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { closedRefusalText } from "@/lib/system-closed";
import { ALREADY_MEMBER_REFUSAL, canManageBoundaryMembers, MEMBERS_PREVIEW_FORBIDDEN_MESSAGE, NOT_FOUND_MESSAGE, RETIRED_REFUSAL } from "@/lib/compliance-boundary";
import { previewJoin } from "@/lib/compliance-boundary-data";

const paramsSchema = z.object({ id: z.string().min(1), systemId: z.string().min(1) });

/**
 * The join preview (#423): what adding the System to the Compliance Boundary would bring, without writing anything. Only those who
 * may add Systems see it (the Boundary's own Boundary Owner, a Compliance Manager or an Admin; the object-level check is part of
 * it). The Controls come from the applicability code the join itself recomputes with. One RepeatableRead transaction, reads only.
 * A closed System, or one that is already a member, is refused with 409 like the add itself.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]/systems/[systemId]/preview">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return NextResponse.json({ error: "Choose a System from the list." }, { status: 400 });
  const { id, systemId } = params.data;

  const outcome = await prisma.$transaction(async (tx) => {
    const boundary = await tx.complianceBoundary.findUnique({ where: { id }, select: { boundaryOwnerId: true, retiredAt: true } });
    if (!boundary) return { error: NOT_FOUND_MESSAGE, status: 404 };
    if (!canManageBoundaryMembers(auth.user, boundary)) return { error: MEMBERS_PREVIEW_FORBIDDEN_MESSAGE, status: 403 };
    if (boundary.retiredAt) return { error: RETIRED_REFUSAL, status: 409 };
    const system = await tx.system.findUnique({ where: { id: systemId }, select: { status: true, evaluationClosedAt: true } });
    if (!system) return { error: "System not found.", status: 404 };
    if (system.evaluationClosedAt) return { error: closedRefusalText(system.status), status: 409 };
    const already = await tx.complianceBoundarySystem.findUnique({ where: { boundaryId_systemId: { boundaryId: id, systemId } }, select: { id: true } });
    if (already) return { error: ALREADY_MEMBER_REFUSAL, status: 409 };
    const preview = await previewJoin(id, systemId, tx);
    return preview ? { preview } : { error: NOT_FOUND_MESSAGE, status: 404 };
  }, READ_SNAPSHOT);

  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ preview: outcome.preview });
}
