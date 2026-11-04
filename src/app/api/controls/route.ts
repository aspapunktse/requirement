import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { createControlSchema } from "@/lib/control-schema";
import { controlIncludeFor, redactDraftOrigin } from "@/lib/frameworks";
import { loadControlsFor } from "@/lib/control-library";
import { createOrganizationImplementationFor } from "@/lib/organization-implementation";
import { canBeControlOwner, CONTROL_OWNER_REFUSAL } from "@/lib/system-permissions";
import { CONTROL_BULK_OWNER_MAX } from "@/lib/control-bulk-rules";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const controls = await loadControlsFor(auth.user);
  return NextResponse.json({ controls: controls.map((control) => redactDraftOrigin(auth.user, control)) });
}

/**
 * Creates a new Control Library entry — bare, with no facet/
 * Impact Level tagging yet (use `PATCH /api/controls/[id]`
 * to tag it once created, same two-step flow as the rest of the admin
 * catalog UI). See #52.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const parsed = createControlSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Control" }, { status: 400 });
  }

  const { mandatory, examples, ...rest } = parsed.data;

  try {
    // An Organizational or Both Control starts with a Not Started Organization Control
    // Implementation (#120), in the same transaction so a failure leaves neither behind.
    const control = await prisma.$transaction(async (tx) => {
      const created = await tx.control.create({
        data: {
          ...rest,
          mandatory: mandatory ?? true,
          examples: examples ?? [],
        },
        include: controlIncludeFor(auth.user),
      });
      await createOrganizationImplementationFor(tx, created);
      return created;
    });
    return NextResponse.json({ control }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Control with that code already exists" }, { status: 409 });
    }
    throw error;
  }
}

const bulkOwnerSchema = z.object({
  controlIds: z
    .array(z.string().min(1))
    .min(1)
    .max(CONTROL_BULK_OWNER_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: "Each Control may be named once" }),
  // The Control Owner: a User id, or null to clear it. As on PATCH /api/controls/[id].
  ownerId: z.string().min(1).nullable(),
});

/** Thrown inside the transaction to roll it back when a Control vanished between the check and the write. */
class MissingControlsError extends Error {}

/**
 * Assigns (or clears) the Control Owner of several Controls at once (the Control Library's bulk Assign owner,
 * #313). All or nothing: an unknown Control id is a 404 naming it, an unknown User is a 400, a strictly
 * read-only role (an Internal Auditor) can't own a Control (400, the same refusal as `PATCH /api/controls/[id]`),
 * and in each case nothing is written. Catalog curation, so no Change Event (as the single-Control route).
 * Only a role that manages the Requirement database may call it.
 */
export async function PATCH(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = bulkOwnerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { controlIds, ownerId } = parsed.data;

  try {
    const controls = await prisma.$transaction(async (tx) => {
      if (ownerId) {
        const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true, role: true } });
        if (!owner) return NextResponse.json({ error: "Control Owner not found: no User has that id" }, { status: 400 });
        if (!canBeControlOwner(owner)) return NextResponse.json({ error: CONTROL_OWNER_REFUSAL }, { status: 400 });
      }
      const existing = await tx.control.findMany({ where: { id: { in: controlIds } }, select: { id: true } });
      const found = new Set(existing.map((control) => control.id));
      const missing = controlIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        return NextResponse.json({ error: "Control not found", missingIds: missing }, { status: 404 });
      }
      const { count } = await tx.control.updateMany({ where: { id: { in: controlIds } }, data: { ownerId } });
      if (count !== controlIds.length) throw new MissingControlsError();
      return tx.control.findMany({
        where: { id: { in: controlIds } },
        orderBy: { code: "asc" },
        select: { id: true, owner: { select: { id: true, name: true } } },
      });
    });
    // A refusal decided inside the transaction comes back as the response itself (nothing was written).
    if (controls instanceof NextResponse) return controls;
    return NextResponse.json({ controls });
  } catch (error) {
    if (error instanceof MissingControlsError) {
      return NextResponse.json({ error: "Control not found" }, { status: 404 });
    }
    // The User was deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "Control Owner not found: no User has that id" }, { status: 400 });
    }
    throw error;
  }
}
