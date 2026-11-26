import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { assessmentEditAccess } from "@/lib/system-permissions";
import { getControlForAssessmentEdit } from "@/lib/control-assessments";
import { runAssessmentEdit, reopenStepsAfterEdit } from "@/lib/assessment-edit";
import { refuseIfSystemClosed } from "@/lib/system-closed";
import { listEvidence } from "@/lib/evidence-data";

/**
 * Removes one Evidence record (#455), same access as adding one: the System's owner or an Admin (403 otherwise, nothing
 * changes), 404 for a System the user can't see or a record that isn't on this Assessment, 409 for a closed System. Reopens
 * approved Review Steps on a System In Review. Returns the Assessment's remaining Evidence records.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]/evidence/[evidenceId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, controlId, evidenceId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (assessmentEditAccess(auth.user, system) !== "full") {
    return NextResponse.json({ error: "Only the System's owner or an Admin can change this System's evidence" }, { status: 403 });
  }
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const control = await getControlForAssessmentEdit(system, controlId);
  if (!control) return NextResponse.json({ error: "Control not found" }, { status: 404 });

  const now = new Date();
  const result = await runAssessmentEdit(system, controlId, async (db, locked) => {
    const item = await db.evidenceItem.findFirst({
      where: { id: evidenceId, controlAssessment: { systemId: system.id, controlId } },
      select: { id: true, controlAssessmentId: true },
    });
    if (!item) return null;
    await db.evidenceItem.delete({ where: { id: item.id } });
    await reopenStepsAfterEdit(db, locked, system, control, auth.user, true);
    return listEvidence(db, item.controlAssessmentId, control.evidenceValidityMonths, now);
  });
  if (!result) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  return NextResponse.json({ evidence: result });
}
