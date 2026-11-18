import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { previewAuditPlan } from "@/lib/check-ups";
import { planPreviewBodySchema, readJson } from "@/lib/internal-audit-api";
import { ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";

/**
 * What launching an audit with the planner's *unsaved* selection would generate (#393): the Check-up counts,
 * the pairs skipped, what blocks the launch and who would receive the Check-ups, computed by the same
 * `planLaunch` the launch runs. Read-only: nothing is saved or checked against the draft rules (the preview
 * reports the blockers instead), so it is a POST only because the selection is too long for a query string.
 * Internal Auditors only, as they are the only ones who plan audits.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const parsed = planPreviewBodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid selection" }, { status: 400 });

  const { internalAuditId, title, dueDate, includeOrganization, controlIds, systemIds, firstQuestions } = parsed.data;
  const preview = await previewAuditPlan({
    internalAuditId,
    title: title ?? "",
    dueDate: dueDate ?? null,
    includeOrganization: includeOrganization ?? false,
    controlIds: controlIds ?? [],
    systemIds: systemIds ?? [],
    firstQuestions,
  });
  return NextResponse.json({ preview });
}
