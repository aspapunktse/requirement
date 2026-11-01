import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getOrganizationControls, listOrganizationControls, normalizeDescription } from "@/lib/organization-implementation";
import { ORGANIZATION_BULK_MAX_CONTROLS, saveOrganizationImplementationsWithEvents } from "@/lib/organization-inheritance";
import { canEditOrganizationImplementation, implementationDescriptionRefusal } from "@/lib/organization-implementation-rules";

/**
 * Every Control the Organization implements (Organizational and Both), by code,
 * each with its Control Owner and its Organization Control Implementation
 * (PRD 0001 F-IN.1, #120). Readable by every signed-in role. A Control with no
 * implementation row reads as Not Started.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  return NextResponse.json({ controls: await listOrganizationControls(prisma) });
}

const bulkSchema = z.object({
  controlIds: z.array(z.string().min(1)).min(1).max(ORGANIZATION_BULK_MAX_CONTROLS),
  status: z.enum(ControlAssessmentStatus),
  description: z.string().nullable().optional(),
});

/**
 * Sets one status on several Controls' Organization Control Implementations at once (the Organization
 * Control Implementations page's bulk "Set status…", #284, decision 2a). `description` replaces each
 * Control's description; missing, null or blank keeps each Control's own. Order of checks: signed in
 * (401), the body (400), every Control exists and is Organizational or Both (404), the user may edit
 * every one of them (403, with `refusedIds`), then the reason rule on each Control's resulting status
 * and description (400, with `refusedIds`). Any refusal writes nothing. Then everything is applied in
 * one transaction through the same write as a single edit, so the Change Events are exactly those of
 * one edit per Control, and either all of the Controls change or none does.
 */
export async function PATCH(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  const { status } = parsed.data;
  const controlIds = [...new Set(parsed.data.controlIds)];
  const description = normalizeDescription(parsed.data.description) ?? undefined;

  const controls = await getOrganizationControls(prisma, controlIds);
  if (controls.length !== controlIds.length) {
    const found = new Set(controls.map((control) => control.id));
    return NextResponse.json(
      {
        error: "Organizational or Both Control not found: a Per-System Control has no Organization Control Implementation",
        refusedIds: controlIds.filter((id) => !found.has(id)),
      },
      { status: 404 },
    );
  }

  const notAllowed = controls.filter((control) => !canEditOrganizationImplementation(auth.user, { ownerId: control.owner?.id ?? null }));
  if (notAllowed.length > 0) {
    return NextResponse.json(
      {
        error: "Only a Control's Control Owner, a Compliance Manager or an Admin can edit its Organization Control Implementation",
        refusedIds: notAllowed.map((control) => control.id),
      },
      { status: 403 },
    );
  }

  // The rule applies to what each implementation will look like after the edit.
  const refused = controls.filter(
    (control) => implementationDescriptionRefusal(status, description ?? control.organizationImplementation?.description ?? null) !== null,
  );
  if (refused.length > 0) {
    return NextResponse.json(
      { error: implementationDescriptionRefusal(status, null), refusedIds: refused.map((control) => control.id) },
      { status: 400 },
    );
  }

  const saved = await saveOrganizationImplementationsWithEvents(controls, auth.user.id, { status, description });
  return NextResponse.json({ controls: saved });
}
