import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";
import { getSystemAssessmentRow, resetAssessmentToInherited } from "@/lib/control-assessments";

/**
 * Reset the System's own Control Assessment to inherited (#129, F-IN.5): the
 * way back from a person-set Assessment, which overrides every inheritance
 * source for good, to whatever the sources give. The System's owner or an Admin
 * only (a Compliance Manager stays read-only). 409 when the Control no longer
 * applies, has no Full inheritance source for this System (a Shared Offering
 * doesn't count), or the Assessment isn't
 * person-set (see `resetToInheritedRefusal`). The cleared values go into a
 * Change Event (see `resetAssessmentToInherited`). Returns the row as
 * `GET /api/systems/[id]/assessments` shows it: `{ control, assessment, effective }`.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]/reset">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, controlId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!isSystemOwnerOrAdmin(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can reset a Control Assessment to inherited" },
      { status: 403 },
    );
  }

  const result = await resetAssessmentToInherited(system, controlId, auth.user);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const row = await getSystemAssessmentRow(system, controlId);
  if (!row) {
    return NextResponse.json({ error: "Control not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}
