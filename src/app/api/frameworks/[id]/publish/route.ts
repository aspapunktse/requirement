import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { logChangeEvent } from "@/lib/change-events";
import { frameworkLabel } from "@/lib/framework-label";
import { onFrameworkPublished } from "@/lib/frameworks";

/**
 * Publishes a Draft Framework (Draft -> Published, one-way in v1: there is
 * no way back to Draft). Records a System-less FRAMEWORK_PUBLISHED Change
 * Event with the acting user as actor, then calls `onFrameworkPublished`, which
 * recomputes applicability for every System that already has the Framework in
 * scope (synchronously, so the Assessments are in place when the response
 * returns). See #73, #87, PRD 0001 F-FW.4-5.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/publish">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;

  const existing = await prisma.framework.findUnique({
    where: { id },
    include: { _count: { select: { requirements: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }
  if (existing.status === "PUBLISHED") {
    return NextResponse.json({ error: "This Framework is already Published" }, { status: 409 });
  }

  const framework = await prisma.$transaction(async (tx) => {
    // Guarded on the status so two concurrent publishes can't both log an event.
    const { count } = await tx.framework.updateMany({ where: { id, status: "DRAFT" }, data: { status: "PUBLISHED" } });
    if (count === 0) return null;
    await logChangeEvent(
      null,
      "FRAMEWORK_PUBLISHED",
      `Framework "${frameworkLabel(existing)}" published (${existing._count.requirements} Requirements)`,
      auth.user.id,
      tx,
    );
    return tx.framework.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { requirements: true } } },
    });
  });
  if (!framework) {
    return NextResponse.json({ error: "This Framework is already Published" }, { status: 409 });
  }

  await onFrameworkPublished(framework.id);
  return NextResponse.json({ framework });
}
