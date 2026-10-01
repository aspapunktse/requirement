import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getOrganizationControl, normalizeDescription } from "@/lib/organization-implementation";
import { saveOrganizationImplementationWithEvents } from "@/lib/organization-inheritance";
import { canEditOrganizationImplementation, implementationDescriptionRefusal } from "@/lib/organization-implementation-rules";

const updateImplementationSchema = z
  .object({
    status: z.enum(ControlAssessmentStatus).optional(),
    description: z.string().nullable().optional(),
  })
  .refine((data) => data.status !== undefined || data.description !== undefined, {
    message: "Provide a status or a description",
  });

/**
 * Sets the status and/or description of a Control's Organization Control
 * Implementation (PRD 0001 F-IN.1, #120). Creates the row on the first edit of
 * a Control that has none. Order of checks: signed in (401), the Control exists
 * and is Organizational or Both (404; a Per-System Control has no
 * implementation), the user is the Control's Control Owner, a Compliance
 * Manager or an Admin (403, nothing written), then the body (400): at least one
 * field, and a description once the status is Waived or Not Applicable.
 *
 * Nothing is written to any System's Assessments: a System inherits a Both
 * Control's Fulfilled status live. The edit itself is not a Change Event
 * (`updatedById` and `updatedAt` are the record of who and when), but when it
 * moves a Both Control's effective status on some Systems, each of them gets a
 * `"system"` Change Event in the same transaction (F-IN.7, #121).
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/organization/controls/[controlId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { controlId } = await ctx.params;
  const control = await getOrganizationControl(prisma, controlId);
  if (!control) {
    return NextResponse.json(
      { error: "Organizational or Both Control not found: a Per-System Control has no Organization Control Implementation" },
      { status: 404 },
    );
  }

  if (!canEditOrganizationImplementation(auth.user, { ownerId: control.owner?.id ?? null })) {
    return NextResponse.json(
      { error: "Only the Control's Control Owner, a Compliance Manager or an Admin can edit its Organization Control Implementation" },
      { status: 403 },
    );
  }

  const parsed = updateImplementationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, description } = parsed.data;

  // The rule applies to what the implementation will look like after the edit.
  const current = control.organizationImplementation;
  const resultingStatus = status ?? current?.status ?? "NOT_STARTED";
  const resultingDescription = description !== undefined ? normalizeDescription(description) : (current?.description ?? null);
  const refusal = implementationDescriptionRefusal(resultingStatus, resultingDescription);
  if (refusal) {
    return NextResponse.json({ error: refusal }, { status: 400 });
  }

  const saved = await saveOrganizationImplementationWithEvents(control, auth.user.id, { status, description });
  return NextResponse.json({ control: saved });
}
