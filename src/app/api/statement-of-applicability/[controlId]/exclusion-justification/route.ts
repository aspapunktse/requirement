import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import {
  EXCLUSION_JUSTIFICATION_MAX_LENGTH,
  exclusionJustificationWriteRefusal,
  loadStatementOfApplicability,
  normalizeExclusionJustification,
} from "@/lib/statement-of-applicability";
import { saveExclusionJustification } from "@/lib/soa-exclusion-justification";

const schema = z.object({ justification: z.string().max(EXCLUSION_JUSTIFICATION_MAX_LENGTH).nullable() });

/**
 * Writes, changes or clears a Control's exclusion justification on the Statement of
 * Applicability (PRD 0001 F-OUT.4, F-CE.1, #150). Compliance Manager and Admin only
 * (401 signed out, 403 otherwise, nothing written). Then the body (400: `justification`
 * a string of at most 2000 characters, or null; blank counts as cleared), the Control
 * (404), and 409 when the Control is included and the text is not a clear (product-owner
 * decision on #150). Saving the stored text again writes nothing. Every change writes one
 * System-less Change Event, in the same transaction.
 */
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/statement-of-applicability/[controlId]/exclusion-justification">,
) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Provide justification as text of at most ${EXCLUSION_JUSTIFICATION_MAX_LENGTH} characters, or null to clear it` },
      { status: 400 },
    );
  }
  const text = normalizeExclusionJustification(parsed.data.justification);

  const { controlId } = await ctx.params;
  const row = (await loadStatementOfApplicability()).find((candidate) => candidate.controlId === controlId);
  if (!row) return NextResponse.json({ error: "Control not found" }, { status: 404 });

  const refusal = exclusionJustificationWriteRefusal(row.included, text);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  const result = await saveExclusionJustification(controlId, text, auth.user.id);
  if (!result) return NextResponse.json({ error: "Control not found" }, { status: 404 });

  const exclusionJustification = row.included ? null : text;
  return NextResponse.json({
    controlId,
    exclusionJustification,
    justificationMissing: !row.included && exclusionJustification === null,
  });
}
