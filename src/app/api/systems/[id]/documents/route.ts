import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { canEditSystemDocuments, listSystemDocuments } from "@/lib/system-documentation";

/**
 * The Document Requirements that apply to a System, each with its link and whether it is provided (#324, PRD 0002
 * F-DOC.2), and whether the acting user may edit them. Anyone who may see the System may read; a System that doesn't
 * exist or can't be seen is 404. Returns `{ documents, canEdit }`. Nothing here has a Track to filter by yet.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/documents">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  // One snapshot, so the owner and the rows agree.
  const result = await prisma.$transaction(
    async (tx) => {
      const system = await tx.system.findFirst({ where: { AND: [{ id }, await visibleSystemsWhere(auth.user, tx)] }, select: { id: true, ownerId: true } });
      if (!system) return null;
      return { documents: await listSystemDocuments(tx, system.id), canEdit: canEditSystemDocuments(auth.user, system) };
    },
    { isolationLevel: "RepeatableRead" },
  );
  if (!result) return NextResponse.json({ error: "System not found" }, { status: 404 });
  return NextResponse.json(result);
}
