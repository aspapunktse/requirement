import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { canMarkFirstRound, visibleOrOwnedFrameworksWhere } from "@/lib/frameworks";

const bodySchema = z.object({ firstRound: z.boolean() });

/**
 * Marks (`firstRound: true`) or unmarks (`false`) one Control as first round for the Framework in the URL (#319,
 * PRD 0002 F-FO). Allowed for the Framework's owner, a Compliance Manager or an Admin; anyone else gets 403 and
 * nothing changes. Only a Control mapped, at any Coverage, to a Requirement of this Framework can be marked (409
 * otherwise, nothing written). Idempotent. Unmarking is always allowed. Not a Change Event, and it changes nothing
 * about Assessments, submission or compliance yet. A Draft Framework is a 404 for anyone who can't see Drafts.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/first-round-controls/[controlId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, controlId } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });

  const framework = await prisma.framework.findFirst({
    where: { id, ...visibleOrOwnedFrameworksWhere(auth.user) },
    select: { id: true, ownerId: true },
  });
  if (!framework) return NextResponse.json({ error: "Framework not found" }, { status: 404 });

  if (!canMarkFirstRound(auth.user, framework)) {
    return NextResponse.json(
      { error: "Only the Framework Owner, a Compliance Manager or an Admin can mark first-round Controls" },
      { status: 403 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    if (!parsed.data.firstRound) {
      await tx.frameworkFirstRoundControl.deleteMany({ where: { frameworkId: id, controlId } });
      return "ok" as const;
    }
    const control = await tx.control.findUnique({ where: { id: controlId }, select: { id: true } });
    if (!control) return "no-control" as const;
    // Lock the Control's mappings to this Framework for the rest of this transaction (FOR SHARE), so a concurrent
    // delete of them (mapping delete, Requirement delete cascade, loader deleteMany) waits until the marking is
    // committed. Each of those deletes runs `dropOrphanedFirstRoundMarkings` as a LATER statement of its own
    // transaction (READ COMMITTED), which then sees the committed marking and removes it. If the delete committed
    // first, no rows come back here and the marking is refused. A plain count would leave a window between the
    // check and the insert in which an orphan marking could be written.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT cm.id FROM "ControlMapping" cm
      JOIN "Requirement" r ON r.id = cm."requirementId"
      WHERE cm."controlId" = ${controlId} AND r."frameworkId" = ${id}
      FOR SHARE OF cm`;
    if (locked.length === 0) return "unmapped" as const;
    await tx.frameworkFirstRoundControl.upsert({
      where: { frameworkId_controlId: { frameworkId: id, controlId } },
      create: { frameworkId: id, controlId },
      update: {},
    });
    return "ok" as const;
  });

  if (result === "no-control") return NextResponse.json({ error: "Control not found" }, { status: 404 });
  if (result === "unmapped") {
    return NextResponse.json({ error: "Only a Control mapped to this Framework can be marked first round for it" }, { status: 409 });
  }
  return NextResponse.json({ frameworkId: id, controlId, firstRound: parsed.data.firstRound });
}
