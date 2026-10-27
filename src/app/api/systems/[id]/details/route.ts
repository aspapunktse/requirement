import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canChangeSystemClassification } from "@/lib/system-classification-change";
import { saveSystemDetails, systemDetailsSchema } from "@/lib/system-details";

/**
 * Edits a System's name, vendor and description (#246), at any Onboarding Status; it never touches the
 * status or the Approval history. The System's owner or an Admin may (the classification rule); a System the
 * user can't see is a 404, a visible one they may not edit a 403. Each save that changes something writes
 * exactly one SYSTEM_DETAILS_CHANGED Change Event in the same transaction; a save that changes nothing writes none.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/details">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const visible = await getVisibleSystem(auth.user, id);
  if (!visible) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canChangeSystemClassification(auth.user, visible)) {
    return NextResponse.json({ error: "Only the System's owner or an Admin can edit its details" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = systemDetailsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid details" }, { status: 400 });
  }

  // The checks above are a fast refusal; the permission is checked again under the System's row lock.
  const result = await saveSystemDetails(auth.user, visible.id, parsed.data);
  if (result.status !== 200) {
    return result.status === 404
      ? NextResponse.json({ error: "System not found" }, { status: 404 })
      : NextResponse.json({ error: "Only the System's owner or an Admin can edit its details" }, { status: 403 });
  }
  return NextResponse.json({ system: result.system });
}
